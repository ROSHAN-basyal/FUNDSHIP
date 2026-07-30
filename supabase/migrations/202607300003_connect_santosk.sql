-- Connect the new SantosK beta account to every other active account and
-- advance all snapshots so the retired SntshN identity disappears promptly.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM public.users
    WHERE credential_id = 'SantosK'
      AND name = 'Santosh Khanal'
  ) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one SantosK / Santosh Khanal account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE LOWER(credential_id) = LOWER('SntshN')
       OR LOWER(name) = LOWER('Santosh Neupane')
  ) THEN
    RAISE EXCEPTION 'The retired Santosh Neupane account still exists';
  END IF;
END
$$;

WITH santos AS (
  SELECT id
  FROM public.users
  WHERE credential_id = 'SantosK'
    AND name = 'Santosh Khanal'
)
INSERT INTO public.connections (
  user_a,
  user_b,
  requester_id,
  status,
  created_at,
  responded_at
)
SELECT
  LEAST(santos.id, other_user.id),
  GREATEST(santos.id, other_user.id),
  santos.id,
  'accepted',
  NOW(),
  NOW()
FROM santos
CROSS JOIN public.users other_user
WHERE other_user.id <> santos.id
ON CONFLICT (user_a, user_b) DO UPDATE
SET status = 'accepted',
    requester_id = EXCLUDED.requester_id,
    responded_at = EXCLUDED.responded_at;

-- All users may have a remembered bootstrap snapshot containing the retired
-- account. Advancing every revision makes clients fetch a fresh snapshot.
UPDATE public.user_sync_state
SET revision = revision + 1,
    updated_at = NOW();

DO $$
DECLARE
  santos_id TEXT;
  expected_connections INTEGER;
  actual_connections INTEGER;
BEGIN
  SELECT id INTO santos_id
  FROM public.users
  WHERE credential_id = 'SantosK'
    AND name = 'Santosh Khanal';

  SELECT COUNT(*) - 1 INTO expected_connections
  FROM public.users;

  SELECT COUNT(*) INTO actual_connections
  FROM public.connections
  WHERE status = 'accepted'
    AND (user_a = santos_id OR user_b = santos_id);

  IF actual_connections <> expected_connections THEN
    RAISE EXCEPTION
      'SantosK connection verification failed: expected %, found %',
      expected_connections,
      actual_connections;
  END IF;
END
$$;
