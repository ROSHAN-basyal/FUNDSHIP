import { request } from './api';

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const INSTALL_DISMISSED_KEY = 'fundship_install_dismissed_at';
const POLL_SOUND_KEY = 'fundship_poll_sound_enabled';
let installPrompt: InstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    window.dispatchEvent(new Event('fundship-install-available'));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    localStorage.removeItem(INSTALL_DISMISSED_KEY);
    window.dispatchEvent(new Event('fundship-install-changed'));
  });
}

export function registerFundshipServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }, { once: true });
}

export function isStandalonePwa() {
  return matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function canOfferInstall() {
  const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISSED_KEY) || 0);
  const dismissalExpired = Date.now() - dismissedAt > 30 * 24 * 60 * 60 * 1000;
  return Boolean(installPrompt) && !isStandalonePwa() && (!dismissedAt || dismissalExpired);
}

export async function installPwa() {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  if (choice.outcome === 'dismissed') dismissInstallPrompt();
  if (choice.outcome === 'accepted') installPrompt = null;
  return choice.outcome === 'accepted';
}

export function dismissInstallPrompt() {
  localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
  window.dispatchEvent(new Event('fundship-install-changed'));
}

export function pollSoundEnabled() {
  return localStorage.getItem(POLL_SOUND_KEY) !== '0';
}

export function setPollSoundEnabled(enabled: boolean) {
  localStorage.setItem(POLL_SOUND_KEY, enabled ? '1' : '0');
}

export function playPollSound() {
  if (!pollSoundEnabled()) return;
  const audio = new Audio('/sounds/fundship-poll.wav');
  audio.volume = 0.7;
  void audio.play().catch(() => {
    // Browsers can block audio until the page has received a user gesture.
  });
}

function applicationServerKey(value: string) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export type WebPushState = {
  available: boolean;
  configured: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  explanation?: string;
};

export async function webPushState(): Promise<WebPushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return {
      available: false,
      configured: false,
      permission: 'unsupported',
      subscribed: false,
      explanation: 'This browser or operating system does not support web push.',
    };
  }
  try {
    const config = await request<{ supported: boolean; publicKey: string | null; subscribed: boolean }>('/push/config');
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      return {
        available: true,
        configured: false,
        permission: Notification.permission,
        subscribed: false,
        explanation: 'Installable web features become available in the production build.',
      };
    }
    const subscription = await registration.pushManager.getSubscription();
    return {
      available: true,
      configured: config.supported,
      permission: Notification.permission,
      subscribed: Boolean(subscription && config.subscribed),
      explanation: config.supported ? undefined : 'Web push is not configured on this deployment.',
    };
  } catch (error) {
    return {
      available: true,
      configured: false,
      permission: Notification.permission,
      subscribed: false,
      explanation: error instanceof Error ? error.message : 'Could not check web push support.',
    };
  }
}

export async function enableWebPollPush() {
  const config = await request<{ supported: boolean; publicKey: string | null }>('/push/config');
  if (!config.supported || !config.publicKey) throw new Error('Web push is not configured on this deployment.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.getRegistration()
    || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(config.publicKey),
  });
  await request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

export async function disableWebPollPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await request('/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
