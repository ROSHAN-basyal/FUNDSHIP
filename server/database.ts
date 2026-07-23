import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';

export type RunResult = { changes: number };

export interface AppDatabase {
  readonly kind: 'sqlite' | 'postgres';
  all<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | undefined>;
  run(query: string, params?: unknown[]): Promise<RunResult>;
  exec(query: string): Promise<void>;
  transaction<T>(work: (tx: AppDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function postgresQuery(query: string) {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

class SqliteAppDatabase implements AppDatabase {
  readonly kind = 'sqlite' as const;
  constructor(private readonly client: DatabaseSync) {}

  async all<T>(query: string, params: unknown[] = []) {
    return this.client.prepare(query).all(...params as any[]) as T[];
  }

  async get<T>(query: string, params: unknown[] = []) {
    return this.client.prepare(query).get(...params as any[]) as T | undefined;
  }

  async run(query: string, params: unknown[] = []) {
    const result = this.client.prepare(query).run(...params as any[]);
    return { changes: Number(result.changes) };
  }

  async exec(query: string) {
    this.client.exec(query);
  }

  async transaction<T>(work: (tx: AppDatabase) => Promise<T>) {
    this.client.exec('BEGIN');
    try {
      const result = await work(this);
      this.client.exec('COMMIT');
      return result;
    } catch (error) {
      this.client.exec('ROLLBACK');
      throw error;
    }
  }

  async close() {
    this.client.close();
  }
}

class PostgresAppDatabase implements AppDatabase {
  readonly kind = 'postgres' as const;
  constructor(
    private readonly client: any,
    private readonly ownsClient = false,
  ) {}

  async all<T>(query: string, params: unknown[] = []) {
    return await this.client.unsafe(postgresQuery(query), params) as T[];
  }

  async get<T>(query: string, params: unknown[] = []) {
    const rows = await this.all<T>(query, params);
    return rows[0];
  }

  async run(query: string, params: unknown[] = []) {
    const result = await this.client.unsafe(postgresQuery(query), params);
    return { changes: Number(result.count ?? result.length ?? 0) };
  }

  async exec(query: string) {
    await this.client.unsafe(query);
  }

  async transaction<T>(work: (tx: AppDatabase) => Promise<T>) {
    return await this.client.begin(async (transaction: any) =>
      work(new PostgresAppDatabase(transaction)),
    );
  }

  async close() {
    if (this.ownsClient) await this.client.end({ timeout: 5 });
  }
}

export function createDatabase(): AppDatabase {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    const client = postgres(connectionString, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_SIZE || 1),
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    });
    return new PostgresAppDatabase(client, true);
  }

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production. Use the Supabase transaction-pooler connection string.');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, 'data');
  mkdirSync(dataDir, { recursive: true });
  const path = process.env.SAJILO_DB_PATH || join(dataDir, 'sajilo.db');
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return new SqliteAppDatabase(sqlite);
}
