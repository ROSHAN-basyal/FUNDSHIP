const CACHE_NAME = 'fundship-shell-v1';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/sounds/fundship-poll.wav',
];
const DB_NAME = 'fundship-offline-v1';
const DB_VERSION = 1;
const QUEUE_STORE = 'paymentQueue';
const META_STORE = 'secureMeta';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const pending = indexedDB.open(DB_NAME, DB_VERSION);
    pending.onupgradeneeded = () => {
      const database = pending.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        queue.createIndex('userId', 'userId');
        queue.createIndex('status', 'status');
      }
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

function idbRequest(pending) {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function decryptPayload(database, item, key) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(item.iv) },
    key,
    base64ToBytes(item.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function updateQueueItem(database, id, changes) {
  const readStore = database.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE);
  const item = await idbRequest(readStore.get(id));
  if (!item) return;
  const writeStore = database.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE);
  await idbRequest(writeStore.put({ ...item, ...changes, updatedAt: new Date().toISOString() }));
}

async function storeSyncCount(database, count) {
  if (count <= 0) return;
  const readStore = database.transaction(META_STORE, 'readonly').objectStore(META_STORE);
  const existing = Number(await idbRequest(readStore.get('background-synced-count')) || 0);
  const writeStore = database.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  await idbRequest(writeStore.put(existing + count, 'background-synced-count'));
}

async function synchronizePayments() {
  const database = await openDatabase();
  const meta = database.transaction(META_STORE, 'readonly').objectStore(META_STORE);
  const [key, activeUserId] = await Promise.all([
    idbRequest(meta.get('queue-aes-key')),
    idbRequest(meta.get('active-user-id')),
  ]);
  if (!key || !activeUserId) {
    database.close();
    return;
  }
  const stored = await idbRequest(
    database.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).index('userId').getAll(activeUserId),
  );
  let synced = 0;
  let shouldRetry = false;
  for (const item of stored) {
    if (item.status === 'sent' || item.status === 'failed') continue;
    if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) {
      shouldRetry = true;
      continue;
    }
    const attempts = Number(item.attempts || 0) + 1;
    await updateQueueItem(database, item.id, { status: 'sending', attempts, lastError: undefined });
    try {
      const payload = await decryptPayload(database, item, key);
      const response = await fetch(`/api${item.path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      await updateQueueItem(database, item.id, {
        status: 'sent',
        attempts,
        lastError: undefined,
        nextAttemptAt: undefined,
      });
      synced += 1;
    } catch (error) {
      const status = Number(error.status || 0);
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
      const failed = permanent || attempts >= 5;
      const delay = Math.min(15 * 60, 15 * 2 ** Math.min(attempts, 6));
      await updateQueueItem(database, item.id, {
        status: failed ? 'failed' : 'pending',
        attempts,
        lastError: error.message || 'Synchronization failed.',
        nextAttemptAt: failed ? undefined : new Date(Date.now() + delay * 1000).toISOString(),
      });
      if (!failed) shouldRetry = true;
    }
  }
  if (synced > 0) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      for (const client of clients) client.postMessage({ type: 'FUNDSHIP_SYNCED', count: synced });
    } else {
      await storeSyncCount(database, synced);
    }
  }
  database.close();
  if (shouldRetry) throw new Error('Payment synchronization will retry.');
}

self.addEventListener('sync', event => {
  if (event.tag === 'fundship-payment-sync') event.waitUntil(synchronizePayments());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'FUNDSHIP_SYNC_NOW') event.waitUntil(synchronizePayments());
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'New FUNDSHIP poll', {
    body: payload.body || 'Open FUNDSHIP to vote.',
    tag: payload.tag || `poll:${Date.now()}`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || { kind: 'poll', url: '/' },
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [220, 120, 220],
    actions: [{ action: 'open', title: 'Open poll' }, { action: 'later', title: 'Later' }],
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'later') return;
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => 'focus' in client);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
