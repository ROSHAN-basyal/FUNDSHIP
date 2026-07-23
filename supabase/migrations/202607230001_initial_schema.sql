-- FUNDSHIP production schema.
-- The Vercel API connects through Supabase's Postgres transaction pooler.

create table if not exists public.users (
  id text primary key,
  credential_id text unique not null,
  name text not null,
  phone text,
  password_hash text not null,
  mpin_hash text,
  must_change_password boolean not null default true,
  avatar_color text not null,
  profile_photo text,
  esewa_qr text
);

create table if not exists public.sessions (
  token text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id text primary key,
  name text not null,
  emoji text not null,
  accent text not null
);

create table if not exists public.group_members (
  group_id text not null references public.groups(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  position integer not null default 0,
  primary key (group_id, user_id)
);

create table if not exists public.group_invites (
  id text primary key,
  group_id text not null references public.groups(id) on delete cascade,
  inviter_id text not null references public.users(id) on delete cascade,
  invitee_id text not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

create table if not exists public.polls (
  id text primary key,
  group_id text not null references public.groups(id) on delete cascade,
  creator_id text not null references public.users(id) on delete cascade,
  title text not null,
  event_at timestamptz not null,
  bs_date text not null,
  min_yes integer not null check (min_yes > 0),
  deadline_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'cancelled')),
  approval_status text not null default 'approved' check (approval_status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  poll_type text not null default 'yes_no' check (poll_type in ('yes_no', 'options')),
  options_json jsonb,
  winning_option text,
  result_notified_at timestamptz
);

create table if not exists public.votes (
  poll_id text not null references public.polls(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  choice text not null,
  reply text,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.messages (
  id text primary key,
  group_id text not null references public.groups(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id text primary key,
  initiator_id text not null references public.users(id) on delete cascade,
  payer_id text not null references public.users(id) on delete cascade,
  payee_id text not null references public.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  purpose text not null,
  note text,
  kind text not null check (kind in ('lend', 'split')),
  split_id text,
  split_count integer,
  total_amount integer,
  status text not null default 'pending' check (status in ('pending', 'verified')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists public.connections (
  user_a text not null references public.users(id) on delete cascade,
  user_b text not null references public.users(id) on delete cascade,
  requester_id text not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.app_notifications (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  entity_id text not null,
  persistent_until timestamptz,
  read_at timestamptz,
  cleared_at timestamptz,
  native_delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_entity_user_type
  on public.app_notifications(user_id, type, entity_id);
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists group_members_user_position_idx
  on public.group_members(user_id, position);
create index if not exists group_invites_invitee_status_idx
  on public.group_invites(invitee_id, status, created_at desc);
create index if not exists polls_group_created_idx
  on public.polls(group_id, created_at desc);
create index if not exists polls_due_idx
  on public.polls(status, approval_status, deadline_at);
create index if not exists messages_group_created_idx
  on public.messages(group_id, created_at desc);
create index if not exists payment_requests_payer_status_idx
  on public.payment_requests(payer_id, status, created_at desc);
create index if not exists payment_requests_initiator_status_idx
  on public.payment_requests(initiator_id, status, created_at desc);
create index if not exists notifications_user_visible_idx
  on public.app_notifications(user_id, cleared_at, created_at desc);

-- The mobile app never talks directly to the Supabase Data API. Enabling RLS
-- keeps these tables closed there; the trusted Vercel backend uses the direct
-- Postgres connection configured in DATABASE_URL.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.polls enable row level security;
alter table public.votes enable row level security;
alter table public.messages enable row level security;
alter table public.payment_requests enable row level security;
alter table public.connections enable row level security;
alter table public.app_notifications enable row level security;
