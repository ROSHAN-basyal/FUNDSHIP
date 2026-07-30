-- Replace the Santosh Neupane beta identity with a clean Santosh Khanal
-- account. This is intentionally a one-time, audited data migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  old_count INTEGER;
  replacement_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO old_count
  FROM public.users
  WHERE LOWER(credential_id) = LOWER('SntshN')
    AND LOWER(name) = LOWER('Santosh Neupane');

  SELECT COUNT(*) INTO replacement_count
  FROM public.users
  WHERE LOWER(credential_id) = LOWER('SantosK')
     OR LOWER(name) = LOWER('Santosh Khanal');

  IF old_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one SntshN / Santosh Neupane account, found %', old_count;
  END IF;

  IF replacement_count <> 0 THEN
    RAISE EXCEPTION 'SantosK or Santosh Khanal already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.group_members membership
    WHERE membership.user_id = (
      SELECT id FROM public.users
      WHERE LOWER(credential_id) = LOWER('SntshN')
        AND LOWER(name) = LOWER('Santosh Neupane')
    )
      AND membership.role = 'admin'
      AND (
        SELECT COUNT(*)
        FROM public.group_members admins
        WHERE admins.group_id = membership.group_id
          AND admins.role = 'admin'
      ) = 1
      AND (
        SELECT COUNT(*)
        FROM public.group_members members
        WHERE members.group_id = membership.group_id
      ) > 1
  ) THEN
    RAISE EXCEPTION 'SntshN is the only admin of a group with other members';
  END IF;
END
$$;

-- Notifications are not foreign-keyed to their domain entities. Remove
-- cross-user notifications before the related rows cascade away.
DELETE FROM public.app_notifications notification
WHERE (
  notification.type = 'payment_request'
  AND notification.entity_id IN (
    SELECT payment.id
    FROM public.payment_requests payment
    WHERE payment.initiator_id = (
      SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
    )
       OR payment.payer_id = (
         SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
       )
       OR payment.payee_id = (
         SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
       )
  )
) OR (
  notification.type IN ('poll_open', 'poll_approval', 'poll_result', 'event_due')
  AND notification.entity_id IN (
    SELECT poll.id
    FROM public.polls poll
    WHERE poll.creator_id = (
      SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
    )
  )
) OR (
  notification.type = 'group_invite'
  AND notification.entity_id IN (
    SELECT invitation.id
    FROM public.group_invites invitation
    WHERE invitation.inviter_id = (
      SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
    )
       OR invitation.invitee_id = (
         SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
       )
  )
) OR (
  notification.type IN ('connection_request', 'connection_accepted')
  AND notification.entity_id IN (
    SELECT connection.user_a || ':' || connection.user_b
    FROM public.connections connection
    WHERE connection.user_a = (
      SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
    )
       OR connection.user_b = (
         SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
       )
       OR connection.requester_id = (
         SELECT id FROM public.users WHERE LOWER(credential_id) = LOWER('SntshN')
       )
  )
);

DELETE FROM public.users
WHERE LOWER(credential_id) = LOWER('SntshN')
  AND LOWER(name) = LOWER('Santosh Neupane');

-- A group containing only the deleted account has no remaining audience.
DELETE FROM public.groups group_record
WHERE NOT EXISTS (
  SELECT 1
  FROM public.group_members membership
  WHERE membership.group_id = group_record.id
);

-- Remove any domain notification made stale by cascading deletes.
DELETE FROM public.app_notifications notification
WHERE (
  notification.type = 'payment_request'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_requests payment
    WHERE payment.id = notification.entity_id
  )
) OR (
  notification.type IN ('poll_open', 'poll_approval', 'poll_result', 'event_due')
  AND NOT EXISTS (
    SELECT 1 FROM public.polls poll
    WHERE poll.id = notification.entity_id
  )
) OR (
  notification.type = 'group_invite'
  AND NOT EXISTS (
    SELECT 1 FROM public.group_invites invitation
    WHERE invitation.id = notification.entity_id
  )
);

INSERT INTO public.users (
  id,
  credential_id,
  name,
  phone,
  password_hash,
  mpin_hash,
  must_change_password,
  avatar_color,
  profile_photo
)
VALUES (
  gen_random_uuid()::text,
  'SantosK',
  'Santosh Khanal',
  NULL,
  '$2b$12$uSF3O2phGbh0ETR3M3kt5eNYy4ZUo3PGaHh15t4PAex3cpJJWDaJK',
  NULL,
  TRUE,
  '#B04A38',
  NULL
);

INSERT INTO public.user_sync_state (user_id, revision, updated_at)
SELECT id, 1, NOW()
FROM public.users
WHERE LOWER(credential_id) = LOWER('SantosK');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE LOWER(credential_id) = LOWER('SntshN')
       OR LOWER(name) = LOWER('Santosh Neupane')
  ) THEN
    RAISE EXCEPTION 'The retired Santosh account still exists';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.users
    WHERE credential_id = 'SantosK'
      AND name = 'Santosh Khanal'
      AND must_change_password IS TRUE
      AND mpin_hash IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'The SantosK replacement account is invalid';
  END IF;
END
$$;
