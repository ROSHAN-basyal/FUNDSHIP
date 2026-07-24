import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { compare as compareSecret, hash as hashSecret } from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createDatabase, type AppDatabase } from './database.js';
import { initializeLocalDatabase } from './local-database.js';

const require = createRequire(import.meta.url);
// Local copy of the dependency's MIT-licensed UMD build avoids its invalid
// package ESM metadata in strict serverless runtimes.
type DateConverter = {
  adToBs(adDate: string): string;
  bsToAd(bsDate: string): string;
};
let dateConverter: DateConverter | undefined;
const converter = () => dateConverter ??= require('./vendor/nepali-date-converter.cjs') as DateConverter;
const adToBs = (value: string) => converter().adToBs(value);
const bsToAd = (value: string) => converter().bsToAd(value);

type AuthedRequest = Request & {
  userId?: string;
  sessionToken?: string;
  mustChangePassword?: boolean;
  mustCreateMpin?: boolean;
};
type PollOption = { id: string; label: string };

let database: AppDatabase | undefined;
const getDatabase = () => database ??= createDatabase();
const rawDb: AppDatabase = {
  get kind() { return getDatabase().kind; },
  all: (query, params) => getDatabase().all(query, params),
  get: (query, params) => getDatabase().get(query, params),
  run: (query, params) => getDatabase().run(query, params),
  exec: (query) => getDatabase().exec(query),
  transaction: (work) => getDatabase().transaction(work),
  close: () => getDatabase().close(),
};
type QueryMetrics = { count: number; durationMs: number };
const queryMetrics = new AsyncLocalStorage<QueryMetrics>();
async function measureQuery<T>(work: () => Promise<T>) {
  const started = process.hrtime.bigint();
  try {
    return await work();
  } finally {
    const metrics = queryMetrics.getStore();
    if (metrics) {
      metrics.count += 1;
      metrics.durationMs += Number(process.hrtime.bigint() - started) / 1_000_000;
    }
  }
}
function measuredDatabase(client: AppDatabase): AppDatabase {
  return {
    get kind() { return client.kind; },
    all: (query, params) => measureQuery(() => client.all(query, params)),
    get: (query, params) => measureQuery(() => client.get(query, params)),
    run: (query, params) => measureQuery(() => client.run(query, params)),
    exec: (query) => measureQuery(() => client.exec(query)),
    transaction: (work) => client.transaction((tx) => work(measuredDatabase(tx))),
    close: () => client.close(),
  };
}
const db = measuredDatabase(rawDb);
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

async function userRevision(userId: string, client: AppDatabase = db) {
  const row = await client.get<{ revision: number | string }>(
    'SELECT revision FROM user_sync_state WHERE user_id=?',
    [userId],
  );
  return Number(row?.revision || 0);
}

async function touchUsers(userIds: Iterable<string>, client: AppDatabase = db) {
  const ids = [...new Set([...userIds].filter(Boolean))];
  if (ids.length === 0) return;
  const updatedAt = new Date().toISOString();
  const values = ids.map(() => '(?,1,?)').join(',');
  await client.run(
    `INSERT INTO user_sync_state (user_id,revision,updated_at)
     VALUES ${values}
     ON CONFLICT(user_id) DO UPDATE SET
       revision=user_sync_state.revision+1,
       updated_at=excluded.updated_at`,
    ids.flatMap((userId) => [userId, updatedAt]),
  );
}

async function groupUserIds(groupId: string, client: AppDatabase = db) {
  return (await client.all<{ user_id: string }>(
    'SELECT user_id FROM group_members WHERE group_id=?',
    [groupId],
  )).map((row) => row.user_id);
}

async function touchGroup(groupId: string, client: AppDatabase = db) {
  await touchUsers(await groupUserIds(groupId, client), client);
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

const publicUser = (
  row: any,
  details: 'public' | 'payment' | 'account' = 'public',
) => ({
  id: row.id,
  credentialId: row.credential_id,
  name: row.name,
  avatarColor: row.avatar_color,
  ...(details === 'payment' || details === 'account' ? { phone: row.phone } : {}),
  ...(details === 'account' ? {
    profilePhoto: row.profile_photo,
    mustChangePassword: Boolean(row.must_change_password),
    hasMpin: Boolean(row.mpin_hash),
  } : {}),
});

async function areConnected(userOne: string, userTwo: string) {
  if (userOne === userTwo) return true;
  const [userA, userB] = pair(userOne, userTwo);
  return Boolean(await db.get(
    "SELECT 1 FROM connections WHERE user_a=? AND user_b=? AND status='accepted'",
    [userA, userB],
  ));
}

async function connectedToAll(userId: string, targetIds: Iterable<string>) {
  const ids = [...new Set([...targetIds].filter((id) => id && id !== userId))];
  if (ids.length === 0) return true;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ other_id: string }>(
    `SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END other_id
     FROM connections
     WHERE status='accepted' AND (
       (user_a=? AND user_b IN (${placeholders}))
       OR (user_b=? AND user_a IN (${placeholders}))
     )`,
    [userId, userId, ...ids, userId, ...ids],
  );
  return new Set(rows.map((row) => row.other_id)).size === ids.length;
}

async function groupMembership(groupId: string, userId: string, client: AppDatabase = db) {
  return client.get<any>(
    `SELECT gm.role,g.name,g.emoji,g.members_can_invite
     FROM group_members gm JOIN groups g ON g.id=gm.group_id
     WHERE gm.group_id=? AND gm.user_id=?`,
    [groupId, userId],
  );
}

async function groupAdmin(groupId: string, userId: string, client: AppDatabase = db) {
  const membership = await groupMembership(groupId, userId, client);
  return membership?.role === 'admin' ? membership : undefined;
}

async function connectMembersOfGroup(groupId: string, client: AppDatabase = db) {
  const userIds = await groupUserIds(groupId, client);
  const now = new Date().toISOString();
  for (let first = 0; first < userIds.length; first += 1) {
    for (let second = first + 1; second < userIds.length; second += 1) {
      const [userA, userB] = pair(userIds[first], userIds[second]);
      await client.run(
        `INSERT INTO connections (user_a,user_b,requester_id,status,created_at,responded_at)
         VALUES (?,?,?,'accepted',?,?)
         ON CONFLICT(user_a,user_b) DO UPDATE SET
           status='accepted',responded_at=excluded.responded_at`,
        [userA, userB, userA, now, now],
      );
    }
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
  const result = await client.run(
    `INSERT INTO app_notifications
      (id,user_id,type,title,body,entity_id,persistent_until,created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,type,entity_id) DO NOTHING`,
    [randomUUID(), userId, type, title, body, entityId, persistentUntil || null, new Date().toISOString()],
  );
  if (result.changes) await touchUsers([userId], client);
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
  if (members.length === 0) return;
  const createdAt = new Date().toISOString();
  const values = members.map(() => '(?,?,?,?,?,?,?,?)').join(',');
  const result = await db.run(
    `INSERT INTO app_notifications
      (id,user_id,type,title,body,entity_id,persistent_until,created_at)
     VALUES ${values}
     ON CONFLICT(user_id,type,entity_id) DO NOTHING`,
    members.flatMap((member) => [
      randomUUID(),
      member.user_id,
      type,
      title,
      body,
      entityId,
      persistentUntil || null,
      createdAt,
    ]),
  );
  if (result.changes) await touchUsers(members.map((member) => member.user_id));
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
    await touchGroup(poll.group_id);
  }
}

let maintenanceCompletedAt = 0;
let maintenanceInFlight: Promise<void> | undefined;

async function runMaintenance() {
  if (Date.now() - maintenanceCompletedAt < 60_000) {
    await evaluatePolls();
    return;
  }
  if (maintenanceInFlight) return maintenanceInFlight;
  maintenanceInFlight = (async () => {
    const pollThreshold = threeMonthsAgo();
    const affected = await db.all<{ user_id: string }>(
      `SELECT DISTINCT gm.user_id
       FROM group_members gm JOIN polls p ON p.group_id=gm.group_id
       WHERE p.created_at<?`,
      [pollThreshold],
    );
    await db.transaction(async (tx) => {
      await tx.run(
        'DELETE FROM messages WHERE created_at<?',
        [new Date(Date.now() - 10 * 86_400_000).toISOString()],
      );
      await tx.run(
        'DELETE FROM app_notifications WHERE entity_id IN (SELECT id FROM polls WHERE created_at<?)',
        [pollThreshold],
      );
      await tx.run(
        'DELETE FROM votes WHERE poll_id IN (SELECT id FROM polls WHERE created_at<?)',
        [pollThreshold],
      );
      await tx.run('DELETE FROM polls WHERE created_at<?', [pollThreshold]);
      await touchUsers(affected.map((item) => item.user_id), tx);
    });
    await evaluatePolls();
    maintenanceCompletedAt = Date.now();
  })().finally(() => {
    maintenanceInFlight = undefined;
  });
  return maintenanceInFlight;
}

let duePollCheckCompletedAt = 0;
let duePollCheckInFlight: Promise<void> | undefined;

async function maybeEvaluatePolls() {
  if (Date.now() - duePollCheckCompletedAt < 30_000) return;
  if (!duePollCheckInFlight) {
    duePollCheckInFlight = evaluatePolls()
      .then(() => {
        duePollCheckCompletedAt = Date.now();
      })
      .finally(() => {
        duePollCheckInFlight = undefined;
      });
  }
  await duePollCheckInFlight;
}

const messageJson = (message: any) => ({
  id: message.id,
  userId: message.user_id,
  name: message.name,
  avatarColor: message.avatar_color,
  body: message.body,
  createdAt: asIso(message.created_at),
});

function rowsBy<T = any>(rows: T[], key: keyof T) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = String(row[key]);
    const items = grouped.get(value) || [];
    items.push(row);
    grouped.set(value, items);
  }
  return grouped;
}

async function getBootstrap(userId: string, knownRevision?: number) {
  const recentMessageThreshold = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const [
    user,
    connectionRows,
    groupRows,
    memberRows,
    pendingInviteRows,
    pollRows,
    voteRows,
    messageRows,
    rawPayments,
    groupInviteRows,
    connectionRequestRows,
    notificationRows,
    revision,
  ] = await Promise.all([
    db.get<any>('SELECT * FROM users WHERE id=?', [userId]),
    db.all<any>(`SELECT
        c.user_a,c.user_b,c.requester_id,
        c.created_at connection_created_at,c.responded_at,
        u.id,u.credential_id,u.name,u.phone,u.avatar_color
      FROM connections c JOIN users u
        ON u.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END
      WHERE (c.user_a=? OR c.user_b=?) AND c.status='accepted'
      ORDER BY u.name`, [userId, userId, userId]),
    db.all<any>(`SELECT g.*,gm.role,gm.position
      FROM groups g JOIN group_members gm ON gm.group_id=g.id
      WHERE gm.user_id=? ORDER BY gm.position,g.name`, [userId]),
    db.all<any>(`SELECT gm.group_id,gm.role,
        u.id,u.credential_id,u.name,u.avatar_color
      FROM group_members owner
      JOIN group_members gm ON gm.group_id=owner.group_id
      JOIN users u ON u.id=gm.user_id
      WHERE owner.user_id=? ORDER BY gm.group_id,u.name`, [userId]),
    db.all<any>(`SELECT gi.group_id,gi.id invite_id,gi.created_at,
        u.id,u.credential_id,u.name,u.avatar_color
      FROM group_members owner
      JOIN group_invites gi ON gi.group_id=owner.group_id AND gi.status='pending'
      JOIN users u ON u.id=gi.invitee_id
      WHERE owner.user_id=? ORDER BY gi.group_id,gi.created_at DESC`, [userId]),
    db.all<any>(`SELECT p.*,u.name creator_name
      FROM group_members owner
      JOIN polls p ON p.group_id=owner.group_id
      JOIN users u ON u.id=p.creator_id
      WHERE owner.user_id=? ORDER BY p.group_id,p.created_at DESC`, [userId]),
    db.all<any>(`SELECT p.group_id,v.poll_id,v.user_id,u.name,u.avatar_color,v.choice,v.created_at
      FROM group_members owner
      JOIN polls p ON p.group_id=owner.group_id
      JOIN votes v ON v.poll_id=p.id
      JOIN users u ON u.id=v.user_id
      WHERE owner.user_id=? ORDER BY v.poll_id,v.created_at,v.user_id`, [userId]),
    db.all<any>(`SELECT * FROM (
        SELECT m.*,u.name,u.avatar_color,
          ROW_NUMBER() OVER (
            PARTITION BY m.group_id ORDER BY m.created_at DESC,m.id DESC
          ) recent_number
        FROM group_members owner
        JOIN messages m ON m.group_id=owner.group_id
        JOIN users u ON u.id=m.user_id
        WHERE owner.user_id=? AND m.created_at>=?
      ) recent
      WHERE recent_number<=80
      ORDER BY group_id,created_at,id`, [userId, recentMessageThreshold]),
    db.all<any>(`SELECT p.*,
      payer.name payer_name,payer.avatar_color payer_color,
      payee.name payee_name,payee.avatar_color payee_color,
      initiator.name initiator_name
      FROM payment_requests p
      JOIN users payer ON payer.id=p.payer_id
      JOIN users payee ON payee.id=p.payee_id
      JOIN users initiator ON initiator.id=p.initiator_id
      WHERE p.payer_id=? OR p.payee_id=? OR p.initiator_id=?
      ORDER BY p.created_at DESC`, [userId, userId, userId]),
    db.all<any>(`SELECT gi.*,g.name group_name,g.emoji,g.accent,
      inviter.name inviter_name
      FROM group_invites gi
      JOIN groups g ON g.id=gi.group_id
      JOIN users inviter ON inviter.id=gi.inviter_id
      WHERE gi.invitee_id=? AND gi.status='pending'
      ORDER BY gi.created_at DESC`, [userId]),
    db.all<any>(`SELECT c.*,u.id requester_user_id,u.credential_id,u.name,u.avatar_color
      FROM connections c JOIN users u ON u.id=c.requester_id
      WHERE (c.user_a=? OR c.user_b=?) AND c.status='pending'
      ORDER BY c.created_at DESC`, [userId, userId]),
    db.all<any>(`SELECT * FROM app_notifications
      WHERE user_id=? AND cleared_at IS NULL ORDER BY created_at DESC`, [userId]),
    knownRevision === undefined ? userRevision(userId) : Promise.resolve(knownRevision),
  ]);

  const membersByGroup = rowsBy(memberRows, 'group_id');
  const invitesByGroup = rowsBy(pendingInviteRows, 'group_id');
  const pollsByGroup = rowsBy(pollRows, 'group_id');
  const votesByPoll = rowsBy(voteRows, 'poll_id');
  const messagesByGroup = rowsBy(messageRows, 'group_id');
  const groups = groupRows.map((group) => {
    const polls = (pollsByGroup.get(group.id) || []).map((poll: any) => {
      const voteDetails = votesByPoll.get(poll.id) || [];
      const myVote = voteDetails.find((vote: any) => vote.user_id === userId)?.choice;
      return {
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
        yesCount: voteDetails.filter((vote: any) => vote.choice === 'yes').length,
        noCount: voteDetails.filter((vote: any) => vote.choice === 'no').length,
        declineCount: voteDetails.filter((vote: any) => vote.choice === 'decline').length,
        myVote,
        creatorId: poll.creator_id,
        pollType: poll.poll_type || 'yes_no',
        options: pollOptions(poll),
        winningOptions: String(poll.winning_option || '').split(',').filter(Boolean),
        voteDetails: voteDetails.map((vote: any) => ({
          userId: vote.user_id,
          name: vote.name,
          avatarColor: vote.avatar_color,
          choice: vote.choice,
          createdAt: asIso(vote.created_at),
        })),
        canDelete: poll.status === 'open'
          && (poll.creator_id === userId || group.role === 'admin'),
      };
    });
    return {
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      accent: group.accent,
      role: group.role,
      membersCanInvite: Boolean(group.members_can_invite),
      canInviteMembers: group.role === 'admin' || Boolean(group.members_can_invite),
      members: (membersByGroup.get(group.id) || []).map((row: any) => ({
        ...publicUser(row),
        role: row.role,
      })),
      pendingInvites: (invitesByGroup.get(group.id) || []).map((row: any) => ({
        inviteId: row.invite_id,
        ...publicUser(row),
        createdAt: asIso(row.created_at),
      })),
      polls,
      messages: (messagesByGroup.get(group.id) || []).map(messageJson),
    };
  });

  const people = connectionRows.map((row) => publicUser(row, 'payment'));
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

  const groupInvites = groupInviteRows.map((invite) => ({
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
  const connections = connectionRows.map((item) => ({
      id: item.id,
      credentialId: item.credential_id,
      name: item.name,
      avatarColor: item.avatar_color,
      connectedAt: asIso(item.responded_at || item.connection_created_at),
    }));
  const connectionRequests = connectionRequestRows.map((item) => ({
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
  const notifications = notificationRows.map((item) => ({
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
    revision,
    user: publicUser(user, 'account'),
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

let initialization: Promise<void> | undefined;

function ensureReady() {
  if (!initialization) {
    initialization = initializeLocalDatabase(db)
      .catch((error) => {
        initialization = undefined;
        throw error;
      });
  }
  return initialization;
}

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  const metrics: QueryMetrics = { count: 0, durationMs: 0 };
  const originalJson = res.json.bind(res);
  (res as any).json = (body: unknown) => {
    if (!res.headersSent) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Server-Timing',
        `app;dur=${durationMs.toFixed(1)}, db;dur=${metrics.durationMs.toFixed(1)};desc="${metrics.count} queries"`,
      );
      res.setHeader('X-Fundship-DB-Queries', String(metrics.count));
      res.setHeader('X-Fundship-Request-Path', req.path);
    }
    return originalJson(body);
  };
  queryMetrics.run(metrics, next);
});
app.use(async (_req, _res, next) => {
  try {
    await ensureReady();
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
    req.sessionToken = token;
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
  let databaseRegion: string | undefined;
  try {
    const hostname = new URL(process.env.DATABASE_URL || '').hostname;
    databaseRegion = hostname.match(/aws-\d+-([^.]+)\.pooler\.supabase\.com$/)?.[1];
  } catch {
    // A malformed URL is reported by database initialization; health exposes no secret.
  }
  res.json({
    ok: true,
    database: db.kind,
    databaseRegion: databaseRegion || null,
    functionRegion: process.env.VERCEL_REGION || null,
  });
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
  await touchUsers([req.userId!]);
  res.json({ ok: true });
});

app.post('/api/auth/logout', auth, async (req: AuthedRequest, res) => {
  await db.run('DELETE FROM sessions WHERE token=? AND user_id=?', [
    req.sessionToken!,
    req.userId!,
  ]);
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
  await touchUsers([req.userId!]);
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
  await touchUsers([req.userId!]);
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
    : String(req.body.profilePhoto || '');
  if (
    profilePhoto
    && (
      profilePhoto.length > 500_000
      || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(profilePhoto)
    )
  ) {
    res.status(400).json({ error: 'Profile photo must be a small JPEG, PNG, or WebP image.' });
    return;
  }
  await db.run(
    'UPDATE users SET phone=?, profile_photo=? WHERE id=?',
    [phone, profilePhoto || null, req.userId!],
  );
  await touchUsers([req.userId!]);
  res.json(await getBootstrap(req.userId!));
});

app.get('/api/bootstrap', auth, async (req: AuthedRequest, res) => {
  await maybeEvaluatePolls();
  res.json(await getBootstrap(req.userId!));
});

app.get('/api/sync', auth, async (req: AuthedRequest, res) => {
  const after = Math.max(0, Number.parseInt(String(req.query.after || '0'), 10) || 0);
  await maybeEvaluatePolls();
  const revision = await userRevision(req.userId!);
  res.setHeader('X-Fundship-Revision', String(revision));
  if (revision <= after) {
    res.json({ changed: false, revision });
    return;
  }
  res.json({
    changed: true,
    revision,
    snapshot: await getBootstrap(req.userId!, revision),
  });
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
    await touchUsers([req.userId!], tx);
  });
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/groups/:id/invites', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const membership = await groupMembership(groupId, req.userId!);
  if (!membership) {
    res.status(403).json({ error: 'Only group members can invite people.' });
    return;
  }
  if (membership.role !== 'admin' && !Boolean(membership.members_can_invite)) {
    res.status(403).json({ error: 'An admin has not enabled member invitations.' });
    return;
  }

  const rawIds: string[] = Array.isArray(req.body?.inviteeIds) ? req.body.inviteeIds.map(String) : [];
  if (rawIds.length > 25) {
    res.status(400).json({ error: 'Invite up to 25 people at a time.' });
    return;
  }
  const candidateIds = new Set<string>(rawIds.filter(Boolean));
  const credentialId = String(req.body?.credentialId || '').trim();
  if (credentialId) {
    const invitedUser = await db.get<{ id: string }>(
      'SELECT id FROM users WHERE upper(credential_id)=upper(?)',
      [credentialId],
    );
    if (!invitedUser) {
      res.status(404).json({ error: 'No user was found with that ID.' });
      return;
    }
    candidateIds.add(invitedUser.id);
  }
  if (candidateIds.size === 0) {
    res.status(400).json({ error: 'Choose at least one person to invite.' });
    return;
  }

  const inviter = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  let created = 0;
  const inviteeIds = [...candidateIds].filter((id) => id && id !== req.userId!);
  const placeholders = inviteeIds.map(() => '?').join(',');
  const validUsers = inviteeIds.length === 0
    ? []
    : await db.all<{ id: string }>(
      `SELECT id FROM users WHERE id IN (${placeholders})`,
      inviteeIds,
    );
  const existingMembers = inviteeIds.length === 0
    ? []
    : await db.all<{ user_id: string }>(
      `SELECT user_id FROM group_members
       WHERE group_id=? AND user_id IN (${placeholders})`,
      [groupId, ...inviteeIds],
    );
  const existingInvites = inviteeIds.length === 0
    ? []
    : await db.all<{ invitee_id: string }>(
      `SELECT invitee_id FROM group_invites
       WHERE group_id=? AND status='pending' AND invitee_id IN (${placeholders})`,
      [groupId, ...inviteeIds],
    );
  const allowed = new Set(validUsers.map((item) => item.id));
  for (const item of existingMembers) allowed.delete(item.user_id);
  for (const item of existingInvites) allowed.delete(item.invitee_id);
  await db.transaction(async (tx) => {
    for (const inviteeId of allowed) {
      const inviteId = randomUUID();
      await tx.run(
        'INSERT INTO group_invites (id,group_id,inviter_id,invitee_id,status,created_at) VALUES (?,?,?,?,?,?)',
        [inviteId, groupId, req.userId!, inviteeId, 'pending', new Date().toISOString()],
      );
      await addNotification(
        inviteeId,
        'group_invite',
        `Group invitation · ${membership.name}`,
        `${inviter?.name || 'A group member'} invited you to join.`,
        inviteId,
        null,
        tx,
      );
      created += 1;
    }
    if (created > 0) await touchGroup(groupId, tx);
  });
  if (created === 0) {
    res.status(409).json({ error: 'Everyone selected is already a member or has a pending invitation.' });
    return;
  }
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/groups/:id/settings', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  if (!await groupAdmin(groupId, req.userId!)) {
    res.status(403).json({ error: 'Only a group admin can change group settings.' });
    return;
  }
  if (typeof req.body?.membersCanInvite !== 'boolean') {
    res.status(400).json({ error: 'Choose whether members can invite others.' });
    return;
  }
  const enabled = req.body.membersCanInvite as boolean;
  await db.run(
    'UPDATE groups SET members_can_invite=? WHERE id=?',
    [db.kind === 'postgres' ? enabled : enabled ? 1 : 0, groupId],
  );
  await touchGroup(groupId);
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/groups/:id/members/:userId/role', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const targetUserId = String(req.params.userId);
  const admin = await groupAdmin(groupId, req.userId!);
  if (!admin) {
    res.status(403).json({ error: 'Only a group admin can change member roles.' });
    return;
  }
  const role = String(req.body?.role || '');
  if (role !== 'admin' && role !== 'member') {
    res.status(400).json({ error: 'Choose Admin or Member.' });
    return;
  }
  if (targetUserId === req.userId!) {
    res.status(400).json({ error: 'You cannot change your own admin role.' });
    return;
  }
  const target = await db.get<any>(
    `SELECT gm.role,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id
     WHERE gm.group_id=? AND gm.user_id=?`,
    [groupId, targetUserId],
  );
  if (!target) {
    res.status(404).json({ error: 'That person is not a group member.' });
    return;
  }
  if (target.role === role) {
    res.json(await getBootstrap(req.userId!));
    return;
  }
  if (target.role === 'admin' && role === 'member') {
    const count = await db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM group_members WHERE group_id=? AND role='admin'",
      [groupId],
    );
    if (Number(count?.count || 0) <= 1) {
      res.status(409).json({ error: 'Every group must keep at least one admin.' });
      return;
    }
  }
  await db.run(
    'UPDATE group_members SET role=? WHERE group_id=? AND user_id=?',
    [role, groupId, targetUserId],
  );
  await addNotification(
    targetUserId,
    role === 'admin' ? 'group_promoted' : 'group_demoted',
    role === 'admin' ? `You are now an admin · ${admin.name}` : `Role updated · ${admin.name}`,
    role === 'admin'
      ? 'You can now manage members, invitations, settings, and polls.'
      : 'Your role in this group is now Member.',
    `${groupId}:${role}:${randomUUID()}`,
  );
  await touchGroup(groupId);
  res.json(await getBootstrap(req.userId!));
});

app.delete('/api/groups/:id/members/:userId', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const targetUserId = String(req.params.userId);
  const admin = await groupAdmin(groupId, req.userId!);
  if (!admin) {
    res.status(403).json({ error: 'Only a group admin can remove members.' });
    return;
  }
  if (targetUserId === req.userId!) {
    res.status(400).json({ error: 'You cannot remove yourself from the group.' });
    return;
  }
  const target = await db.get<any>(
    `SELECT gm.role,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id
     WHERE gm.group_id=? AND gm.user_id=?`,
    [groupId, targetUserId],
  );
  if (!target) {
    res.status(404).json({ error: 'That person is not a group member.' });
    return;
  }
  if (target.role === 'admin') {
    const count = await db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM group_members WHERE group_id=? AND role='admin'",
      [groupId],
    );
    if (Number(count?.count || 0) <= 1) {
      res.status(409).json({ error: 'Promote another member before removing the last admin.' });
      return;
    }
  }
  const actor = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await db.transaction(async (tx) => {
    await tx.run(
      `DELETE FROM app_notifications WHERE user_id=? AND entity_id IN
       (SELECT id FROM polls WHERE group_id=?)`,
      [targetUserId, groupId],
    );
    await tx.run(
      `DELETE FROM votes WHERE user_id=? AND poll_id IN
       (SELECT id FROM polls WHERE group_id=? AND status='open')`,
      [targetUserId, groupId],
    );
    await tx.run(
      'DELETE FROM group_members WHERE group_id=? AND user_id=?',
      [groupId, targetUserId],
    );
    await addNotification(
      targetUserId,
      'group_removed',
      `Removed from ${admin.name}`,
      `${actor?.name || 'A group admin'} removed you from the group.`,
      groupId,
      null,
      tx,
    );
    await touchGroup(groupId, tx);
  });
  res.json(await getBootstrap(req.userId!));
});

app.delete('/api/groups/:id', auth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const admin = await groupAdmin(groupId, req.userId!);
  if (!admin) {
    res.status(403).json({ error: 'Only a group admin can delete this group.' });
    return;
  }
  const members = await db.all<{ user_id: string }>(
    'SELECT user_id FROM group_members WHERE group_id=?',
    [groupId],
  );
  const actor = await db.get<any>('SELECT name FROM users WHERE id=?', [req.userId!]);
  await db.transaction(async (tx) => {
    await tx.run(
      `DELETE FROM app_notifications WHERE entity_id IN
       (SELECT id FROM polls WHERE group_id=?)`,
      [groupId],
    );
    await tx.run(
      `DELETE FROM app_notifications WHERE entity_id IN
       (SELECT id FROM group_invites WHERE group_id=?)`,
      [groupId],
    );
    await tx.run(
      "DELETE FROM app_notifications WHERE entity_id=? AND type IN ('group_promoted','group_demoted','group_removed')",
      [groupId],
    );
    await tx.run(
      'DELETE FROM votes WHERE poll_id IN (SELECT id FROM polls WHERE group_id=?)',
      [groupId],
    );
    await tx.run('DELETE FROM polls WHERE group_id=?', [groupId]);
    await tx.run('DELETE FROM messages WHERE group_id=?', [groupId]);
    await tx.run('DELETE FROM group_invites WHERE group_id=?', [groupId]);
    await tx.run('DELETE FROM group_members WHERE group_id=?', [groupId]);
    await tx.run('DELETE FROM groups WHERE id=?', [groupId]);
    for (const member of members) {
      if (member.user_id === req.userId!) continue;
      await addNotification(
        member.user_id,
        'group_deleted',
        `Group deleted · ${admin.name}`,
        `${actor?.name || 'A group admin'} deleted this group.`,
        groupId,
        null,
        tx,
      );
    }
    await touchUsers(members.map((member) => member.user_id), tx);
  });
  res.json(await getBootstrap(req.userId!));
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
      await connectMembersOfGroup(invite.group_id, tx);
    }
    await tx.run(
      "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='group_invite' AND entity_id=?",
      [new Date().toISOString(), req.userId!, inviteId],
    );
    await touchGroup(invite.group_id, tx);
    await touchUsers([req.userId!], tx);
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
  await touchUsers([req.userId!]);
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
  if (participantIds.some((id: string) => !id) || !await connectedToAll(req.userId!, participantIds)) {
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
    await touchUsers(participantIds, tx);
  });
  res.status(201).json(await getBootstrap(req.userId!));
});

app.post('/api/payments/:id/verify', auth, async (req: AuthedRequest, res) => {
  const paymentId = String(req.params.id);
  const payment = await db.get<any>(
    "SELECT * FROM payment_requests WHERE id=? AND payer_id=? AND status='pending'",
    [paymentId, req.userId!],
  );
  if (!payment) {
    res.status(404).json({ error: 'Pending request not found.' });
    return;
  }
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
  await touchUsers([payment.initiator_id, payment.payer_id, payment.payee_id]);
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/payments/verify-all', auth, async (req: AuthedRequest, res) => {
  const affected = await db.all<any>(
    "SELECT DISTINCT initiator_id,payer_id,payee_id FROM payment_requests WHERE payer_id=? AND status='pending'",
    [req.userId!],
  );
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE payment_requests SET status='verified', verified_at=? WHERE payer_id=? AND status='pending'",
      [new Date().toISOString(), req.userId!],
    );
    await tx.run(
      "UPDATE app_notifications SET cleared_at=? WHERE user_id=? AND type='payment_request'",
      [new Date().toISOString(), req.userId!],
    );
    await touchUsers(
      affected.flatMap((item) => [item.initiator_id, item.payer_id, item.payee_id]),
      tx,
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
  await touchUsers([row.initiator_id, row.payer_id, row.payee_id]);
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
  await touchGroup(poll.group_id);
  res.json({
    ok: true,
    pollId,
    choice,
    revision: await userRevision(req.userId!),
  });
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
  await touchGroup(poll.group_id);
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
    await touchGroup(poll.group_id, tx);
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
  const messageId = randomUUID();
  const createdAt = new Date().toISOString();
  await db.run(
    'INSERT INTO messages (id,group_id,user_id,body,created_at) VALUES (?,?,?,?,?)',
    [messageId, groupId, req.userId!, body.slice(0, 2000), createdAt],
  );
  await touchGroup(groupId);
  const author = await db.get<any>('SELECT name,avatar_color FROM users WHERE id=?', [req.userId!]);
  res.status(201).json({
    message: {
      id: messageId,
      userId: req.userId!,
      name: author?.name || '',
      avatarColor: author?.avatar_color || '#687fbc',
      body: body.slice(0, 2000),
      createdAt,
    },
    revision: await userRevision(req.userId!),
  });
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
  const rawAfter = String(req.query.after || '');
  const after = Number.isFinite(new Date(rawAfter).getTime()) ? new Date(rawAfter).toISOString() : '';
  const afterId = String(req.query.afterId || '');
  const messages = after
    ? await db.all<any>(
      `SELECT m.*,u.name,u.avatar_color
       FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.group_id=? AND (m.created_at>? OR (m.created_at=? AND m.id>?))
       ORDER BY m.created_at,m.id LIMIT 100`,
      [groupId, after, after, afterId],
    )
    : await db.all<any>(
      `SELECT * FROM (
         SELECT m.*,u.name,u.avatar_color
         FROM messages m JOIN users u ON u.id=m.user_id
         WHERE m.group_id=? AND m.created_at>=?
         ORDER BY m.created_at DESC,m.id DESC LIMIT 80
       ) recent ORDER BY created_at,id`,
      [groupId, new Date(Date.now() - 10 * 86_400_000).toISOString()],
    );
  const items = messages.map(messageJson);
  const last = items.at(-1);
  res.json({
    messages: items,
    cursor: last ? { createdAt: last.createdAt, id: last.id } : null,
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
  await touchGroup(groupId);
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
  await touchUsers([req.userId!, target.id]);
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
  await touchUsers([userA, userB]);
  res.json(await getBootstrap(req.userId!));
});

app.post('/api/notifications/read', auth, async (req: AuthedRequest, res) => {
  await db.run(
    'UPDATE app_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND cleared_at IS NULL',
    [new Date().toISOString(), req.userId!],
  );
  await touchUsers([req.userId!]);
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
  await touchUsers([req.userId!]);
  res.json(await getBootstrap(req.userId!));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 8787);
  ensureReady()
    .then(() => app.listen(port, () => {
      console.log(`FUNDSHIP API listening on http://localhost:${port} (${db.kind})`);
    }))
    .catch((error) => {
      console.error('FUNDSHIP API failed to start:', error);
      process.exitCode = 1;
    });
}

export default app;
