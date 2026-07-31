CREATE TABLE IF NOT EXISTS public.app_releases (
  platform text NOT NULL,
  version_code integer NOT NULL CHECK (version_code > 0),
  version_name text NOT NULL CHECK (length(version_name) BETWEEN 1 AND 80),
  priority text NOT NULL CHECK (priority IN ('optional', 'mandatory')),
  minimum_supported_version_code integer NOT NULL CHECK (minimum_supported_version_code > 0),
  apk_url text NOT NULL CHECK (apk_url ~ '^https://'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  release_notes text,
  active boolean NOT NULL DEFAULT true,
  released_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, version_code),
  CHECK (minimum_supported_version_code <= version_code)
);

CREATE INDEX IF NOT EXISTS app_releases_active_latest_idx
  ON public.app_releases(platform, version_code DESC)
  WHERE active = true;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

-- Release policy is intentionally read through the backend endpoint. Direct
-- anonymous access remains denied by RLS so publishing stays operator-only.
