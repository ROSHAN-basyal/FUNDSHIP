import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export async function applyMigrations(files: string[]) {
  if (files.length === 0) {
    throw new Error('Pass at least one SQL migration file.');
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.fundship_schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    for (const file of files) {
      const absolute = resolve(file);
      const name = basename(file);
      const applied = await sql<{ name: string }[]>`
        SELECT name FROM public.fundship_schema_migrations WHERE name=${name}
      `;
      if (applied.length > 0) {
        process.stdout.write(`Already applied ${name}\n`);
        continue;
      }
      const migration = await readFile(absolute, 'utf8');
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          INSERT INTO public.fundship_schema_migrations (name) VALUES (${name})
        `;
      });
      process.stdout.write(`Applied ${name}\n`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  applyMigrations(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Migration failed.'}\n`);
    process.exitCode = 1;
  });
}
