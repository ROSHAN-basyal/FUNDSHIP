import { createHash } from 'node:crypto';
import type { AppDatabase } from './database.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const isoAfter = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const isoBefore = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, credential_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    phone TEXT, password_hash TEXT NOT NULL, mpin_hash TEXT,
    must_change_password INTEGER DEFAULT 1, avatar_color TEXT NOT NULL,
    profile_photo TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, accent TEXT NOT NULL,
    members_can_invite INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id), user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member', position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS group_invites (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), inviter_id TEXT NOT NULL REFERENCES users(id),
    invitee_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), creator_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL, event_at TEXT NOT NULL, bs_date TEXT NOT NULL, min_yes INTEGER NOT NULL,
    deadline_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', approval_status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL, poll_type TEXT NOT NULL DEFAULT 'yes_no', options_json TEXT,
    winning_option TEXT, result_notified_at TEXT
  );
  CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(id), user_id TEXT NOT NULL REFERENCES users(id),
    choice TEXT NOT NULL, reply TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (poll_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_requests (
    id TEXT PRIMARY KEY, initiator_id TEXT NOT NULL REFERENCES users(id), payer_id TEXT NOT NULL REFERENCES users(id),
    payee_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, purpose TEXT NOT NULL,
    note TEXT, kind TEXT NOT NULL, split_id TEXT, split_count INTEGER, total_amount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, verified_at TEXT
  );
  CREATE TABLE IF NOT EXISTS connections (
    user_a TEXT NOT NULL REFERENCES users(id), user_b TEXT NOT NULL REFERENCES users(id),
    requester_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, responded_at TEXT, PRIMARY KEY (user_a, user_b)
  );
  CREATE TABLE IF NOT EXISTS app_notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, entity_id TEXT NOT NULL,
    persistent_until TEXT, read_at TEXT, cleared_at TEXT, native_delivered_at TEXT, created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS notification_entity_user_type
    ON app_notifications(user_id, type, entity_id);
  CREATE TABLE IF NOT EXISTS user_sync_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS group_members_group_role_idx
    ON group_members(group_id, role, user_id);
  CREATE INDEX IF NOT EXISTS group_invites_group_status_created_idx
    ON group_invites(group_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS polls_group_status_created_idx
    ON polls(group_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS votes_user_poll_idx ON votes(user_id, poll_id);
  CREATE INDEX IF NOT EXISTS messages_group_cursor_idx
    ON messages(group_id, created_at, id);
  CREATE INDEX IF NOT EXISTS connections_user_a_status_idx
    ON connections(user_a, status, user_b);
  CREATE INDEX IF NOT EXISTS connections_user_b_status_idx
    ON connections(user_b, status, user_a);
  CREATE INDEX IF NOT EXISTS payment_requests_payee_status_idx
    ON payment_requests(payee_id, status, created_at DESC);
`;

async function ensureColumn(db: AppDatabase, table: string, column: string, definition: string) {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function dropColumnIfExists(db: AppDatabase, table: string, column: string) {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export async function initializeLocalDatabase(db: AppDatabase) {
  // Production schema is managed exclusively by versioned Supabase migrations.
  if (db.kind === 'postgres') return;

  await db.exec(sqliteSchema);
  await dropColumnIfExists(db, 'users', 'esewa_qr');
  await ensureColumn(db, 'groups', 'members_can_invite', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'polls', 'poll_type', "TEXT NOT NULL DEFAULT 'yes_no'");
  await ensureColumn(db, 'polls', 'options_json', 'TEXT');
  await ensureColumn(db, 'polls', 'winning_option', 'TEXT');
  await ensureColumn(db, 'polls', 'result_notified_at', 'TEXT');
  const includeDemoGroups = process.env.SAJILO_SEED_DEMO_GROUPS === 'true';

  const userCount = await db.get<{ count: number }>('SELECT COUNT(*) count FROM users');
  if (Number(userCount?.count || 0) > 0) return;

  await db.transaction(async (tx) => {
    const addUser = `INSERT INTO users
      (id, credential_id, name, phone, password_hash, mpin_hash, must_change_password, avatar_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await tx.run(addUser, ['u1', 'RB-001', 'Roshan Basyal', '9800000001', hash('12345678'), hash('2580'), 0, '#e7864a']);
    await tx.run(addUser, ['u2', 'NP-002', 'Nawaraj Poudel', '9800000002', hash('123456789'), hash('1470'), 0, '#687fbc']);
    await tx.run(addUser, ['u3', 'SA-003', 'Sujata Aryal', '9800000003', hash('welcome123'), hash('3690'), 0, '#b76475']);
    await tx.run(addUser, ['u4', 'KS-004', 'Kiran Shrestha', '9800000004', hash('welcome123'), hash('4560'), 0, '#4c9686']);
    await tx.run(addUser, ['u5', 'AP-005', 'Anish Pandey', '9800000005', hash('welcome123'), hash('7890'), 0, '#a779b8']);
    for (const userId of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      await tx.run(
        'INSERT INTO user_sync_state (user_id,revision,updated_at) VALUES (?,?,?)',
        [userId, 1, new Date().toISOString()],
      );
    }

    if (!includeDemoGroups) return;

    const addGroup = 'INSERT INTO groups (id, name, emoji, accent) VALUES (?, ?, ?, ?)';
    await tx.run(addGroup, ['g1', 'Weekend Crew', '⛰️', '#dc704b']);
    await tx.run(addGroup, ['g2', 'Office Lunch', '🥟', '#568a78']);
    await tx.run(addGroup, ['g3', 'Cycling Circle', '🚲', '#5d77a6']);

    const addMember = 'INSERT INTO group_members (group_id, user_id, role, position) VALUES (?, ?, ?, ?)';
    for (const member of [
      ['g1', 'u1', 'admin', 0], ['g1', 'u2', 'member', 0], ['g1', 'u3', 'member', 0],
      ['g1', 'u4', 'member', 0], ['g1', 'u5', 'member', 0], ['g2', 'u1', 'member', 1],
      ['g2', 'u2', 'admin', 1], ['g2', 'u3', 'member', 1], ['g2', 'u4', 'member', 1],
      ['g3', 'u5', 'admin', 0],
    ]) {
      await tx.run(addMember, member);
    }

    await tx.run(
      'INSERT INTO group_invites (id,group_id,inviter_id,invitee_id,status,created_at) VALUES (?,?,?,?,?,?)',
      ['invite1', 'g3', 'u5', 'u1', 'pending', isoBefore(30)],
    );
    await tx.run(
      `INSERT INTO polls
        (id, group_id, creator_id, title, event_at, bs_date, min_yes, deadline_at, status, approval_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['poll1', 'g1', 'u1', 'Hike to Shivapuri?', isoAfter(93), '९ साउन २०८३', 4, isoAfter(69), 'open', 'approved', isoBefore(3)],
    );

    const addVote = 'INSERT INTO votes (poll_id, user_id, choice, reply, created_at) VALUES (?, ?, ?, ?, ?)';
    await tx.run(addVote, ['poll1', 'u1', 'yes', null, isoBefore(3)]);
    await tx.run(addVote, ['poll1', 'u2', 'yes', null, isoBefore(2)]);
    await tx.run(addVote, ['poll1', 'u3', 'yes', null, isoBefore(1)]);

    const addMessage = 'INSERT INTO messages (id, group_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)';
    await tx.run(addMessage, ['m1', 'g1', 'u2', 'Shivapuri sounds perfect! Early start?', isoBefore(4)]);
    await tx.run(addMessage, ['m2', 'g1', 'u1', 'Yes, meet at Budhanilkantha gate at 7?', isoBefore(3.5)]);
    await tx.run(addMessage, ['m3', 'g1', 'u3', 'I’ll bring some snacks 🙌', isoBefore(2)]);
    await tx.run(addMessage, ['m4', 'g2', 'u4', 'Momo or thakali for Friday?', isoBefore(21)]);
    await tx.run(addMessage, ['m5', 'g2', 'u2', 'I vote thakali this week!', isoBefore(18)]);

    const addPayment = `INSERT INTO payment_requests
      (id, initiator_id, payer_id, payee_id, amount, purpose, note, kind, split_id, split_count, total_amount, status, created_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await tx.run(addPayment, ['p1', 'u1', 'u2', 'u1', 1850, 'Dinner at Thamel', 'Your share', 'lend', null, null, null, 'verified', isoBefore(240), isoBefore(220)]);
    await tx.run(addPayment, ['p2', 'u3', 'u1', 'u3', 640, 'Cab to airport', null, 'lend', null, null, null, 'verified', isoBefore(120), isoBefore(110)]);
    await tx.run(addPayment, ['p3', 'u1', 'u4', 'u1', 420, 'Coffee & snacks', null, 'lend', null, null, null, 'pending', isoBefore(6), null]);
    await tx.run(addPayment, ['p4', 'u2', 'u1', 'u2', 900, 'Futsal booking', 'Tuesday game', 'split', 's1', 5, 4500, 'pending', isoBefore(2), null]);
    await tx.run(addPayment, ['p5', 'u1', 'u5', 'u1', 750, 'Movie tickets', null, 'lend', null, null, null, 'pending', isoBefore(28), null]);
    await tx.run(addPayment, ['p6', 'u1', 'u3', 'u1', 510, 'Lunch', 'Dal bhat', 'lend', null, null, null, 'verified', isoBefore(480), isoBefore(470)]);
  });
}
