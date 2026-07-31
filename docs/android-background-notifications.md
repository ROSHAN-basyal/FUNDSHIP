# Android background notifications

FUNDSHIP uses Firebase Cloud Messaging (FCM) to deliver new polls and incoming
payment requests when the Android activity is closed or has been removed from
Recents. This is a server-triggered, event-driven path: the app does not keep a
foreground service alive and does not poll the backend while closed.

## Delivery flow

1. After an eligible user finishes onboarding, the Android app obtains an FCM
   registration token and registers it through the authenticated FUNDSHIP API.
2. The registration is tied to that exact remembered server session. Logging
   out or session expiry removes it automatically.
3. Creating an approved poll or incoming payment request sends a high-priority
   FCM data message from Vercel.
4. `FundshipMessagingService` receives the message even without a visible app
   activity and immediately reuses `PollNotificationManager` or
   `PaymentNotificationManager`. No network fetch is required before display.
5. A local delivered-ID set prevents the foreground reconciliation path from
   alerting twice when the user later opens FUNDSHIP.

Only `poll_open` and `payment_request` events use this Android phone-push path.
Chat, invitations, connection changes, poll results, and other inbox activity
remain in-app only.

## Firebase setup

1. Create or select a Firebase project.
2. Add an Android app with package name `com.sajilo.split`.
3. Download its `google-services.json` and place it at
   `andriod/app/google-services.json` before building the APK.
4. In Firebase project settings, open **Service accounts** and generate a new
   private key for a server service account. Enable the Firebase Cloud Messaging
   HTTP v1 API for the project.
5. Convert the downloaded service-account JSON to one compact JSON line and set
   it as the Vercel production secret `FIREBASE_SERVICE_ACCOUNT_JSON`. Never use
   a `VITE_` prefix and never include this credential in the APK or Git.
6. Apply
   `supabase/migrations/202607310001_android_background_push.sql`, then redeploy
   Vercel.
7. Verify `/api/health` reports `"androidPushConfigured": true`.
8. Rebuild and install the Android APK, open it once, sign in, finish onboarding,
   and grant Android notification permission.

The backend uses short-lived OAuth access tokens and FCM HTTP v1 directly. It
does not bundle the heavier Firebase Admin SDK into the Vercel function.

## Android limitations

- FCM requires a device with compatible Google Play services. Devices without
  Google Play services need a different vendor push provider.
- Closing the UI or swiping FUNDSHIP from Recents does not stop delivery.
  Explicitly pressing **Force stop**, disabling notifications, revoking network
  access, or some manufacturer battery restrictions prevents Android from
  delivering messages until the user opens the app again.
- High-priority delivery is intended for visible, time-sensitive notifications,
  but no internet push system can guarantee an exact delivery time.
- Android 14+ restricts full-screen intents to calling/alarm use cases. FUNDSHIP
  uses its existing full-screen poll presentation only where Android reports the
  permission is available; otherwise Android shows the high-importance heads-up
  and lock-screen notification with the same poll actions.
