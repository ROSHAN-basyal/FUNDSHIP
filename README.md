# FUNDSHIP — group polls and shared payments

FUNDSHIP is a native Android implementation of the supplied group poll and personal-ledger specification. Local development uses Express and SQLite; production uses the same Express API as a Vercel Function with Supabase Postgres. The Android client uses Java, Android Views, RecyclerView, and ViewPager2; it does not use a WebView or package the web client.

## Run locally

Requirements: Node.js 22 or newer (the API uses Node's built-in SQLite module).

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Demo accounts:

| User | System ID | Password | MPIN |
|---|---|---|---|
| Roshan Basyal | `RB-001` | `12345678` | `2580` |
| Nawaraj Poudel | `NP-002` | `123456789` | `1470` |

The database is created and seeded at `server/data/sajilo.db` on first API start. Remove or move that file while the server is stopped to restore the original seed on the next start.

## Included flows

- System-issued credential login, first-login fingerprint enrollment, biometric return login, password change, MPIN verification/change, and payment-linked phone-number setup.
- Administrator-issued beta accounts with mandatory first-login password replacement and one-time personal MPIN setup.
- Netted person-to-person ledger with incoming/outgoing pending requests.
- Lend requests, individual requests, single or bulk biometric-first verification, equal/manual group splits, and verified bilateral transaction history.
- Group creation, invitation approval, automatic member connections, manual connection requests, group ordering, animated swipe navigation, and text-only chat.
- Admin-created polls, member poll requests, admin approval, adaptive relative dates, manual BS selection, separate event time, deadlines, automatic outcome evaluation, and Yes/No or option-based voting with NOTA.
- Multiple active polls per group, voter breakdowns, live-poll deletion by the creator/admin, and completed poll history.
- A server-backed in-app notification inbox for payment, connection, group, approval, poll, result, and event reminders.
- Full-screen incoming-poll experience with a two-hour dismiss/re-prompt window and reconnect checks.
- Ten-day chat retention and three-month poll/vote retention, enforced in both supported databases.
- Responsive desktop and Android-sized layouts plus an installable web-app manifest.

## Verification

```bash
npm run check
npm run build
npm run android:verify
```

The local API smoke suite covers multiple active polls, option/NOTA voting, poll approval, payment inbox delivery, connections, chat retention, persistent winner reminders, and live-poll deletion. Android verification builds the APK, runs Android lint, and runs unit tests.

## Native Android Studio build

The complete native Android Studio project is in `andriod/` (the requested directory spelling). It targets Android API 36, requires Android 7.0/API 24 or newer, and uses Java Android Views with a fixed native toolbar and ViewPager2 pages.

```bash
npm run android:build
npm run android:open
```

The debug APK is written to `andriod/app/build/outputs/apk/debug/app-debug.apk`.

The debug build points to `http://127.0.0.1:8787/api` by default. After Vercel is connected, build an APK for the hosted API with:

```bash
FUNDSHIP_API_URL=https://YOUR-VERCEL-DOMAIN/api npm run android:build
```

For a USB-connected phone, start the API first and then install the app. The reverse tunnel lets the phone reach the development API through `http://localhost:8787` without exposing it on the LAN.

```bash
npm run dev:api
npm run android:install
```

The phone must have Developer options and USB debugging enabled, and its RSA authorization prompt must be accepted.

## Native Android capabilities

- Runtime notification permission on Android 13 and newer, plus notification-settings recovery when permission is disabled.
- A dedicated maximum-importance poll channel with sound, vibration, heads-up display, public lock-screen content, and Yes/No/Later actions for Yes/No polls.
- A separate high-importance payment-request channel with private lock-screen content and a direct Review action.
- High-importance update and confirmed-event channels for the server-backed app inbox; confirmed-event reminders remain locked in the in-app inbox until their event time.
- Full-screen poll activity over the lock screen when the device grants full-screen-intent special access; otherwise Android presents a high-priority heads-up/lock-screen notification.
- Two-hour re-notification after dismissal or Later, with active reminder restoration after reboot/app update.
- Android BiometricPrompt is the default for sensitive payment verification, with an explicit **Use MPIN** fallback.
- Biometric return login stores the API session encrypted by an Android Keystore key; password login remains available as recovery.
- Native system-bar handling, RecyclerView lists, ViewPager2 group swiping, and Android haptic feedback.

## Supabase and Vercel deployment

The production code path is ready, but no credentials are committed. SQLite remains the automatic fallback only when `DATABASE_URL` is absent in local development. Production startup fails safely if that variable is missing.

1. Create a Supabase project and run [`supabase/migrations/202607230001_initial_schema.sql`](supabase/migrations/202607230001_initial_schema.sql) in its SQL editor. Run [`supabase/seed.sql`](supabase/seed.sql) only if the demo accounts are wanted.
2. In Supabase, copy the **transaction pooler** connection string on port `6543`. Use that value for `DATABASE_URL`; the server disables prepared statements because transaction mode does not support them.
3. Import the GitHub repository into Vercel. Set `DATABASE_URL`, `DATABASE_SSL=require`, `DATABASE_POOL_SIZE=1`, and a long random `CRON_SECRET` in the Vercel project environment.
4. Deploy and verify `https://YOUR-VERCEL-DOMAIN/api/health`. The response should report `"database": "postgres"`.
5. Build Android with `FUNDSHIP_API_URL=https://YOUR-VERCEL-DOMAIN/api`, then install that APK.

### Issue a beta account

Run the operator command from a trusted computer:

```bash
npm run user:create
```

It prompts for the Supabase transaction-pooler URL (hidden when `DATABASE_URL` is not already set), user ID, display name, initial password, and password confirmation. The password is hidden and stored only as a bcrypt hash. The user must replace it at first login, then create their own four-digit MPIN before the rest of the app unlocks. There is deliberately no account-creation control in the mobile app.

For repeated use in one trusted terminal session, `DATABASE_URL` may be supplied through the environment. Never paste it into source files or commit it.

[`vercel.json`](vercel.json) packages the Express API from [`api/[...path].ts`](api/[...path].ts), builds the Vite client, and runs retention/poll finalization daily at midnight Nepal time. Bootstrap requests also run the same idempotent maintenance so overdue polls do not wait for the daily job.

The GitHub workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) type-checks, smoke-tests, and builds every push and pull request. Connecting the repository through Vercel's Git integration gives production deployments after that validation path is established.

Passwords and MPINs retain compatibility with existing local SHA-256 demo records, then are upgraded to bcrypt on successful password login or MPIN change. The Supabase tables have RLS enabled with no public Data API policies; the trusted Vercel API is the only intended data path.

Profile images are still stored as text fields for compatibility. Moving them into private Supabase Storage remains later production hardening.

The deployed REST API supports shared accounts, connections, payments, polls, and chat between phones. Visible clients refresh hosted chat automatically. True server-originated Android alerts while the app is fully stopped still require Firebase Cloud Messaging credentials; Vercel alone cannot wake an Android app. Until FCM is connected, new poll and inbox alerts are delivered when the app is open or reconnects.

## Poll reminder behavior

Dismissed open polls re-prompt after **2 hours**. Voting is either **Yes/No** or creator-defined options; option polls always include **NOTA**.
