-- Optional private-beta seed for an empty database.
-- For a destructive reset of an existing database, use reset_beta_users.sql.
-- The bcrypt hashes represent the administrator-provided common temporary
-- password. Each user must replace it and create a private MPIN at first login.

insert into public.users (
  id, credential_id, name, phone, password_hash, mpin_hash,
  must_change_password, avatar_color, profile_photo
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
  (gen_random_uuid()::text, 'SulavP',  'Sulav Pandey',       null, '$2b$12$kWU97TgfJJ18u2yxY./yBu.YFL/gop9N.7EvHfttwGP/4x5qYuQCu', null, true, '#327461', null)
on conflict (credential_id) do nothing;

insert into public.user_sync_state (user_id, revision, updated_at)
select id, 1, now()
from public.users
on conflict (user_id) do nothing;
