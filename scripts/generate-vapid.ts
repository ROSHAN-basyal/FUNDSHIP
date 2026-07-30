import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.stdout.write(
  [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    'VAPID_SUBJECT=mailto:your-admin-email@example.com',
    '',
    'Add these three values to Vercel Production, Preview, and Development as needed.',
    'Keep VAPID_PRIVATE_KEY secret. The public key is safe to expose to browsers.',
  ].join('\n'),
);
