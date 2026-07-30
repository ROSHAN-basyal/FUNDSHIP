import type { Bootstrap } from '../types';
import { ApiError, rememberBootstrap, request } from './api';

const DB_NAME = 'fundship-offline-v1';
const DB_VERSION = 1;
const QUEUE_STORE = 'paymentQueue';
const META_STORE = 'secureMeta';
export const QUEUE_CHANGED_EVENT = 'fundship-queue-changed';

export type QueueStatus = 'pending' | 'sending' | 'sent' | 'failed';
export type QueuedPayment = {
  id: string;
  userId: string;
  kind: 'lend' | 'split';
  path: '/payments/lend' | '/payments/split';
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  label: string;
  amount: number;
  purpose: string;
  payload: Record<string, unknown>;
};

type StoredPayment = Omit<QueuedPayment, 'payload'> & {
  iv: string;
  ciphertext: string;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const pending = indexedDB.open(DB_NAME, DB_VERSION);
    pending.onupgradeneeded = () => {
      const database = pending.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        queue.createIndex('userId', 'userId');
        queue.createIndex('status', 'status');
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

function idbRequest<T>(pending: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

async function cryptoKey(database: IDBDatabase) {
  const read = database.transaction(META_STORE, 'readonly').objectStore(META_STORE);
  const existing = await idbRequest(read.get('queue-aes-key')) as CryptoKey | undefined;
  if (existing) return existing;
  const generated = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const write = database.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  await idbRequest(write.put(generated, 'queue-aes-key'));
  return generated;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptPayload(database: IDBDatabase, payload: Record<string, unknown>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(database), plaintext);
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptPayload(database: IDBDatabase, item: StoredPayment) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(item.iv) },
    await cryptoKey(database),
    base64ToBytes(item.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
}

function announce(detail?: unknown) {
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT, { detail }));
}

async function put(item: StoredPayment) {
  const database = await openDatabase();
  await idbRequest(database.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).put(item));
  database.close();
  announce();
}

async function patch(id: string, changes: Partial<StoredPayment>) {
  const database = await openDatabase();
  const store = database.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE);
  const item = await idbRequest(store.get(id)) as StoredPayment | undefined;
  if (item) await idbRequest(store.put({ ...item, ...changes, updatedAt: new Date().toISOString() }));
  database.close();
  announce();
}

export async function enqueuePayment(input: {
  id: string;
  userId: string;
  kind: QueuedPayment['kind'];
  path: QueuedPayment['path'];
  payload: Record<string, unknown>;
  label: string;
  amount: number;
  purpose: string;
}) {
  const database = await openDatabase();
  const encrypted = await encryptPayload(database, input.payload);
  const now = new Date().toISOString();
  const item: StoredPayment = {
    ...input,
    ...encrypted,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await idbRequest(database.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).put(item));
  await idbRequest(database.transaction(META_STORE, 'readwrite').objectStore(META_STORE).put(input.userId, 'active-user-id'));
  database.close();
  await scheduleBackgroundSync();
  announce();
  return item.id;
}

export async function setActiveOfflineUser(userId: string | null) {
  const database = await openDatabase();
  const store = database.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  if (userId) await idbRequest(store.put(userId, 'active-user-id'));
  else await idbRequest(store.delete('active-user-id'));
  database.close();
}

export async function consumeBackgroundSyncCount() {
  const database = await openDatabase();
  const store = database.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  const count = Number(await idbRequest(store.get('background-synced-count')) || 0);
  if (count > 0) await idbRequest(store.delete('background-synced-count'));
  database.close();
  return count;
}

export async function listQueuedPayments(userId: string): Promise<QueuedPayment[]> {
  const database = await openDatabase();
  const stored = await idbRequest(
    database.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).index('userId').getAll(userId),
  ) as StoredPayment[];
  const sent = stored.filter(item => item.status === 'sent').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const remove = new Set(sent.slice(50).map(item => item.id));
  for (const id of remove) {
    await idbRequest(database.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).delete(id));
  }
  const retained = stored.filter(item => !remove.has(item.id));
  const result = await Promise.all(retained.map(async (item) => ({
    ...item,
    payload: await decryptPayload(database, item),
  })));
  database.close();
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function submitPaymentRequest(input: {
  userId: string;
  kind: QueuedPayment['kind'];
  path: QueuedPayment['path'];
  payload: Record<string, unknown>;
  label: string;
  amount: number;
  purpose: string;
  online: boolean;
}): Promise<{ queued: boolean; data?: Bootstrap }> {
  const id = crypto.randomUUID();
  const payload = { ...input.payload, clientRequestId: id };
  if (input.online) {
    try {
      const data = rememberBootstrap(await request<Bootstrap>(input.path, {
        method: 'POST',
        body: JSON.stringify(payload),
      }));
      return { queued: false, data };
    } catch (error) {
      if (!(error instanceof ApiError) || !error.network) throw error;
    }
  }
  await enqueuePayment({ ...input, id, payload });
  return { queued: true };
}

export async function syncQueuedPayments(userId: string) {
  const items = await listQueuedPayments(userId);
  let synced = 0;
  let latest: Bootstrap | undefined;
  for (const item of items) {
    if (item.status === 'sent') continue;
    if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > Date.now()) continue;
    if (item.status === 'failed') continue;
    await patch(item.id, { status: 'sending', lastError: undefined });
    try {
      latest = rememberBootstrap(await request<Bootstrap>(item.path, {
        method: 'POST',
        body: JSON.stringify(item.payload),
      }));
      await patch(item.id, { status: 'sent', attempts: item.attempts + 1, nextAttemptAt: undefined });
      synced += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      const permanent = error instanceof ApiError
        && !error.network
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429;
      const failed = permanent || attempts >= 5;
      const delaySeconds = Math.min(15 * 60, 15 * 2 ** Math.min(attempts, 6));
      await patch(item.id, {
        status: failed ? 'failed' : 'pending',
        attempts,
        lastError: error instanceof Error ? error.message : 'Synchronization failed.',
        nextAttemptAt: failed ? undefined : new Date(Date.now() + delaySeconds * 1000).toISOString(),
      });
    }
  }
  if (synced > 0) announce({ synced });
  return { synced, data: latest };
}

export async function retryQueuedPayment(id: string) {
  await patch(id, { status: 'pending', attempts: 0, lastError: undefined, nextAttemptAt: undefined });
  await scheduleBackgroundSync();
}

export async function scheduleBackgroundSync() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    }).sync;
    if (!sync) return false;
    await sync.register('fundship-payment-sync');
    return true;
  } catch {
    return false;
  }
}
