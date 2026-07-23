# Sajilo Android project

This is the native Android Studio project for Sajilo. It is generated and synchronized through Capacitor, while its custom poll-notification and biometric code lives in `app/src/main/java/com/sajilo/split/`.

## Build and verify

Run these commands from the repository root:

```bash
npm run android:build
npm run android:verify
```

Open this directory directly in Android Studio or run `npm run android:open`.

## Install over USB

With the phone connected, USB debugging authorized, and the local API running:

```bash
npm run dev:api
npm run android:install
```

The install command creates an ADB reverse tunnel for TCP port 8787, installs the debug APK, and launches the main activity.

## Notification behavior

Polls use channel `poll_alerts_v1` at maximum importance. Android 13+ asks the user for notification permission after login. On Android versions that restrict full-screen intents, the app checks special access and offers a direct settings link; without that access, the same alert remains available as a heads-up and lock-screen notification.

Incoming payments use a separate `payment_requests_v1` high-importance channel. Financial details remain private on the lock screen, and each notification opens Sajilo through its Review action.

The current development delivery path is local: once the app receives or discovers an open poll, native Android presents the alert and owns dismissal/re-notification. Production background delivery from the server still requires an FCM project and its private deployment credentials.
