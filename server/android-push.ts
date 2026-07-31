import { createSign } from 'node:crypto';
import type { AppDatabase } from './database.js';

type FirebaseCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type PushOptions = {
  collapseKey: string;
  ttlSeconds: number;
};

export type AndroidPushResult = {
  configured: boolean;
  targeted: number;
  accepted: number;
  removed: number;
  failed: number;
};

let cachedAccessToken: { key: string; value: string; expiresAt: number } | undefined;
let accessTokenInFlight: Promise<string> | undefined;

function firebaseCredentials(): FirebaseCredentials | undefined {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  let projectId = process.env.FIREBASE_PROJECT_ID?.trim() || '';
  let clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() || '';
  let privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim() || '';

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      projectId = String(parsed.project_id || projectId).trim();
      clientEmail = String(parsed.client_email || clientEmail).trim();
      privateKey = String(parsed.private_key || privateKey).trim();
    } catch {
      return undefined;
    }
  }

  privateKey = privateKey.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey.includes('BEGIN PRIVATE KEY')) return undefined;
  return { projectId, clientEmail, privateKey };
}

export function androidPushConfigured() {
  return Boolean(firebaseCredentials());
}

function encodedJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function mintAccessToken(credentials: FirebaseCredentials) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodedJson({ alg: 'RS256', typ: 'JWT' })}.${encodedJson({
    iss: credentials.clientEmail,
    sub: credentials.clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.privateKey).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `Firebase authorization failed (${response.status}).`);
  }
  cachedAccessToken = {
    key: `${credentials.projectId}:${credentials.clientEmail}`,
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600) - 120) * 1000,
  };
  return body.access_token;
}

async function accessToken(credentials: FirebaseCredentials) {
  const key = `${credentials.projectId}:${credentials.clientEmail}`;
  if (cachedAccessToken?.key === key && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }
  if (!accessTokenInFlight) {
    accessTokenInFlight = mintAccessToken(credentials).finally(() => {
      accessTokenInFlight = undefined;
    });
  }
  return accessTokenInFlight;
}

function fcmErrorCode(body: any) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  return String(details.find((item: any) => item?.errorCode)?.errorCode || '');
}

function stringData(data: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
}

export async function sendAndroidDataPush(
  db: AppDatabase,
  userIds: string[],
  data: Record<string, string | number | boolean>,
  options: PushOptions,
): Promise<AndroidPushResult> {
  const credentials = firebaseCredentials();
  const recipients = [...new Set(userIds.filter(Boolean))];
  const empty = { configured: Boolean(credentials), targeted: 0, accepted: 0, removed: 0, failed: 0 };
  if (!credentials || recipients.length === 0) return empty;

  const placeholders = recipients.map(() => '?').join(',');
  const rows = await db.all<{ token: string }>(
    `SELECT DISTINCT device.token
     FROM android_push_tokens device
     JOIN sessions session ON session.token=device.session_token
     WHERE device.user_id IN (${placeholders})
       AND (session.expires_at IS NULL OR session.expires_at>?)`,
    [...recipients, new Date().toISOString()],
  );
  if (rows.length === 0) return empty;

  const payloadData = stringData(data);
  if (Buffer.byteLength(JSON.stringify(payloadData), 'utf8') > 3500) {
    return { ...empty, targeted: rows.length, failed: rows.length };
  }

  let bearer: string;
  try {
    bearer = await accessToken(credentials);
  } catch (error) {
    console.warn('Android push authorization failed:', error instanceof Error ? error.message : 'unknown error');
    return { ...empty, targeted: rows.length, failed: rows.length };
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`;
  const outcomes = await Promise.all(rows.map(async ({ token }) => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            data: payloadData,
            android: {
              priority: 'HIGH',
              ttl: `${Math.max(60, Math.round(options.ttlSeconds))}s`,
              collapse_key: options.collapseKey.slice(0, 64),
            },
          },
        }),
      });
      if (response.ok) return { token, accepted: true, invalid: false };
      const body = await response.json().catch(() => ({}));
      const code = fcmErrorCode(body);
      return {
        token,
        accepted: false,
        invalid: code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH',
      };
    } catch {
      return { token, accepted: false, invalid: false };
    }
  }));

  const invalid = outcomes.filter((item) => item.invalid).map((item) => item.token);
  if (invalid.length > 0) {
    const invalidPlaceholders = invalid.map(() => '?').join(',');
    await db.run(`DELETE FROM android_push_tokens WHERE token IN (${invalidPlaceholders})`, invalid);
  }
  const accepted = outcomes.filter((item) => item.accepted).length;
  return {
    configured: true,
    targeted: rows.length,
    accepted,
    removed: invalid.length,
    failed: rows.length - accepted - invalid.length,
  };
}
