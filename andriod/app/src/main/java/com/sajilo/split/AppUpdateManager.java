package com.sajilo.split;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Server-controlled, checksum-verified updater for the directly distributed APK. */
final class AppUpdateManager {
    private static final String PREFS = "fundship_update_manager";
    private static final String POLICY = "policy";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String DOWNLOAD_VERSION = "download_version";
    private static final String DISMISSED_VERSION = "dismissed_version";
    private static final String MIME_APK = "application/vnd.android.package-archive";
    private static final long CHECK_INTERVAL_MS = 15 * 60 * 1000L;

    private final MainActivity activity;
    private final FundsApi api;
    private final DownloadManager downloads;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService verifier = Executors.newSingleThreadExecutor();
    private final Runnable periodicCheck = new Runnable() {
        @Override public void run() {
            check(false);
            if (foreground) handler.postDelayed(this, CHECK_INTERVAL_MS);
        }
    };
    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long expected = preferences.getLong(DOWNLOAD_ID, -1);
            long completed = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (expected > 0 && completed == expected) inspectDownload(true);
        }
    };

    private AppUpdatePolicy policy;
    private FundshipSheet updateSheet;
    private long lastCheckAt;
    private boolean foreground;
    private boolean receiverRegistered;
    private boolean checkInFlight;
    private boolean verifyInFlight;
    private boolean waitingForInstallPermission;
    private boolean installerPromptAttempted;
    private File verifiedApk;

    AppUpdateManager(MainActivity activity, FundsApi api) {
        this.activity = activity;
        this.api = api;
        this.downloads = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        this.preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.policy = cachedPolicy();
    }

    void onResume() {
        foreground = true;
        registerReceiver();
        if (waitingForInstallPermission && canRequestPackageInstalls()) {
            waitingForInstallPermission = false;
            launchInstaller();
        } else {
            showPolicyIfNeeded();
            inspectDownload(false);
        }
        check(false);
        handler.removeCallbacks(periodicCheck);
        handler.postDelayed(periodicCheck, CHECK_INTERVAL_MS);
    }

    void onPause() {
        foreground = false;
        handler.removeCallbacks(periodicCheck);
        unregisterReceiver();
    }

    void destroy() {
        handler.removeCallbacksAndMessages(null);
        unregisterReceiver();
        verifier.shutdownNow();
    }

    private void check(boolean force) {
        if (!foreground || checkInFlight) return;
        long now = System.currentTimeMillis();
        if (!force && now - lastCheckAt < CHECK_INTERVAL_MS) return;
        lastCheckAt = now;
        checkInFlight = true;
        api.get("/app-update?platform=android&versionCode=" + BuildConfig.VERSION_CODE, new FundsApi.Callback() {
            @Override public void success(JSONObject response) {
                checkInFlight = false;
                AppUpdatePolicy next = AppUpdatePolicy.fromJson(response, BuildConfig.VERSION_CODE);
                if (next == null) {
                    clearPolicy();
                    return;
                }
                if (policy != null && policy.versionCode != next.versionCode) {
                    closeUpdateSheet();
                    clearDownloadTracking(preferences.getLong(DOWNLOAD_ID, -1));
                }
                policy = next;
                preferences.edit().putString(POLICY, next.toJson().toString()).apply();
                showPolicyIfNeeded();
            }

            @Override public void error(String ignored) { checkInFlight = false; }
        });
    }

    private AppUpdatePolicy cachedPolicy() {
        try {
            return AppUpdatePolicy.fromJson(
                    new JSONObject(preferences.getString(POLICY, "{}")),
                    BuildConfig.VERSION_CODE
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    private void clearPolicy() {
        policy = null;
        preferences.edit().remove(POLICY).apply();
        closeUpdateSheet();
        clearDownloadTracking(preferences.getLong(DOWNLOAD_ID, -1));
    }

    private void closeUpdateSheet() {
        if (updateSheet == null) return;
        FundshipSheet closing = updateSheet;
        updateSheet = null;
        closing.dismiss();
    }

    private void showPolicyIfNeeded() {
        if (!foreground || policy == null || updateSheet != null) return;
        if (!policy.mandatory && preferences.getInt(DISMISSED_VERSION, 0) >= policy.versionCode) return;

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        TextView version = NativeUi.text(activity, "VERSION " + policy.versionName.toUpperCase(Locale.ROOT), 10, NativeUi.GREEN, true);
        version.setGravity(Gravity.CENTER);
        version.setLetterSpacing(.1f);
        version.setBackground(NativeUi.shape(activity, NativeUi.GREEN_SOFT, 15));
        content.addView(version, new LinearLayout.LayoutParams(-1, NativeUi.dp(activity, 36)));

        TextView message = NativeUi.text(activity, policy.message, 14, NativeUi.INK, false);
        message.setLineSpacing(0, 1.15f);
        content.addView(message, NativeUi.margins(activity, new LinearLayout.LayoutParams(-1, -2), 2, 18, 2, 0));

        if (!policy.releaseNotes.isEmpty()) {
            TextView label = NativeUi.text(activity, "WHAT'S NEW", 9, NativeUi.MUTED, true);
            label.setLetterSpacing(.12f);
            content.addView(label, NativeUi.margins(activity, new LinearLayout.LayoutParams(-1, NativeUi.dp(activity, 24)), 2, 18, 2, 0));
            TextView notes = NativeUi.text(activity, policy.releaseNotes, 13, NativeUi.INK, false);
            notes.setPadding(NativeUi.dp(activity, 13), NativeUi.dp(activity, 11), NativeUi.dp(activity, 13), NativeUi.dp(activity, 11));
            notes.setLineSpacing(0, 1.12f);
            notes.setBackground(NativeUi.outlined(activity, Color.WHITE, NativeUi.LINE, 13));
            content.addView(notes, new LinearLayout.LayoutParams(-1, -2));
        }

        if (policy.mandatory) {
            TextView required = NativeUi.text(activity, "This update is required to continue using FUNDSHIP.", 12, NativeUi.ORANGE, true);
            required.setPadding(NativeUi.dp(activity, 12), NativeUi.dp(activity, 10), NativeUi.dp(activity, 12), NativeUi.dp(activity, 10));
            required.setBackground(NativeUi.shape(activity, Color.rgb(252, 237, 229), 12));
            content.addView(required, NativeUi.margins(activity, new LinearLayout.LayoutParams(-1, -2), 0, 16, 0, 0));
        }

        AppUpdatePolicy shown = policy;
        updateSheet = FundshipSheet.show(
                activity,
                shown.mandatory ? "REQUIRED UPDATE" : "UPDATE AVAILABLE",
                shown.title,
                "A verified FUNDSHIP package will be downloaded, then Android will ask you to approve installation.",
                content,
                "Update now",
                76,
                ignored -> beginUpdate()
        );
        updateSheet.setCancelable(!shown.mandatory);
        updateSheet.setOnDismiss(() -> {
            if (updateSheet == null) return;
            if (!shown.mandatory) preferences.edit().putInt(DISMISSED_VERSION, shown.versionCode).apply();
            updateSheet = null;
        });
        inspectDownload(false);
    }

    private void beginUpdate() {
        if (policy == null) return;
        long existingId = preferences.getLong(DOWNLOAD_ID, -1);
        int existingVersion = preferences.getInt(DOWNLOAD_VERSION, 0);
        if (existingId > 0 && existingVersion == policy.versionCode) {
            inspectDownload(true);
            return;
        }
        if (existingId > 0) clearDownloadTracking(existingId);
        if (downloads == null) {
            openBrowserFallback();
            return;
        }
        try {
            String fileName = "FUNDSHIP-" + policy.versionName.replaceAll("[^A-Za-z0-9._-]", "-") + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(policy.apkUrl))
                    .setTitle("FUNDSHIP " + policy.versionName)
                    .setDescription("Downloading verified app update")
                    .setMimeType(MIME_APK)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName);
            long id = downloads.enqueue(request);
            preferences.edit().putLong(DOWNLOAD_ID, id).putInt(DOWNLOAD_VERSION, policy.versionCode).apply();
            installerPromptAttempted = false;
            if (updateSheet != null) updateSheet.setBusy(true, "Downloading…", "Update now");
            activity.toast("Update download started");
        } catch (Exception ignored) {
            activity.toast("Could not start the update download. Opening the download page instead.");
            openBrowserFallback();
        }
    }

    private void inspectDownload(boolean userRequested) {
        if (!foreground || policy == null || downloads == null || verifyInFlight) return;
        long id = preferences.getLong(DOWNLOAD_ID, -1);
        if (id <= 0 || preferences.getInt(DOWNLOAD_VERSION, 0) != policy.versionCode) return;
        try (Cursor cursor = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                if (installerPromptAttempted && !userRequested) return;
                verifyDownloadedApk(id);
            } else if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                if (updateSheet != null) updateSheet.setBusy(true, "Downloading…", "Update now");
                if (userRequested) activity.toast("The update is still downloading");
            } else if (status == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                clearDownloadTracking(id);
                if (updateSheet != null) updateSheet.setBusy(false, "Downloading…", "Try download again");
                activity.toast("Update download failed (" + reason + "). Please retry.");
            }
        } catch (Exception ignored) {
            if (userRequested) openBrowserFallback();
        }
    }

    private void verifyDownloadedApk(long id) {
        if (policy == null || verifyInFlight) return;
        verifyInFlight = true;
        AppUpdatePolicy target = policy;
        if (updateSheet != null) updateSheet.setBusy(true, "Checking update…", "Update now");
        verifier.execute(() -> {
            File result = null;
            String error = null;
            try {
                result = copyAndVerify(id, target);
            } catch (Exception failure) {
                error = failure.getMessage() == null ? "The downloaded update could not be verified." : failure.getMessage();
            }
            File verified = result;
            String failureMessage = error;
            activity.runOnUiThread(() -> {
                verifyInFlight = false;
                if (verified == null) {
                    clearDownloadTracking(id);
                    if (updateSheet != null) updateSheet.setBusy(false, "Checking update…", "Try download again");
                    activity.toast(failureMessage);
                    return;
                }
                verifiedApk = verified;
                if (updateSheet != null) updateSheet.setBusy(false, "Checking update…", "Open installer");
                requestInstallerAccess();
            });
        });
    }

    private File copyAndVerify(long id, AppUpdatePolicy target) throws Exception {
        File updateDir = new File(activity.getCacheDir(), "updates");
        if (!updateDir.exists() && !updateDir.mkdirs()) throw new Exception("Could not prepare update storage.");
        File temporary = new File(updateDir, "pending-" + target.versionCode + ".tmp");
        File verified = new File(updateDir, "FUNDSHIP-" + target.versionCode + ".apk");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        try (ParcelFileDescriptor descriptor = downloads.openDownloadedFile(id);
             FileInputStream input = new FileInputStream(descriptor.getFileDescriptor());
             FileOutputStream output = new FileOutputStream(temporary, false)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                bytes += read;
            }
            output.getFD().sync();
        }
        String actual = hex(digest.digest());
        if (bytes != target.fileSizeBytes || !actual.equals(target.sha256)) {
            temporary.delete();
            throw new Exception("The update failed its security check. Please download it again.");
        }
        validatePackage(temporary, target.versionCode);
        if (verified.exists() && !verified.delete()) throw new Exception("Could not replace the previous update file.");
        if (!temporary.renameTo(verified)) throw new Exception("Could not prepare the verified update.");
        return verified;
    }

    private void validatePackage(File apk, int expectedVersionCode) throws Exception {
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(activity.getPackageName(), flags);
        if (archive == null || !activity.getPackageName().equals(archive.packageName)) {
            throw new Exception("The downloaded file is not a FUNDSHIP package.");
        }
        long archiveVersion = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (archiveVersion != expectedVersionCode || archiveVersion <= BuildConfig.VERSION_CODE) {
            throw new Exception("The downloaded package has the wrong version.");
        }
        if (!Arrays.equals(signatures(archive), signatures(installed))) {
            throw new Exception("The update signature does not match this FUNDSHIP installation.");
        }
    }

    private byte[] signatures(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        else signatures = info.signatures;
        if (signatures == null || signatures.length == 0) throw new Exception("The update signature is missing.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) digest.update(signature.toByteArray());
        return digest.digest();
    }

    private void requestInstallerAccess() {
        if (verifiedApk == null || !verifiedApk.exists()) return;
        if (!canRequestPackageInstalls()) {
            try {
                waitingForInstallPermission = true;
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())
                );
                activity.startActivity(settings);
                activity.toast("Allow FUNDSHIP to install this verified update, then return");
                return;
            } catch (Exception ignored) {
                waitingForInstallPermission = false;
            }
        }
        launchInstaller();
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void launchInstaller() {
        if (verifiedApk == null || !verifiedApk.exists()) {
            inspectDownload(true);
            return;
        }
        try {
            Uri apk = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    verifiedApk
            );
            Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE)
                    .setData(apk)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installerPromptAttempted = true;
            activity.startActivity(install);
        } catch (Exception primaryFailure) {
            try {
                Uri apk = FileProvider.getUriForFile(
                        activity,
                        activity.getPackageName() + ".fileprovider",
                        verifiedApk
                );
                Intent view = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(apk, MIME_APK)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installerPromptAttempted = true;
                activity.startActivity(view);
            } catch (Exception ignored) {
                activity.toast("Android could not open the installer. Opening the download link instead.");
                openBrowserFallback();
            }
        }
    }

    private void openBrowserFallback() {
        if (policy == null) return;
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(policy.apkUrl)));
        } catch (Exception ignored) {
            activity.toast("No browser is available to download the update.");
        }
    }

    private void clearDownloadTracking(long id) {
        if (downloads != null && id > 0) {
            try { downloads.remove(id); } catch (Exception ignored) {}
        }
        preferences.edit().remove(DOWNLOAD_ID).remove(DOWNLOAD_VERSION).apply();
        File updateDir = new File(activity.getCacheDir(), "updates");
        File[] cachedFiles = updateDir.listFiles();
        if (cachedFiles != null) for (File file : cachedFiles) file.delete();
        verifiedApk = null;
        installerPromptAttempted = false;
    }

    private void registerReceiver() {
        if (receiverRegistered) return;
        ContextCompat.registerReceiver(
                activity,
                downloadReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED
        );
        receiverRegistered = true;
    }

    private void unregisterReceiver() {
        if (!receiverRegistered) return;
        try { activity.unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
        receiverRegistered = false;
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }
}
