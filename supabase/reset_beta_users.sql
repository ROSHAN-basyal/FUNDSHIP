-- DESTRUCTIVE: removes every FUNDSHIP account and all application data, then
-- creates the private-beta accounts below.
--
-- Run this manually in the Supabase SQL Editor. Do not add it to automatic
-- migrations: resetting user data must always be an explicit administrator act.
--
-- The bcrypt hashes below represent the administrator-provided common temporary
-- password. mpin_hash is intentionally NULL: after the first login the API
-- requires a password change, then requires a private 4-digit MPIN.

begin;

-- Explicitly list the application tables so this script remains auditable.
-- fundship_schema_migrations is deliberately preserved.
truncate table
  public.app_notifications,
  public.votes,
  public.messages,
  public.group_invites,
  public.group_members,
  public.payment_requests,
  public.connections,
  public.polls,
  public.sessions,
  public.user_sync_state,
  public.groups,
  public.users
restart identity;

insert into public.users (
  id,
  credential_id,
  name,
  phone,
  password_hash,
  mpin_hash,
  must_change_password,
  avatar_color,
  profile_photo
)
values
  (gen_random_uuid()::text, 'RsnB',    'Roshan Basyal',      null, '$2b$12$X3HKncrg.DkIm0prQQxoNuRG1tUI0qxyrvGrpcI4HBkG/6v/AreVa', null, true, '#E7864A', null),
  (gen_random_uuid()::text, 'NwrjP',   'Nawaraj Poudel',     null, '$2b$12$ASSw0eRbeY6cLhhaGY74Ren/t0jpoaM4ZbIE3i5f/l5vXE92WMav2', null, true, '#687FBC', null),
  (gen_random_uuid()::text, 'HemsB',   'Hemanta Bhusal',     null, '$2b$12$6CyBUNOdnMwxNRP9sGjjJeEjF6G8Fzu6Qj8XoJYZCqXHzuGOluc56', null, true, '#4C9686', null),
  (gen_random_uuid()::text, 'SachinG', 'Sachin Gautam',      null, '$2b$12$xwdueAKXzi0/vOerhDDWG.eCi7XG.wSrj8IDBFZf0M8e3YMZbwZtO', null, true, '#B76475', null),
  (gen_random_uuid()::text, 'BiswasN', 'Biswash Neupane',    null, '$2b$12$Y6t5MEiagRQYFy4/RNbRfOwWY4iVJkTGNYXPCoad7CIEs9Kb7q4qC', null, true, '#A779B8', null),
  (gen_random_uuid()::text, 'MadhuSP', 'Madhu Sudan Pandey', null, '$2b$12$dTetw7VIJHGhxo6iqyUC4uDAwxVpFvwWzSahau8sya9Y8oZPR4pCy', null, true, '#34725A', null),
  (gen_random_uuid()::text, 'SrthkB',  'Sarthak Bhandari',   null, '$2b$12$Yd7owwhbE.OmnuHvBy6xPuOQCEAoL9.d1dVqXnRPBI57y12D75U7q', null, true, '#4E5FA8', null),
  (gen_random_uuid()::text, 'SantosK', 'Santosh Khanal',     null, '$2b$12$uSF3O2phGbh0ETR3M3kt5eNYy4ZUo3PGaHh15t4PAex3cpJJWDaJK', null, true, '#B04A38', null),
  (gen_random_uuid()::text, 'SujalK',  'Sujal Karki',        null, '$2b$12$JBbqggSqRqqRZbgeeI794u2DucPWQt/3lMZ6IUPccS4wkF27T7rkS', null, true, '#8A4776', null),
  (gen_random_uuid()::text, 'Spndhn',  'Spandhan',           null, '$2b$12$Qa70xKYd39e7CKcPEDmaiuca2urZhoDrnSb8fp2G/NB8b2obrciEG', null, true, '#7B5A30', null),
  (gen_random_uuid()::text, 'SulavP',  'Sulav Pandey',       null, '$2b$12$kWU97TgfJJ18u2yxY./yBu.YFL/gop9N.7EvHfttwGP/4x5qYuQCu', null, true, '#327461', null);

insert into public.user_sync_state (user_id, revision, updated_at)
select id, 1, now()
from public.users;

-- Abort instead of committing a partial or incorrect reset.
do $$
begin
  if (select count(*) from public.users) <> 11 then
    raise exception 'Expected 11 beta users after reset';
  end if;

  if exists (
    select 1
    from public.users
    where must_change_password is not true or mpin_hash is not null
  ) then
    raise exception 'A beta account was created with an invalid onboarding state';
  end if;
end
$$;

commit;

-- Safe result summary: hashes are never returned.
select
  credential_id as "User ID",
  name as "Name",
  must_change_password as "Password change required",
  (mpin_hash is null) as "MPIN creation required"
from public.users
order by name;
