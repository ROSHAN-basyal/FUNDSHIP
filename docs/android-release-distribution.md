# Android beta distribution

FUNDSHIP's public download page is available at `/download`. Vercel serves the
page, while the APK itself is stored in the public Supabase Storage bucket
`app-releases`.

## Release build

The Android release signing identity is local-only:

- `andriod/fundship-release.jks`
- `andriod/keystore.properties`

Both paths are ignored by Git. Back up both files together in a secure password
manager or encrypted drive. Every future direct-download APK must use this same
key or Android will reject it as an update.

When the local signing files exist, both debug USB builds and release builds use
this distribution identity. This prevents a locally installed test build from
blocking a later website APK with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. CI
machines without the signing files continue to use Android's temporary debug
identity and their APKs must never be distributed.

Build the release APK with:

```bash
cd andriod
./gradlew clean assembleRelease
```

The signed output is:

```text
andriod/app/build/outputs/apk/release/app-release.apk
```

Install that production-connected build over USB with:

```bash
npm run android:install:release
```

If a phone already contains an older APK signed with Android's default debug
certificate, uninstall that app from every Android profile (including Private
Space or cloned-app profiles) once before installing the signed release.

Verify the APK signature and calculate its public checksum before publishing:

```bash
sdk_dir="$(sed -n 's/^sdk.dir=//p' andriod/local.properties)"
apksigner_bin="$(find "$sdk_dir/build-tools" -type f -name apksigner | sort -V | tail -1)"
"$apksigner_bin" verify --verbose --print-certs andriod/app/build/outputs/apk/release/app-release.apk
sha256sum andriod/app/build/outputs/apk/release/app-release.apk
```

## Supabase Storage

Use one public bucket with these settings:

- Name: `app-releases`
- Public access: enabled
- Maximum file size: 50 MB
- Allowed MIME types:
  - `application/vnd.android.package-archive`
  - `application/octet-stream`

Upload releases using immutable, versioned names such as:

```text
FUNDSHIP-2.1-native.apk
```

Do not overwrite old version paths. Versioned objects avoid stale CDN caches and
make rollback straightforward.

The public URL format is:

```text
https://PROJECT_REF.supabase.co/storage/v1/object/public/app-releases/FUNDSHIP-2.1-native.apk?download=FUNDSHIP-2.1-native.apk
```

Set this complete URL as the Vercel production environment variable
`VITE_ANDROID_APK_URL`, then redeploy. It is public configuration, not a secret.

## Publishing a later version

1. Increase `versionCode` and `versionName` in `andriod/app/build.gradle`.
2. Build and verify the release APK.
3. Upload it to a new versioned Supabase Storage path.
4. Update the release metadata in `src/components/DownloadPage.tsx`.
5. Update `VITE_ANDROID_APK_URL` in Vercel.
6. Build, test, commit, push, and deploy.
