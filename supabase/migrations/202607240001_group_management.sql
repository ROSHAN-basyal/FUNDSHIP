-- Group administration and member invitation policy.
-- Existing groups remain admin-invite-only until an admin enables the setting.

alter table public.groups
  add column if not exists members_can_invite boolean not null default false;
