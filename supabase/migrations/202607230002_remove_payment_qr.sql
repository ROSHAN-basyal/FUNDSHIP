-- Remove the discontinued payment QR image feature from existing databases.
alter table public.users drop column if exists esewa_qr;
