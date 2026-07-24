# FUNDSHIP performance architecture

## Goals

This redesign targets the latency a user feels, not only server benchmark numbers.

- Show a signed-in Android user's last verified screen in under 100 ms after process start.
- Keep an unchanged foreground sync to an authentication lookup plus one indexed revision lookup.
- Keep snapshot query count constant as groups and polls grow; no per-group or per-poll queries.
- Transfer only new chat messages after the initial page load.
- Remove schema changes, demo cleanup, connection backfills, and retention cleanup from interactive requests.
- Preserve the existing API and UI while the faster sync protocol is rolled out.
- Keep the system within the Vercel and Supabase free tiers: one database, one API deployment, no Redis or queue dependency.

Baseline measurements from Nepal on 2026-07-24 showed a warm health request around
360 ms. Response routing also showed that Vercel execution was in `iad1` (Washington,
D.C.). The production database region must be confirmed before pinning the function
region: the function should execute close to the database, while the Android cache
hides most user-to-server round-trip time.

## Previous request path

The previous bootstrap path did all of the following synchronously:

1. delete demo data;
2. backfill group connections;
3. evaluate overdue polls;
4. query account state;
5. query each group's members, invitations, polls, and messages;
6. query every poll's votes;
7. return the complete account after almost every mutation.

This made database round trips grow with the number of groups and polls. Android then
rebuilt the complete screen. Every attached group page also downloaded up to 200 chat
messages every five seconds. The web client downloaded the complete account every
eight seconds.

## Target topology

```text
Android UI
  ├─ private last-known snapshot (instant startup)
  ├─ optimistic/current screen state
  └─ revision + chat cursors
          │ HTTPS
          ▼
Vercel function (thin authorization and domain rules)
  ├─ GET /sync?after=<revision> → unchanged or one new snapshot
  ├─ cursor-based chat reads
  ├─ minimal responses for high-frequency writes
  └─ fixed-query snapshot assembler
          │ transaction-pooler connection
          ▼
Supabase Postgres
  ├─ normalized source-of-truth tables
  ├─ user_sync_state revision per affected user
  ├─ route-specific indexes
  └─ migrations/retention jobs outside interactive requests
```

## Sync contract

Each user has a monotonically increasing `revision`.

- A mutation increments every affected user's revision in the same logical operation.
- `GET /api/sync?after=N` first reads only the caller's revision.
- If it is not newer than `N`, the response is `{ "changed": false, "revision": N }`.
- If it is newer, the response includes `{ "changed": true, "revision": R, "snapshot": ... }`.
- Bootstrap snapshots also carry `revision`, so clients can transition without a second request.
- Deletions are visible because the revision changes even when no remaining row has a newer timestamp.

Android treats its private cached snapshot as a read-only local source for rendering.
The server remains authoritative. Sensitive writes still require authentication and
the existing biometric/MPIN flow.

## Database rules

- Production schema changes are SQL migrations, never request middleware.
- Interactive code does not perform retention cleanup or repair old data.
- Snapshot assembly uses a fixed set of batched queries and in-memory grouping.
- Group mutations update all current members' revisions.
- Payment mutations update payer, payee, and initiator revisions.
- Notifications update their recipient's revision.
- Accepted group membership creates only the missing connections for that group.
- The transaction pooler remains in transaction mode with prepared statements off.

## Poll deadlines and maintenance

Poll evaluation is correctness-critical. A lightweight, indexed due-poll check is
throttled in interactive sync and also run by the scheduled maintenance route.
Expensive retention, notification hydration, historical backfills, and data repair
run only in maintenance or migrations. This avoids placing unrelated cleanup on login.

## Deployment

- Enable Vercel Fluid Compute.
- Use the Supabase transaction-pooler URL on port 6543.
- Keep a small configurable database pool per warm function.
- Pin one Vercel region only after identifying the Supabase project region; Hobby
  supports a single selected function region.
- Use `Server-Timing` and request IDs to distinguish user-network latency, function
  cold starts, authentication, and snapshot work.

## Rollout phases

1. Add revision state and indexes with a backward-compatible migration.
2. Replace N+1 snapshot assembly and remove request-time migration/repair.
3. Add `/sync`, cursor chat, and minimal high-frequency responses.
4. Add Android snapshot persistence and lifecycle-aware non-overlapping sync.
5. Move the web fallback to cached revision sync.
6. Run correctness, migration, load-shape, Android lint/unit, and production smoke tests.
7. Deploy, measure cold/warm paths, then pin Vercel to the confirmed database region.

## Non-goals for this phase

- Redis is not required at beta scale.
- WebSockets are not required to make the app responsive; foreground delta sync is
  simpler and more reliable under free-tier sleep/cold-start constraints.
- Direct mobile database access is not introduced. Authorization and domain rules
  stay in the API.
