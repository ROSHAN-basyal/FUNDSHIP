-- Optional development/demo seed. Do not use these known passwords for real users.
insert into public.users
  (id, credential_id, name, phone, password_hash, mpin_hash, must_change_password, avatar_color)
values
  ('u1', 'RB-001', 'Roshan Basyal', '9800000001', 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f', 'ed946f65d2c785d90e827c5ffd879ce3b49c68d4c88013074176a7e73bc58bcf', false, '#e7864a'),
  ('u2', 'NP-002', 'Nawaraj Poudel', '9800000002', '15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225', '57fb0303e4a6845cd7a1484ee9773c218975e9c9a763114e668259498cad2f30', false, '#687fbc'),
  ('u3', 'SA-003', 'Sujata Aryal', '9800000003', 'a68349561396ec264a350847024a4521d00beaa3358660c2709a80f31c7acdd0', '7768e375a15e957a64adf43f42e9c54666a035ab58596e198a4a497bb17d65e8', false, '#b76475'),
  ('u4', 'KS-004', 'Kiran Shrestha', '9800000004', 'a68349561396ec264a350847024a4521d00beaa3358660c2709a80f31c7acdd0', '43bcfd67415041651733e9f16b4126ed6b8b30b0c9e77acb9da38a542ff0eaad', false, '#4c9686'),
  ('u5', 'AP-005', 'Anish Pandey', '9800000005', 'a68349561396ec264a350847024a4521d00beaa3358660c2709a80f31c7acdd0', '6a95bbab63d587b596398c4bd7e91a132f24032d2007d107e5ea71967724b092', false, '#a779b8')
on conflict (id) do nothing;

insert into public.groups (id, name, emoji, accent)
values
  ('g1', 'Weekend Crew', '⛰️', '#dc704b'),
  ('g2', 'Office Lunch', '🥟', '#568a78'),
  ('g3', 'Cycling Circle', '🚲', '#5d77a6')
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id, role, position)
values
  ('g1', 'u1', 'admin', 0),
  ('g1', 'u2', 'member', 0),
  ('g1', 'u3', 'member', 0),
  ('g1', 'u4', 'member', 0),
  ('g1', 'u5', 'member', 0),
  ('g2', 'u1', 'member', 1),
  ('g2', 'u2', 'admin', 1),
  ('g2', 'u3', 'member', 1),
  ('g2', 'u4', 'member', 1),
  ('g3', 'u5', 'admin', 0)
on conflict (group_id, user_id) do nothing;
