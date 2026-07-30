# Offline, PWA, and notification behavior

## Offline payments

Offline mode is available only after a successful login has produced a remembered
session and a verified account snapshot on that device. Individual and group
payment requests can then be created for people already present in that cached
connection list.

- Every request receives a client-generated UUID.
- The API records that UUID per user in `payment_mutations`, so a timeout or retry
  cannot create a duplicate payment.
- Android encrypts the queue with an AES-GCM key held by Android Keystore.
- The web app encrypts queued payloads with Web Crypto AES-GCM. The non-exportable
  key is stored by the browser in IndexedDB. This protects payloads from casual
  storage inspection, but it cannot protect against malicious code already
  executing in the same browser origin.
- Android uses `JobScheduler` with a network constraint and exponential backoff.
  Exact execution time is controlled by Android and may be delayed by Doze,
  battery optimization, vendor firmware, or force-stop.
- The PWA uses Background Sync when the browser implements it. When it does not,
  synchronization runs when the app is reopened, becomes visible, or receives an
  online event.
- Pending, Sending, Sent, and Failed states survive restarts. A failed request can
  be retried explicitly.

All other cached features are disabled offline. The UI returns the user to Home
and explains that an internet connection is required.

## Remembered sessions

Android stores its bearer session token encrypted by Android Keystore. Browsers
receive the session in an HTTP-only, Secure, SameSite=Lax cookie scoped to `/api`.
JavaScript stores only a signed-in marker and the last account snapshot, never the
password or the current session token. Sessions expire server-side after 30 days.

## PWA installation

The production web build includes a manifest, PNG/maskable icons, and a service
worker. Chromium-based desktop browsers can use the in-app Install button when
they expose `beforeinstallprompt`. Browsers that do not expose that API must use
their own **Install app** or **Add to Home Screen** menu. A dismissed desktop
prompt is suppressed for 30 days.

Installation and service workers require HTTPS, except on localhost. Private or
restricted browsing modes can disable persistence, installation, push, or
background sync.

## Poll notification sound

Android poll notifications use the bundled `fundship_poll.wav` through the
versioned `urgent_poll_alerts_v4` channel. Users can open the channel settings from
Profile to change its sound, vibration, visibility, or disable it. Android channel
settings are controlled by the OS and can override app preferences.

The web app can play the same sound while FUNDSHIP is open. Background web push
notifications do not support an app-selected custom sound in major browsers; the
browser/operating system chooses the sound. Autoplay rules can also suppress the
foreground sound until the user has interacted with the page.

## Web push

Generate VAPID keys once:

```bash
npm run push:generate-keys
```

Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to the Vercel
environment before redeploying. `VAPID_SUBJECT` should be a `mailto:` address or
HTTPS URL controlled by the operator. The private key must never be committed.

Permission is requested only when the user presses **Enable** in Profile. Web push
requires support from the browser, service worker, push service, and operating
system. iOS/iPadOS requires an installed Home Screen web app and a compatible OS
version. Unsupported combinations display a limitation rather than claiming
notifications are active.
