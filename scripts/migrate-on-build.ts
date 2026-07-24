import { applyMigrations } from './apply-migration.js';

const productionBuild = process.env.VERCEL_ENV === 'production';
if (productionBuild) {
  await applyMigrations([
    'supabase/migrations/202607240002_performance_architecture.sql',
  ]);
}
