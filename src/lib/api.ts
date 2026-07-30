import type { Bootstrap, User } from '../types';

const TOKEN_KEY = 'sajilo_token';
const SIGNED_IN_KEY = 'fundship_signed_in';
const SESSION_EXPIRY_KEY = 'fundship_session_expires_at';
const SNAPSHOT_KEY = 'fundship_last_verified_snapshot';
const API_ROOT = import.meta.env.VITE_API_URL || '/api';
let memoryToken: string | null = null;

export const session = {
  get: () => memoryToken || localStorage.getItem(TOKEN_KEY),
  exists: () => {
    const expiry = Number(localStorage.getItem(SESSION_EXPIRY_KEY) || 0);
    if (expiry && expiry <= Date.now()) return false;
    return localStorage.getItem(SIGNED_IN_KEY) === '1' || Boolean(localStorage.getItem(TOKEN_KEY));
  },
  set: (token: string, expiresAt?: string) => {
    memoryToken = token;
    localStorage.setItem(SIGNED_IN_KEY, '1');
    localStorage.setItem(SESSION_EXPIRY_KEY, String(expiresAt ? Date.parse(expiresAt) : Date.now() + 30 * 24 * 60 * 60 * 1000));
    localStorage.removeItem(TOKEN_KEY);
  },
  markRemembered: () => {
    localStorage.setItem(SIGNED_IN_KEY, '1');
    // A verified response means the server has upgraded any legacy bearer
    // session to an HTTP-only cookie.
    localStorage.removeItem(TOKEN_KEY);
  },
  clear: () => {
    memoryToken = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SIGNED_IN_KEY);
    localStorage.removeItem(SESSION_EXPIRY_KEY);
    localStorage.removeItem(SNAPSHOT_KEY);
  },
};

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly network: boolean) {
    super(message);
    this.name = 'ApiError';
  }
}

export function cachedBootstrap(): Bootstrap | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') as Bootstrap | null;
    return parsed?.user ? parsed : null;
  } catch {
    localStorage.removeItem(SNAPSHOT_KEY);
    return null;
  }
}

export function rememberBootstrap(data: Bootstrap) {
  session.markRemembered();
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
  return data;
}

export function applyPollVote(data: Bootstrap, pollId: string, choice: string, revision: number) {
  const createdAt = new Date().toISOString();
  const groups = data.groups.map((group) => ({
    ...group,
    polls: group.polls.map((poll) => {
      if (poll.id !== pollId) return poll;
      const voteDetails = [
        ...poll.voteDetails.filter((vote) => vote.userId !== data.user.id),
        {
          userId: data.user.id,
          name: data.user.name,
          avatarColor: data.user.avatarColor,
          choice,
          createdAt,
        },
      ];
      return {
        ...poll,
        myVote: choice,
        voteDetails,
        yesCount: voteDetails.filter((vote) => vote.choice === 'yes').length,
        noCount: voteDetails.filter((vote) => vote.choice === 'no').length,
      };
    }),
  }));
  return rememberBootstrap({ ...data, revision: Math.max(data.revision || 0, revision), groups });
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(session.get() ? { Authorization: `Bearer ${session.get()}` } : {}),
      ...options.headers,
    },
  }).catch((error) => {
    throw new ApiError(
      error instanceof Error ? error.message : 'No internet connection.',
      0,
      true,
    );
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || 'Something went wrong.', response.status, false);
  return body;
}

export async function login(credentialId: string, password: string) {
  const data = await request<{ token: string; expiresAt: string; user: User }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ credentialId, password }),
  });
  session.set(data.token, data.expiresAt);
  return data;
}

export const getBootstrap = async () => rememberBootstrap(await request<Bootstrap>('/bootstrap'));

export type SyncResponse =
  | { changed: false; revision: number }
  | { changed: true; revision: number; snapshot: Bootstrap };

export const getSync = (after: number) => request<SyncResponse>(`/sync?after=${Math.max(0, after)}`);

export const mutate = async (path: string, body?: unknown, method = 'POST') =>
  rememberBootstrap(await request<Bootstrap>(
    path,
    { method, body: body === undefined ? undefined : JSON.stringify(body) },
  ));
