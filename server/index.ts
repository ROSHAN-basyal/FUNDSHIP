import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { compare as compareSecret, hash as hashSecret } from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createDatabase, type AppDatabase } from './database.js';
import { initializeLocalDatabase } from './local-database.js';

const require = createRequire(import.meta.url);
// Local copy of the dependency's MIT-licensed UMD build avoids its invalid
// package ESM metadata in strict serverless runtimes.
const { adToBs, bsToAd } = require('./vendor/nepali-date-converter.cjs') as {
  adToBs(adDate: string): string;
  bsToAd(bsDate: string): string;
};

type AuthedRequest = Request & { userId?: string; mustChangePassword?: boolean; mustCreateMpin?: boolean };
type PollOption = { id: string; label: string };

const db = createDatabase();
const app = express();
const legacyHash = (value: string) => createHash('sha256').update(value).digest('hex');
const pad = (value: number) => String(value).padStart(2, '0');
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const asIso = (value: unknown) => value instanceof Date ? value.toISOString() : value;

async function verifySecret(value: string, stored: string | null | undefined) {
  if (!stored) return false;
  return stored.startsWith('$2')
    ? compareSecret(value, stored)
    : legacyHash(value) === stored;
}

async function createSecretHash(value: string) {
  return hashSecret(value, 12);
}

function nativeCalendarChoices() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const label = offset === 0
      ? 'Today'
      : offset === 1
        ? 'Tomorrow'
        : `Coming ${date.toLocaleDateString('en-US', { weekday: 'long' })}`;
    return { label, adDate: localDate(date), bsDate: String(adToBs(localDate(date))) };
  });
}

function threeMonthsAgo() {
  const threshold = new Date();
  threshold.setUTCMonth(threshold.getUTCMonth() - 3);
  return threshold.toISOString();
}

function pair(userOne: string, userTwo: string) {
  return userOne < userTwo ? [userOne, userTwo] : [userTwo, userOne];
}

function pollOptions(row: any): PollOption[] {
  const value = row?.options_json;
  if (!value) return [];
  if (Array.isArray(value)) return value as PollOption[];
  if (typeof value === 'object') return Object.values(value) as PollOption[];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const publicUser = (row: any) => ({
  id: row.id,
  credentialId: row.credential_id,
  name: row.name,
  phone: row.phone,
  avatarColor: row.avatar_color,
  profilePhoto: row.profile_photo,
  mustChangePassword: Boolean(row.must_change_password),
  hasMpin: Boolean(row.mpin_hash),
});

async function areConnected(userOne: string, userTwo: string) {
  if (userOne === userTwo) return true;
  const [userA, userB] = pair(userOne, userTwo);
  return Boolean(await db.get(
    "SELECT 1 FROM connections WHERE user_a=? AND user_b=? AND status='accepted'",
    [userA, userB],
  ));
}

async function connectGroupMembers(client: AppDatabase = db) {
  const pairs = await client.all<any>(`SELECT DISTINCT a.user_id first_id, b.user_id second_id
    FROM group_members a
    JOIN group_members b ON b.group_id=a.group_id AND a.user_id < b.user_id`);
  const now = new Date().toISOString();
  for (const item of pairs) {
    await client.run(
      `INSERT INTO connections (user_a,user_b,requester_id,status,created_at,responded_at)
       VALUES (?,?,?,'accepted',?,?)
       ON CONFLICT(user_a,user_b) DO UPDATE SET status='accepted', responded_at=excluded.responded_at`,
      [item.first_id, item.second_id, item.first_id, now, now],
    );
  }
}

async function addNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  entityId: string,
  persistentUntil?: string | null,
  client: AppDatabase = db,
) {
  await client.run(
    `INSERT INTO app_notifications
      (id,user_id,type,title,body,entity_id,persistent_until,created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,type,entity_id) DO NOTHING`,
    [randomUUID(), userId, type, title, body, entityId, persistentUntil || null, new Date().toISOString()],
  );
}

async function notifyGroup(
  groupId: string,
  type: string,
  title: string,
  body: string,
  entityId: string,
  persistentUntil?: string | null,
) {
  const members = await db.all<{ user_id: string }>(
    'SELECT user_id FROM group_members WHERE group_id=?',
    [groupId],
  );
  for (const member of members) {
    await addNotification(member.user_id, type, title, body, entityId, persistentUntil);
  }
}

async function evaluatePolls() {
  const now = new Date();
  const due = await db.all<any>(
    `SELECT p.*, g.name group_name
     FROM polls p JOIN groups g ON g.id=p.group_id
     WHERE p.status='open' AND p.approval_status='approved' AND p.deadline_at<=?`,
    [now.toISOString()],
  );

  for (const poll of due) {
    const votes = await db.all<any>('SELECT user_id,choice FROM votes WHERE poll_id=?', [poll.id]);
    let confirmed = false;
    let winners: string[] = [];
    let resultLabel = '';

    if (poll.poll_type === 'options') {
      const counts = new Map<string, number>();
      for (const vote of votes) counts.set(vote.choice, (counts.get(vote.choice) || 0) + 1);
      const highest = Math.max(0, ...counts.values());
      winners = [...counts.entries()]
        .filter(([, count]) => count === highest && highest > 0)
        .map(([id]) => id);
      confirmed = votes.length >= Number(poll.min_yes) && winners.length > 0;
      const labels = new Map(pollOptions(poll).map((option) => [option.id, option.label]));
      resultLabel = winners.map((id) => labels.get(id) || id).join(' / ');
    } else {
      const yesCount = votes.filter((vote) => vote.choice === 'yes').length;
      confirmed = yesCount >= Number(poll.min_yes);
      winners = confirmed ? ['yes'] : [];
      resultLabel = confirmed ? 'Yes' : 'Not enough Yes votes';
    }

    const status = confirmed ? 'confirmed' : 'cancelled';
    await db.run(
      'UPDATE polls SET status=?, winning_option=?, result_notified_at=? WHERE id=?',
      [status, winners.join(','), now.toISOString(), poll.id],
    );
    const members = await db.all<{ user_id: string }>(
      'SELECT user_id FROM group_members WHERE group_id=?',
      [poll.group_id],
    );
    for (const member of members) {
      const vote = votes.find((item) => item.user_id === member.user_id)?.choice;
      const won = confirmed && winners.includes(vote);
      if (won) {
        await addNotification(
          member.user_id,
          'event_due',
          `Event due · ${poll.title}`,
          `${poll.bs_date} · ${resultLabel}`,
          poll.id,
          String(asIso(poll.event_at)),
        );
      } else {
        await addNotification(
          member.user_id,
          'poll_result',
          `Poll result · ${poll.title}`,
          confirmed
            ? `${resultLabel} won. Open the poll history for details.`
            : 'The required vote count was not reached.',
          poll.id,
        );
      }
    }
  }
}

async function hydrateNotifications() {
  const pendingPayments = await db.all<any>(`SELECT p.id,p.payer_id,p.amount,p.purpose,u.name sender_name
    FROM payment_requests p JOIN users u ON u.id=p.payee_id WHERE p.status='pending'`);
  for (const payment of pendingPayments) {
    await addNotification(
      payment.payer_id,
      'payment_request',
      `Request from ${payment.sender_name}`,
      `NPR ${payment.amount} · ${payment.purpose}`,
      payment.id,
    );
  }

  const invites = await db.all<any>(`SELECT gi.id,gi.invitee_id,g.name,u.name inviter_name
    FROM group_invites gi
    JOIN groups g ON g.id=gi.group_id
    JOIN users u ON u.id=gi.inviter_id
    WHERE gi.status='pending'`);
  for (const invite of invites) {
    await addNotification(
      invite.invitee_id,
      'group_invite',
      `Group invitation · ${invite.name}`,
      `${invite.inviter_name} invited you to join.`,
      invite.id,
    );
  }

  const pollRequests = await db.all<any>(`SELECT p.id,p.group_id,p.title,u.name creator_name
    FROM polls p JOIN users u ON u.id=p.creator_id
    WHERE p.approval_status='pending' AND p.status='open'`);
  for (const poll of pollRequests) {
    const admins = await db.all<{ user_id: string }>(
      "SELECT user_id FROM group_members WHERE group_id=? AND role='admin'",
      [poll.group_id],
    );
    for (const admin of admins) {
      await addNotification(
        admin.user_id,
        'poll_approval',
        'Poll approval requested',
        `${poll.creator_name}: ${poll.title}`,
        poll.id,
      );
    }
  }

  const requests = await db.all<any>(`SELECT c.user_a,c.user_b,c.requester_id,u.name requester_name
    FROM connections c JOIN users u ON u.id=c.requester_id WHERE c.status='pending'`);
  for (const request of requests) {
    const recipient = request.requester_id === request.user_a ? request.user_b : request.user_a;
    await addNotification(
      recipient,
      'connection_request',
      'New connection request',
      `${request.requester_name} wants to connect.`,
      `${request.user_a}:${request.user_b}`,
    );
  }
}

async function runMaintenance() {
  await connectGroupMembers();
  await db.run(
    'DELETE FROM messages WHERE created_at < ?',
    [new Date(Date.now() - 10 * 86_400_000).toISOString()],
  );
  const pollThreshold = threeMonthsAgo();
  await db.run(
    'DELETE FROM votes WHERE poll_id IN (SELECT id FROM polls WHERE created_at < ?)',
    [pollThreshold],
  );
  await db.run('DELETE FROM polls WHERE created_at < ?', [pollThreshold]);
  await evaluatePolls();
  await hydrateNotifications();
}

async function getBootstrap(userId: string) {
  await runMaintenance();
  const user = await db.get<any>('SELECT * FROM users WHERE id = ?', [userId]);
  const people = (await db.all<any>(`SELECT DISTINCT u.*
    FROM users u JOIN connections c
      ON (c.user_a=? AND c.user_b=u.id) OR (c.user_b=? AND c.user_a=u.id)
    WHERE c.status='accepted' ORDER BY u.name`, [userId, userId])).map(publicUser);

  const groupRows = await db.all<any>(`SELECT g.*, gm.role, gm.position
    FROM groups g JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ? ORDER BY gm.position`, [userId]);
  const groups: any[] = [];

  for (const group of groupRows) {
    const members = (await db.all<any>(`SELECT u.*, gm.role
      FROM users u JOIN group_members gm ON gm.user_id = u.id
      WHERE gm.group_id = ? ORDER BY u.name`, [group.id]))
      .map((row) => ({ ...publicUser(row), role: row.role }));

    const pollRows = await db.all<any>(`SELECT p.*, u.name creator_name
      FROM polls p JOIN users u ON u.id = p.creator_id
      WHERE p.group_id = ? ORDER BY p.created_at DESC`, [group.id]);
    const polls: any[] = [];
    for (const poll of pollRows) {
      const voteDetails = await db.all<any>(`SELECT v.user_id,u.name,u.avatar_color,v.choice,v.created_at
        FROM votes v JOIN users u ON u.id=v.user_id
        WHERE v.poll_id=? ORDER BY v.created_at`, [poll.id]);
      const yesCount = voteDetails.filter((vote) => vote.choice === 'yes').length;
      const noCount = voteDetails.filter((vote) => vote.choice === 'no').length;
      const declineCount = voteDetails.filter((vote) => vote.choice === 'decline').length;
      const myVote = voteDetails.find((vote) => vote.user_id === userId)?.choice;
      polls.push({
        id: poll.id,
        title: poll.title,
        eventAt: asIso(poll.event_at),
        bsDate: poll.bs_date,
        minYes: Number(poll.min_yes),
        deadlineAt: asIso(poll.deadline_at),
        status: poll.status,
        approvalStatus: poll.approval_status,
        deadlineBsDate: String(adToBs(localDate(new Date(poll.deadline_at)))),
        creatorName: poll.creator_name,
        yesCount,
        noCount,
        declineCount,
        myVote,
        creatorId: poll.creator_id,
        pollType: poll.poll_type || 'yes_no',
        options: pollOptions(poll),
        winningOptions: String(poll.winning_option || '').split(',').filter(Boolean),
        voteDetails: voteDetails.map((vote) => ({
          userId: vote.user_id,
          name: vote.name,
          avatarColor: vote.avatar_color,
          choice: vote.choice,
          createdAt: asIso(vote.created_at),
        })),
        canDelete: poll.status === 'open' && (poll.creator_id === userId || group.role === 'admin'),
      });
    }

    const messages = (await db.all<any>(`SELECT m.*, u.name, u.avatar_color
      FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.created_at>=?
      ORDER BY m.created_at ASC LIMIT 80`, [
      group.id,
      new Date(Date.now() - 10 * 86_400_000).toISOString(),
    ])).map((message) => ({
      id: message.id,
      userId: message.user_id,
      name: message.name,
      avatarColor: message.avatar_color,
      body: message.body,
      createdAt: asIso(message.created_at),
    }));

    groups.push({
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      accent: group.accent,
      role: group.role,
      members,
      polls,
      messages,
    });
  }

  const rawPayments = await db.all<any>(`SELECT p.*,
    payer.name payer_name, payer.avatar_color payer_color,
    payee.name payee_name, payee.avatar_color payee_color,
    initiator.name initiator_name
    FROM payment_requests p
    JOIN users payer ON payer.id=p.payer_id
    JOIN users payee ON payee.id=p.payee_id
    JOIN users initiator ON initiator.id=p.initiator_id
    WHERE p.payer_id=? OR p.payee_id=? OR p.initiator_id=?
    ORDER BY p.created_at DESC`, [userId, userId, userId]);
  const payment = (item: any) => ({
    id: item.id,
    initiatorId: item.initiator_id,
    initiatorName: item.initiator_name,
    payerId: item.payer_id,
    payerName: item.payer_name,
    payerColor: item.payer_color,
    payeeId: item.payee_id,
    payeeName: item.payee_name,
    payeeColor: item.payee_color,
    amount: Number(item.amount),
    purpose: item.purpose,
    note: item.note,
    kind: item.kind,
    splitId: item.split_id,
    splitCount: item.split_count === null ? null : Number(item.split_count),
    totalAmount: item.total_amount === null ? null : Number(item.total_amount),
    status: item.status,
    createdAt: asIso(item.created_at),
  });

  const incoming = rawPayments
    .filter((item) => item.payer_id === userId && item.status === 'pending')
    .map(payment);
  const outgoingMap = new Map<string, any>();
  for (const item of rawPayments.filter((row) => row.initiator_id === userId && row.status === 'pending')) {
    const key = item.split_id || item.id;
    if (!outgoingMap.has(key)) outgoingMap.set(key, payment(item));
  }
  const outgoing = [...outgoingMap.values()];

  const balances = new Map<string, { personId: string; name: string; avatarColor: string; amount: number }>();
  for (const item of rawPayments.filter((row) => row.status === 'verified')) {
    if (item.payer_id !== userId && item.payee_id !== userId) continue;
    const otherId = item.payer_id === userId ? item.payee_id : item.payer_id;
    const otherName = item.payer_id === userId ? item.payee_name : item.payer_name;
    const otherColor = item.payer_id === userId ? item.payee_color : item.payer_color;
    const delta = item.payee_id === userId ? Number(item.amount) : -Number(item.amount);
    const current = balances.get(otherId) || {
      personId: otherId,
      name: otherName,
      avatarColor: otherColor,
      amount: 0,
    };
    current.amount += delta;
    balances.set(otherId, current);
  }
  const ledger = [...balances.values()]
    .filter((item) => item.amount !== 0)
    .sort((first, second) => Math.abs(second.amount) - Math.abs(first.amount));
  const owedToYou = ledger.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const youOwe = ledger.reduce((sum, item) => sum + Math.max(0, -item.amount), 0);

  const groupInvites = (await db.all<any>(`SELECT gi.*, g.name group_name, g.emoji, g.accent,
    inviter.name inviter_name
    FROM group_invites gi
    JOIN groups g ON g.id=gi.group_id
    JOIN users inviter ON inviter.id=gi.inviter_id
    WHERE gi.invitee_id=? AND gi.status='pending'
    ORDER BY gi.created_at DESC`, [userId])).map((invite) => ({
      id: invite.id,
      groupId: invite.group_id,
      groupName: invite.group_name,
      emoji: invite.emoji,
      accent: invite.accent,
      inviterName: invite.inviter_name,
      createdAt: asIso(invite.created_at),
    }));
  const transactions = rawPayments
    .filter((item) => item.status === 'verified' && (item.payer_id === userId || item.payee_id === userId))
    .map(payment);
  const connections = (await db.all<any>(`SELECT c.*,u.id other_id,u.credential_id,u.name,u.avatar_color
    FROM connections c JOIN users u
      ON u.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END
    WHERE (c.user_a=? OR c.user_b=?) AND c.status='accepted'
    ORDER BY u.name`, [userId, userId, userId])).map((item) => ({
      id: item.other_id,
      credentialId: item.credential_id,
      name: item.name,
      avatarColor: item.avatar_color,
      connectedAt: asIso(item.responded_at || item.created_at),
    }));
  const connectionRequests = (await db.all<any>(`SELECT c.*,u.id requester_user_id,
    u.credential_id,u.name,u.avatar_color
    FROM connections c JOIN users u ON u.id=c.requester_id
    WHERE (c.user_a=? OR c.user_b=?) AND c.status='pending'
    ORDER BY c.created_at DESC`, [userId, userId])).map((item) => ({
      id: `${item.user_a}:${item.user_b}`,
      requester: {
        id: item.requester_user_id,
        credentialId: item.credential_id,
        name: item.name,
        avatarColor: item.avatar_color,
      },
      outgoing: item.requester_id === userId,
      createdAt: asIso(item.created_at),
    }));
  const notifications = (await db.all<any>(`SELECT * FROM app_notifications
    WHERE user_id=? AND cleared_at IS NULL ORDER BY created_at DESC`, [userId])).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      entityId: item.entity_id,
      persistentUntil: asIso(item.persistent_until),
      read: Boolean(item.read_at),
      nativeDelivered: Boolean(item.native_delivered_at),
      createdAt: asIso(item.created_at),
      canClear: !item.persistent_until || new Date(item.persistent_until).getTime() <= Date.now(),
    }));

  return {
    user: publicUser(user),
    people,
    groups,
    groupInvites,
    payments: { incoming, outgoing },
    transactions,
    ledger,
    totals: { owedToYou, youOwe },
    connections,
    connectionRequests,
    notifications,
    calendarChoices: nativeCalendarChoices(),
  };
}

const ready = initializeLocalDatabase(db).then(runMaintenance);

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(async (_req, _res, next) => {
  try {
    await ready;
    next();
  } catch (error) {
    next(error);
  }
});

async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) {
      res.status(401).json({ error: 'Please sign in.' });
      return;
    }
    const session = await db.get<{ user_id: string; must_change_password: boolean | number; mpin_hash: string | null }>(
      `SELECT s.user_id, u.must_change_password, u.mpin_hash
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token = ?`,
      [token],
    );
    if (!session) {
      res.status(401).json({ error: 'Your session has expired.' });
      return;
    }
    req.userId = session.user_id;
    req.mustChangePassword = Boolean(session.must_change_password);
    req.mustCreateMpin = !session.mpin_hash;
    if (
      req.mustChangePassword
      && req.path !== '/api/bootstrap'
      && req.path !== '/api/auth/change-password'
    ) {
      res.status(428).json({ error: 'Change your initial password before continuing.' });
      return;
    }
    if (
      !req.mustChangePassword
      &&
      req.mustCreateMpin
      && req.path !== '/api/bootstrap'
      && req.path !== '/api/auth/set-mpin'
    ) {
      res.status(428).json({ error: 'Create your MPIN before continuing.' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: db.kind });
});

app.get('/api/cron/maintenance', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  if (isProduction && (!secret || req.header('authorization') !== `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  await runMaintenance();
  res.json({ ok: true, completedAt: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  const { credentialId, password } = req.body ?? {};
  const user = await db.get<any>(
    'SELECT * FROM users WHERE upper(credential_id) = upper(?)',
    [String(credentialId || '')],
  );
  if (!user || !await verifySecret(String(password || ''), user.password_hash)) {
    res.status(401).json({ error: 'That ID or password does not match.' });
    return;
  }
  if (!String(user.password_hash).startsWith('$2')) {
    await db.run(
      'UPDATE users SET password_hash=? WHERE id=?',
      [await createSecretHash(String(password)), user.id],
    );
  }
  const token = randomUUID();
  await db.run(
    'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
    [token, user.id, new Date().toISOString()],
  );
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/change-password', auth, async (req: AuthedRequest, res) => {
  const { oldPassword, newPassword } = req.body ?? {};
  const user = await db.get<any>('SELECT * FROM users WHERE id = ?', [req.userId!]);
  if (!await verifySecret(String(oldPassword || ''), user.password_hash)) {
    res.status(403).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (String(newPassword || '').length < 8) {
    res.status(400).json({ error: 'Use at least 8 characters.' });
    return;
  }
  await db.run(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [await createSecretHash(String(newPassword)), req.userId!],
  );
  res.json({ ok: true });
});

app.post('/api/auth/verify-mpin', auth, async (req: AuthedRequest, res) => {
  const user = await db.get<any>('SELECT mpin_hash FROM users WHERE id = ?', [req.userId!]);
  if (!await verifySecret(String(req.body?.mpin || ''), user?.mpin_hash)) {
    res.status(403).json({ error: 'Incorrect MPIN.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/auth/set-mpin', auth, async (req: AuthedRequest, res) => {
  const newMpin = String(req.body?.newMpin || '');
  if (!/^\d{4}$/.test(newMpin)) {
    res.status(400).json({ error: 'MPIN must be exactly 4 digits.' });
    return;
  }
  const user = await db.get<any>('SELECT mpin_hash FROM users WHERE id=?', [req.userId!]);
  if (user?.mpin_hash) {
    res.status(409).json({ error: 'Your MPIN is already set. Use Change MPIN instead.' });
    return;
  }
  await db.run('UPDATE users SET mpin_hash=? WHERE id=?', [
    await createSecretHash(newMpin),
    req.userId!,
  ]);
  res.json({ ok: true });
});

app.post('/api/auth/change-mpin', auth, async (req: AuthedRequest, res) => {
  const { password, oldMpin, newMpin } = req.body ?? {};
  const user = await db.get<any>('SELECT * FROM users WHERE id=?', [req.userId!]);
  if (
    !await verifySecret(String(password || ''), user.password_hash)
    || !await verifySecret(String(oldMpin || ''), user.mpin_hash)
  ) {
    res.status(403).json({ error: 'Password or old MPIN is incorrect.' });
    return;
  }
  if (!/^\d{4}$/.test(String(newMpin || ''))) {
    res.status(400).json({ error: 'MPIN must be exactly 4 digits.' });
    return;
  }
  await db.run(
    'UPDATE users SET mpin_hash=? WHERE id=?',
    [await createSecretHash(String(newMpin)), req.userId!],
  );
  res.json({ ok: true });
});

app.post('/api/profile', auth, async (req: AuthedRequest, res) => {
  const phone = String(req.body?.phone || '');
  if (!/^9\d{9}$/.test(phone)) {
    res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    return;
  }
  const current = await db.get<any>(
    'SELECT profile_photo FROM users WHERE id=?',
    [req.userId!],
  );
  const profilePhoto = req.body?.profilePhoto === undefined
    ? current?.profile_photo
    : req.body.profilePhoto;
  await db.run(
    'UPDATE users SET phone=?, profile_photo=? WHERE id=?',
    [phone, profilePhoto || null, req.userId!],
  );
  res.json(await getBootstrap(req.userId!));
});

app.get('/api/bootstrap', auth, async (req: AuthedRequest, res) => {
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/calendar/convert', auth, async (req: AuthedRequest, res) => {
  const bsDate = String(req.body?.bsDate || '');
  const time = String(req.body?.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bsDate) || !/^\d{2}:\d{2}$/.test(time)) {
    res.status(400).json({ error: 'Choose a valid BS date and time.' });
    return;
  }
  try {
    const adDate = String(bsToAd(bsDate));
    const eventAt = new Date(`${adDate}T${time}:00`).toISOString();
    if (new Date(eventAt).getTime() <= Date.now()) {
      res.status(400).json({ error: 'Choose an event time in the future.' });
      return;
    }
    res.json({ eventAt, bsDate });
  } catch {
    res.status(400).json({ error: 'That BS date is not valid.' });
  }
});

app.post('/api/groups', auth, async (req: AuthedRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const emoji = String(req.body?.emoji || '👥').slice(0, 8);
  const inviteeIds = Array.isArray(req.body?.inviteeIds) ? req.body.inviteeIds.map(String) : [];
  if (name.length < 2) {
    res.status(400).json({ error: 'Give your group a name.' });
    return;
  }
  const groupId = randomUUID();
  const palette = ['#dc704b', '#568a78', '#5d77a6', '#9b665e'];
  const inviter = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO groups (id,name,emoji,accent) VALUES (?,?,?,?)',
      [groupId, name, emoji, palette[Math.floor(Math.random() * palette.length)]],
    );
    await tx.run(
      'INSERT INTO group_members (group_id,user_id,role,position) VALUES (?,?,?,?)',
      [groupId, req.userId!, 'admin', 99],
    );
    for (const inviteeId of inviteeIds) {
      const inviteId = randomUUID();
      await tx.run(
        'INSERT INTO group_invites (id,group_id,inviter_id,invitee_id,status,created_at) VALUES (?,?,?,?,?,?)',
        [inviteId, groupId, req.userId!, inviteeId, 'pending', new Date().toISOString()],
      );
      await addNotification(
        inviteeId,
        'group_invite',
        `Group invitation · ${name}`,
        `${inviter?.name || 'A connection'} invited you to join.`,
        inviteId,
        null,
        tx,
      );
    }
  });
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/group-invites/:id/respond', auth, async (req: AuthedRequest, res) => {
  const inviteId = String(req.params.id);
  const invite = await db.get<any>(
    "SELECT * FROM group_invites WHERE id=? AND invitee_id=? AND status='pending'",
    [inviteId, req.userId!],
  );
  if (!invite) {
    res.status(404).json({ error: 'Invitation not found.' });
    return;
  }
  const accept = Boolean(req.body?.accept);
  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE group_invites SET status=? WHERE id=?',
      [accept ? 'accepted' : 'declined', inviteId],
    );
    if (accept) {
      await tx.run(
        `INSERT INTO group_members (group_id,user_id,role,position)
         VALUES (?,?,'member',99) ON CONFLICT(group_id,user_id) DO NOTHING`,
        [invite.group_id, req.userId!],
      );
    }
    await tx.run(
      "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='group_invite' AND entity_id=?",
      [new Date().toISOString(), req.userId!, inviteId],
    );
  });
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/payments/lend', auth, async (req: AuthedRequest, res) => {
  const { borrowerId, amount, purpose, note } = req.body ?? {};
  if (!borrowerId || Number(amount) <= 0 || !String(purpose || '').trim()) {
    res.status(400).json({ error: 'Person, amount, and purpose are required.' });
    return;
  }
  if (borrowerId === req.userId! || !await areConnected(req.userId!, String(borrowerId))) {
    res.status(403).json({ error: 'You can only request money from a connection.' });
    return;
  }
  const requestId = randomUUID();
  await db.run(
    `INSERT INTO payment_requests
      (id, initiator_id, payer_id, payee_id, amount, purpose, note, kind, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'lend', 'pending', ?)`,
    [
      requestId,
      req.userId!,
      String(borrowerId),
      req.userId!,
      Math.round(Number(amount)),
      String(purpose).trim(),
      note || null,
      new Date().toISOString(),
    ],
  );
  const sender = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await addNotification(
    String(borrowerId),
    'payment_request',
    `Request from ${sender?.name || 'A connection'}`,
    `NPR ${Math.round(Number(amount))} · ${String(purpose).trim()}`,
    requestId,
  );
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/payments/split', auth, async (req: AuthedRequest, res) => {
  const { purpose, totalAmount, participants, mode } = req.body ?? {};
  const entries = Array.isArray(participants) ? participants : [];
  if (!String(purpose || '').trim() || Number(totalAmount) <= 0 || entries.length < 2) {
    res.status(400).json({ error: 'Add a purpose, amount, and at least two participants.' });
    return;
  }
  const total = Math.round(Number(totalAmount));
  const participantIds = entries.map((entry: any) => String(entry?.userId || ''));
  if (new Set(participantIds).size !== participantIds.length || !participantIds.includes(req.userId!)) {
    res.status(400).json({ error: 'Each participant must appear once, including you.' });
    return;
  }
  const connectionChecks = await Promise.all(
    participantIds.map((id: string) => id ? areConnected(req.userId!, id) : Promise.resolve(false)),
  );
  if (connectionChecks.some((connected) => !connected)) {
    res.status(403).json({ error: 'Every participant must be one of your connections.' });
    return;
  }
  if (total < entries.length) {
    res.status(400).json({ error: 'The total must allow at least NPR 1 per participant.' });
    return;
  }
  const manualAmounts = entries.map((entry: any) => Math.round(Number(entry?.amount || 0)));
  if (
    mode === 'manual'
    && (
      manualAmounts.some((amount: number) => amount <= 0)
      || manualAmounts.reduce((sum: number, amount: number) => sum + amount, 0) !== total
    )
  ) {
    res.status(400).json({ error: 'Manual shares must be positive and add up to the total.' });
    return;
  }

  const splitId = randomUUID();
  const equalShare = Math.floor(total / entries.length);
  const sender = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await db.transaction(async (tx) => {
    for (const [index, entry] of entries.entries()) {
      const amount = mode === 'manual'
        ? Math.round(Number(entry.amount || 0))
        : equalShare + (index === 0 ? total - equalShare * entries.length : 0);
      const requestId = randomUUID();
      await tx.run(
        `INSERT INTO payment_requests
          (id, initiator_id, payer_id, payee_id, amount, purpose, note, kind,
           split_id, split_count, total_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'split', ?, ?, ?, 'pending', ?)`,
        [
          requestId,
          req.userId!,
          entry.userId,
          req.userId!,
          amount,
          String(purpose).trim(),
          entry.note || null,
          splitId,
          entries.length,
          total,
          new Date().toISOString(),
        ],
      );
      await addNotification(
        entry.userId,
        'payment_request',
        `Request from ${sender?.name || 'A connection'}`,
        `NPR ${amount} · ${String(purpose).trim()}`,
        requestId,
        null,
        tx,
      );
    }
  });
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/payments/:id/verify', auth, async (req: AuthedRequest, res) => {
  const paymentId = String(req.params.id);
  const result = await db.run(
    "UPDATE payment_requests SET status='verified', verified_at=? WHERE id=? AND payer_id=? AND status='pending'",
    [new Date().toISOString(), paymentId, req.userId!],
  );
  if (!result.changes) {
    res.status(404).json({ error: 'Pending request not found.' });
    return;
  }
  await db.run(
    "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='payment_request' AND entity_id=?",
    [new Date().toISOString(), req.userId!, paymentId],
  );
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/payments/verify-all', auth, async (req: AuthedRequest, res) => {
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE payment_requests SET status='verified', verified_at=? WHERE payer_id=? AND status='pending'",
      [new Date().toISOString(), req.userId!],
    );
    await tx.run(
      "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='payment_request'",
      [new Date().toISOString(), req.userId!],
    );
  });
  res.json(await getBootstrap(req.userId!));
});

app.delete('/api/payments/:id', auth, async (req: AuthedRequest, res) => {
  const paymentId = String(req.params.id);
  const row = await db.get<any>(
    'SELECT * FROM payment_requests WHERE id=? AND initiator_id=?',
    [paymentId, req.userId!],
  );
  if (!row) {
    res.status(404).json({ error: 'Request not found.' });
    return;
  }
  if (row.status !== 'verified') {
    res.status(409).json({ error: 'Only verified requests can be removed.' });
    return;
  }
  await db.run('DELETE FROM payment_requests WHERE id=?', [paymentId]);
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/polls/:id/vote', auth, async (req: AuthedRequest, res) => {
  const pollId = String(req.params.id);
  const choice = String(req.body?.choice || '');
  const poll = await db.get<any>(
    "SELECT * FROM polls WHERE id=? AND status='open' AND approval_status='approved'",
    [pollId],
  );
  if (!poll) {
    res.status(404).json({ error: 'This poll is no longer open.' });
    return;
  }
  const member = await db.get(
    'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?',
    [poll.group_id, req.userId!],
  );
  if (!member) {
    res.status(403).json({ error: 'Only group members can vote in this poll.' });
    return;
  }
  if (new Date(poll.deadline_at).getTime() <= Date.now()) {
    res.status(409).json({ error: 'Voting has closed.' });
    return;
  }
  const validChoices = poll.poll_type === 'options'
    ? pollOptions(poll).map((option) => option.id)
    : ['yes', 'no'];
  if (!validChoices.includes(choice)) {
    res.status(400).json({ error: 'Choose one of the available options.' });
    return;
  }
  await db.run(
    `INSERT INTO votes (poll_id,user_id,choice,reply,created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(poll_id,user_id) DO UPDATE SET
       choice=excluded.choice,reply=excluded.reply,created_at=excluded.created_at`,
    [pollId, req.userId!, choice, null, new Date().toISOString()],
  );
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/polls/:id/approve', auth, async (req: AuthedRequest, res) => {
  const pollId = String(req.params.id);
  const poll = await db.get<any>(
    'SELECT group_id FROM polls WHERE id=? AND approval_status=?',
    [pollId, 'pending'],
  );
  if (!poll) {
    res.status(404).json({ error: 'Poll request not found.' });
    return;
  }
  const admin = await db.get(
    "SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'",
    [poll.group_id, req.userId!],
  );
  if (!admin) {
    res.status(403).json({ error: 'Only a group admin can approve this poll.' });
    return;
  }
  await db.run("UPDATE polls SET approval_status='approved' WHERE id=?", [pollId]);
  await db.run(
    "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='poll_approval' AND entity_id=?",
    [new Date().toISOString(), req.userId!, pollId],
  );
  const details = await db.get<any>(`SELECT p.title,g.name group_name
    FROM polls p JOIN groups g ON g.id=p.group_id WHERE p.id=?`, [pollId]);
  await notifyGroup(
    poll.group_id,
    'poll_open',
    `New poll · ${details.group_name}`,
    details.title,
    pollId,
  );
  res.json(await getBootstrap(req.userId!));
});

app.delete('/api/polls/:id', auth, async (req: AuthedRequest, res) => {
  const pollId = String(req.params.id);
  const poll = await db.get<any>('SELECT * FROM polls WHERE id=?', [pollId]);
  if (!poll || poll.status !== 'open') {
    res.status(404).json({ error: 'Live poll not found.' });
    return;
  }
  const admin = await db.get(
    "SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'",
    [poll.group_id, req.userId!],
  );
  if (poll.creator_id !== req.userId! && !admin) {
    res.status(403).json({ error: 'Only the creator or an admin can delete this poll.' });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM votes WHERE poll_id=?', [pollId]);
    await tx.run('DELETE FROM app_notifications WHERE entity_id=?', [pollId]);
    await tx.run('DELETE FROM polls WHERE id=?', [pollId]);
  });
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/groups/:id/messages', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const body = String(req.body?.body || '').trim();
  if (!body) {
    res.status(400).json({ error: 'Write a message first.' });
    return;
  }
  const member = await db.get(
    'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?',
    [groupId, req.userId!],
  );
  if (!member) {
    res.status(403).json({ error: 'You are not in this group.' });
    return;
  }
  await db.run(
    'INSERT INTO messages (id,group_id,user_id,body,created_at) VALUES (?,?,?,?,?)',
    [randomUUID(), groupId, req.userId!, body.slice(0, 2000), new Date().toISOString()],
  );
  res.status(201).json(await getBootstrap(req.userId!));
});

app.get('/api/groups/:id/messages', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const member = await db.get(
    'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?',
    [groupId, req.userId!],
  );
  if (!member) {
    res.status(403).json({ error: 'You are not in this group.' });
    return;
  }
  const messages = await db.all<any>(
    `SELECT m.*, u.name, u.avatar_color
     FROM messages m JOIN users u ON u.id=m.user_id
     WHERE m.group_id=? AND m.created_at>=?
     ORDER BY m.created_at ASC LIMIT 200`,
    [groupId, new Date(Date.now() - 10 * 86_400_000).toISOString()],
  );
  res.json({
    messages: messages.map((message) => ({
      id: message.id,
      userId: message.user_id,
      name: message.name,
      avatarColor: message.avatar_color,
      body: message.body,
      createdAt: asIso(message.created_at),
    })),
  });
});

app.post('/api/groups/:id/polls', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const member = await db.get<any>(
    'SELECT role FROM group_members WHERE group_id=? AND user_id=?',
    [groupId, req.userId!],
  );
  if (!member) {
    res.status(403).json({ error: 'You are not in this group.' });
    return;
  }
  const { title, eventAt, bsDate, minYes, deadlineHours, pollType } = req.body ?? {};
  if (!title || !eventAt || Number(minYes) < 1) {
    res.status(400).json({ error: 'Complete the poll details.' });
    return;
  }
  const countRow = await db.get<{ count: number | string }>(
    'SELECT COUNT(*) count FROM group_members WHERE group_id=?',
    [groupId],
  );
  const memberCount = Number(countRow?.count || 0);
  if (!Number.isInteger(Number(minYes)) || Number(minYes) > memberCount) {
    res.status(400).json({ error: 'Required votes cannot exceed the group size.' });
    return;
  }
  const eventTime = new Date(eventAt).getTime();
  if (!Number.isFinite(eventTime) || eventTime <= Date.now()) {
    res.status(400).json({ error: 'Choose an event time in the future.' });
    return;
  }
  const allowedDeadlines = [3, 6, 12, 24, 48, 72, 168];
  const deadlineOffset = Number(deadlineHours || 24);
  if (!allowedDeadlines.includes(deadlineOffset)) {
    res.status(400).json({ error: 'Choose one of the available voting deadlines.' });
    return;
  }
  const deadlineAt = new Date(eventTime - deadlineOffset * 3_600_000).toISOString();
  if (new Date(deadlineAt).getTime() <= Date.now()) {
    res.status(400).json({ error: 'The voting deadline must still be in the future.' });
    return;
  }
  const type = pollType === 'options' ? 'options' : 'yes_no';
  const supplied: string[] = Array.isArray(req.body?.options)
    ? req.body.options.map((value: any) => String(value).trim()).filter(Boolean)
    : [];
  const labels = [...new Set(supplied.filter((value) => value.toLowerCase() !== 'nota'))];
  if (type === 'options' && labels.length < 2) {
    res.status(400).json({ error: 'Add at least two choices; NOTA is included automatically.' });
    return;
  }
  const options = type === 'options'
    ? [
      ...labels.map((label, index) => ({ id: `option_${index + 1}`, label })),
      { id: 'nota', label: 'NOTA' },
    ]
    : [];
  const pollId = randomUUID();
  await db.run(
    `INSERT INTO polls
      (id,group_id,creator_id,title,event_at,bs_date,min_yes,deadline_at,status,
       approval_status,created_at,poll_type,options_json)
     VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?)`,
    [
      pollId,
      groupId,
      req.userId!,
      String(title).trim(),
      new Date(eventAt).toISOString(),
      bsDate || 'Date not set',
      Number(minYes),
      deadlineAt,
      member.role === 'admin' ? 'approved' : 'pending',
      new Date().toISOString(),
      type,
      JSON.stringify(options),
    ],
  );
  if (member.role === 'admin') {
    const details = await db.get<any>('SELECT name FROM groups WHERE id=?', [groupId]);
    await notifyGroup(
      groupId,
      'poll_open',
      `New poll · ${details.name}`,
      String(title).trim(),
      pollId,
    );
  } else {
    const creator = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
    const admins = await db.all<{ user_id: string }>(
      "SELECT user_id FROM group_members WHERE group_id=? AND role='admin'",
      [groupId],
    );
    for (const admin of admins) {
      await addNotification(
        admin.user_id,
        'poll_approval',
        'Poll approval requested',
        `${creator.name}: ${String(title).trim()}`,
        pollId,
      );
    }
  }
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/connections/request', auth, async (req: AuthedRequest, res) => {
  const credentialId = String(req.body?.credentialId || '').trim();
  const target = await db.get<any>(
    'SELECT * FROM users WHERE upper(credential_id)=upper(?)',
    [credentialId],
  );
  if (!target) {
    res.status(404).json({ error: 'No user was found with that ID.' });
    return;
  }
  if (target.id === req.userId!) {
    res.status(400).json({ error: 'You cannot connect to your own account.' });
    return;
  }
  const [userA, userB] = pair(req.userId!, target.id);
  const existing = await db.get<any>(
    'SELECT * FROM connections WHERE user_a=? AND user_b=?',
    [userA, userB],
  );
  if (existing?.status === 'accepted') {
    res.status(409).json({ error: 'You are already connected.' });
    return;
  }
  if (existing?.status === 'pending') {
    res.status(409).json({ error: 'A connection request is already pending.' });
    return;
  }
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO connections
      (user_a,user_b,requester_id,status,created_at,responded_at)
     VALUES (?,?,?,'pending',?,NULL)
     ON CONFLICT(user_a,user_b) DO UPDATE SET
       requester_id=excluded.requester_id,status='pending',
       created_at=excluded.created_at,responded_at=NULL`,
    [userA, userB, req.userId!, now],
  );
  const sender = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await addNotification(
    target.id,
    'connection_request',
    'New connection request',
    `${sender.name} wants to connect.`,
    `${userA}:${userB}`,
  );
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/connections/:id/respond', auth, async (req: AuthedRequest, res) => {
  const [rawA, rawB] = String(req.params.id).split(':');
  const [userA, userB] = pair(rawA || '', rawB || '');
  const connection = await db.get<any>(
    "SELECT * FROM connections WHERE user_a=? AND user_b=? AND status='pending'",
    [userA, userB],
  );
  if (
    !connection
    || connection.requester_id === req.userId!
    || ![userA, userB].includes(req.userId!)
  ) {
    res.status(404).json({ error: 'Connection request not found.' });
    return;
  }
  const accept = Boolean(req.body?.accept);
  await db.run(
    'UPDATE connections SET status=?,responded_at=? WHERE user_a=? AND user_b=?',
    [accept ? 'accepted' : 'declined', new Date().toISOString(), userA, userB],
  );
  await db.run(
    "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='connection_request' AND entity_id=?",
    [new Date().toISOString(), req.userId!, `${userA}:${userB}`],
  );
  if (accept) {
    await addNotification(
      connection.requester_id,
      'connection_accepted',
      'Connection accepted',
      'You can now send individual and group payment requests.',
      `${userA}:${userB}`,
    );
  }
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/notifications/read', auth, async (req: AuthedRequest, res) => {
  await db.run(
    'UPDATE app_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND cleared_at IS NULL',
    [new Date().toISOString(), req.userId!],
  );
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/notifications/:id/delivered', auth, async (req: AuthedRequest, res) => {
  await db.run(
    'UPDATE app_notifications SET native_delivered_at=COALESCE(native_delivered_at,?) WHERE id=? AND user_id=?',
    [new Date().toISOString(), String(req.params.id), req.userId!],
  );
  res.json({ ok: true });
});

app.delete('/api/notifications/:id', auth, async (req: AuthedRequest, res) => {
  const item = await db.get<any>(
    'SELECT * FROM app_notifications WHERE id=? AND user_id=? AND cleared_at IS NULL',
    [String(req.params.id), req.userId!],
  );
  if (!item) {
    res.status(404).json({ error: 'Notification not found.' });
    return;
  }
  if (item.persistent_until && new Date(item.persistent_until).getTime() > Date.now()) {
    res.status(409).json({ error: 'This event reminder stays until the event begins.' });
    return;
  }
  await db.run(
    'UPDATE app_notifications SET cleared_at=? WHERE id=?',
    [new Date().toISOString(), item.id],
  );
  res.json(await getBootstrap(req.userId!));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 8787);
  ready
    .then(() => app.listen(port, () => {
      console.log(`FUNDSHIP API listening on http://localhost:${port} (${db.kind})`);
    }))
    .catch((error) => {
      console.error('FUNDSHIP API failed to start:', error);
      process.exitCode = 1;
    });
}

export default app;
