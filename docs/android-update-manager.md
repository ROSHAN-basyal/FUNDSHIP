# Android update-manager behavior

FUNDSHIP is currently distributed as a signed APK rather than through Google
Play, so it uses Android's supported direct-update flow.

## User flow

1. The app retrieves the active release policy when it starts or resumes.
2. A mandatory policy shows a non-dismissible native FUNDSHIP sheet.
3. **Update now** queues the APK in Android Download Manager. The download can
   continue if FUNDSHIP is moved to the background.
4. FUNDSHIP copies the completed package to its private cache while checking
   the exact size and SHA-256 from the server policy.
5. It also confirms the package ID, higher version code, and the same signing
   certificate as the currently installed app.
6. On Android 8 or later, the user is taken to the per-app **Install unknown
   apps** setting if FUNDSHIP has not been trusted as an install source.
7. The standard Android package-installer screen opens. The user must approve
   the final installation.

If Download Manager or the system package installer cannot be opened, FUNDSHIP
falls back to the HTTPS APK link in the device browser.

## Platform boundaries

- An ordinary Android app cannot silently update itself. Android always retains
  a user-confirmation path unless the installer has special device-owner or
  enterprise privileges.
- The release APK must keep the package ID `com.sajilo.split` and use the same
  protected release signing key as every prior public build.
- Version `2.3-native` must be installed manually once on devices running an
  older build because those builds do not contain this update manager.
- A cached mandatory policy remains blocking if the device temporarily loses
  connectivity. The Download Manager can queue the request until connectivity
  returns.

## Release safety

- APK URLs must use HTTPS and should be immutable Supabase Storage object names.
- Only the backend reads `app_releases`; Supabase RLS exposes no anonymous write
  policy.
- Activate a policy only after the public download has been checksum-verified.
- For rollback, publish a newer version code containing the rollback code.
  Android does not accept a lower version code as an in-place update.
