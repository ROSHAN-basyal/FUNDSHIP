import { createHash } from 'node:crypto';
import postgres from 'postgres';

type Options = Record<string, string>;

function parseOptions(values: string[]) {
  const options: Options = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) {
      throw new Error(`Expected a value after ${key}.`);
    }
    options[key.slice(2)] = values[++index];
  }
  return options;
}

function positiveInteger(value: string | undefined, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function required(options: Options, key: string) {
  const value = options[key]?.trim();
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const versionCode = positiveInteger(options['version-code'], 'Version code');
  const minimumSupportedVersionCode = positiveInteger(
    options['minimum-supported-version-code'],
    'Minimum supported version code',
  );
  if (minimumSupportedVersionCode > versionCode) {
    throw new Error('Minimum supported version code cannot exceed the release version code.');
  }
  const versionName = required(options, 'version-name');
  const priority = required(options, 'priority');
  if (priority !== 'optional' && priority !== 'mandatory') {
    throw new Error('--priority must be optional or mandatory.');
  }
  const apkUrl = required(options, 'apk-url');
  if (new URL(apkUrl).protocol !== 'https:') throw new Error('APK URL must use HTTPS.');
  const expectedSha256 = required(options, 'sha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('SHA-256 must contain 64 lowercase hexadecimal characters.');
  }
  const title = required(options, 'title');
  const message = required(options, 'message');
  const releaseNotes = options['release-notes']?.trim() || null;

  const response = await fetch(apkUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`APK download returned HTTP ${response.status}.`);
  const apk = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(apk).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error('Remote APK checksum does not match --sha256.');

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(7246941048262027)`;
      await transaction`
        UPDATE public.app_releases
        SET active=false, updated_at=now()
        WHERE platform='android' AND active=true AND version_code<>${versionCode}
      `;
      await transaction`
        INSERT INTO public.app_releases (
          platform,version_code,version_name,priority,minimum_supported_version_code,
          apk_url,sha256,file_size_bytes,title,message,release_notes,active,released_at,updated_at
        ) VALUES (
          'android',${versionCode},${versionName},${priority},${minimumSupportedVersionCode},
          ${apkUrl},${actualSha256},${apk.length},${title},${message},${releaseNotes},true,now(),now()
        )
        ON CONFLICT (platform,version_code) DO UPDATE SET
          version_name=excluded.version_name,
          priority=excluded.priority,
          minimum_supported_version_code=excluded.minimum_supported_version_code,
          apk_url=excluded.apk_url,
          sha256=excluded.sha256,
          file_size_bytes=excluded.file_size_bytes,
          title=excluded.title,
          message=excluded.message,
          release_notes=excluded.release_notes,
          active=true,
          released_at=now(),
          updated_at=now()
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.stdout.write(`${JSON.stringify({
    published: true,
    versionCode,
    versionName,
    priority,
    minimumSupportedVersionCode,
    fileSizeBytes: apk.length,
    sha256: actualSha256,
    apkUrl,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Could not publish Android release.'}\n`);
  process.exitCode = 1;
});
