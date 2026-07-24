-- Fixed-query/delta-sync foundation. Safe to run once through the Supabase SQL editor.

create table if not exists public.user_sync_state (
  user_id text primary key references public.users(id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.user_sync_state (user_id, revision, updated_at)
select id, 1, now() from public.users
on conflict (user_id) do nothing;

create index if not exists group_members_group_role_idx
  on public.group_members(group_id, role, user_id);
create index if not exists group_invites_group_pending_idx
  on public.group_invites(group_id, created_at desc)
  where status = 'pending';
create index if not exists polls_group_status_created_idx
  on public.polls(group_id, status, created_at desc);
create index if not exists votes_user_poll_idx
  on public.votes(user_id, poll_id);
create index if not exists messages_group_cursor_idx
  on public.messages(group_id, created_at, id);
create index if not exists connections_user_a_status_idx
  on public.connections(user_a, status, user_b);
create index if not exists connections_user_b_status_idx
  on public.connections(user_b, status, user_a);
create index if not exists payment_requests_payee_status_idx
  on public.payment_requests(payee_id, status, created_at desc);

-- These were previously repaired during ordinary bootstrap requests. Make the
-- one-time data repair part of the migration instead.
insert into public.connections
  (user_a, user_b, requester_id, status, created_at, responded_at)
select distinct
  least(a.user_id, b.user_id),
  greatest(a.user_id, b.user_id),
  least(a.user_id, b.user_id),
  'accepted',
  now(),
  now()
from public.group_members a
join public.group_members b
  on b.group_id = a.group_id and a.user_id < b.user_id
on conflict (user_a, user_b) do update
set status = 'accepted', responded_at = excluded.responded_at;

delete from public.groups
where (id = 'g1' and name = 'Weekend Crew')
   or (id = 'g2' and name = 'Office Lunch')
   or (id = 'g3' and name = 'Cycling Circle');

delete from public.app_notifications
where (
  type in ('poll_open', 'poll_approval', 'poll_result', 'event_due')
  and not exists (
    select 1 from public.polls where polls.id = app_notifications.entity_id
  )
) or (
  type = 'group_invite'
  and not exists (
    select 1 from public.group_invites where group_invites.id = app_notifications.entity_id
  )
);

alter table public.user_sync_state enable row level security;
