-- Enforce the first-login order at the database boundary and make issued user
-- IDs case-insensitively unique/searchable.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select lower(credential_id)
    from public.users
    group by lower(credential_id)
    having count(*) > 1
  ) then
    raise exception 'Case-insensitive duplicate credential IDs must be resolved first';
  end if;
end
$$;

create unique index if not exists users_credential_id_ci_uidx
  on public.users (lower(credential_id));

alter table public.users
  drop constraint if exists users_first_login_order_check;

alter table public.users
  add constraint users_first_login_order_check
  check (must_change_password is false or mpin_hash is null) not valid;

alter table public.users
  validate constraint users_first_login_order_check;
