-- Payment lifecycle and split-detail support.
-- Self-shares remain part of the breakdown but are not payable transactions.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.payment_requests
  add column if not exists split_mode text,
  add column if not exists split_breakdown_json text,
  add column if not exists payer_seen_at timestamptz,
  add column if not exists discarded_at timestamptz;

alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;

alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'verified', 'discarded')) not valid;

alter table public.payment_requests
  validate constraint payment_requests_status_check;

alter table public.payment_requests
  drop constraint if exists payment_requests_split_mode_check;

alter table public.payment_requests
  add constraint payment_requests_split_mode_check
  check (split_mode is null or split_mode in ('equal', 'manual')) not valid;

alter table public.payment_requests
  validate constraint payment_requests_split_mode_check;

-- Existing clients rely on revision changes for delta sync. Advance every
-- affected account before removing legacy self-payment rows.
update public.user_sync_state
set revision = revision + 1,
    updated_at = now()
where user_id in (
  select initiator_id from public.payment_requests where payer_id = payee_id
  union
  select payer_id from public.payment_requests where payer_id = payee_id
  union
  select payee_id from public.payment_requests where payer_id = payee_id
);

delete from public.app_notifications notification
using public.payment_requests payment
where notification.type = 'payment_request'
  and notification.entity_id = payment.id
  and payment.payer_id = payment.payee_id;

delete from public.payment_requests
where payer_id = payee_id;

create index if not exists payment_requests_payer_unseen_idx
  on public.payment_requests(payer_id, created_at desc)
  where status = 'pending' and payer_seen_at is null;
