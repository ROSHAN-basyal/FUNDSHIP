import { applyMigrations } from './apply-migration.js';

const productionBuild = process.env.VERCEL_ENV === 'production';
if (productionBuild) {
  await applyMigrations([
    'supabase/migrations/202607240002_performance_architecture.sql',
    'supabase/migrations/202607250001_payment_request_lifecycle.sql',
    'supabase/migrations/202607250002_first_login_onboarding.sql',
    'supabase/migrations/202607300001_offline_pwa_foundation.sql',
    'supabase/migrations/202607300002_replace_santosh_beta_account.sql',
    'supabase/migrations/202607300003_connect_santosk.sql',
  ]);
}
