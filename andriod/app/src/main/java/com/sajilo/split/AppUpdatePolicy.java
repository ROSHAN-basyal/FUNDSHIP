package com.sajilo.split;

import org.json.JSONObject;

import java.net.URI;
import java.util.Locale;

final class AppUpdatePolicy {
    final int versionCode;
    final String versionName;
    final boolean mandatory;
    final String apkUrl;
    final String sha256;
    final long fileSizeBytes;
    final String title;
    final String message;
    final String releaseNotes;

    private AppUpdatePolicy(
            int versionCode,
            String versionName,
            boolean mandatory,
            String apkUrl,
            String sha256,
            long fileSizeBytes,
            String title,
            String message,
            String releaseNotes
    ) {
        this.versionCode = versionCode;
        this.versionName = versionName;
        this.mandatory = mandatory;
        this.apkUrl = apkUrl;
        this.sha256 = sha256;
        this.fileSizeBytes = fileSizeBytes;
        this.title = title;
        this.message = message;
        this.releaseNotes = releaseNotes;
    }

    static AppUpdatePolicy fromJson(JSONObject value, int installedVersionCode) {
        if (value == null || !value.optBoolean("updateAvailable")) return null;
        int versionCode = value.optInt("latestVersionCode", 0);
        String versionName = value.optString("latestVersionName", "").trim();
        String apkUrl = value.optString("apkUrl", "").trim();
        String sha256 = value.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
        long fileSizeBytes = value.optLong("fileSizeBytes", 0);
        if (versionCode <= installedVersionCode || versionName.isEmpty() || fileSizeBytes <= 0) return null;
        if (!sha256.matches("^[0-9a-f]{64}$") || !isSecureUrl(apkUrl)) return null;
        String title = value.optString("title", "FUNDSHIP update available").trim();
        String message = value.optString("message", "Install the latest version to continue.").trim();
        return new AppUpdatePolicy(
                versionCode,
                versionName,
                value.optBoolean("mandatory"),
                apkUrl,
                sha256,
                fileSizeBytes,
                title.isEmpty() ? "FUNDSHIP update available" : title,
                message.isEmpty() ? "Install the latest version to continue." : message,
                value.optString("releaseNotes", "").trim()
        );
    }

    JSONObject toJson() {
        JSONObject value = new JSONObject();
        try {
            value.put("updateAvailable", true);
            value.put("latestVersionCode", versionCode);
            value.put("latestVersionName", versionName);
            value.put("mandatory", mandatory);
            value.put("apkUrl", apkUrl);
            value.put("sha256", sha256);
            value.put("fileSizeBytes", fileSizeBytes);
            value.put("title", title);
            value.put("message", message);
            value.put("releaseNotes", releaseNotes);
        } catch (Exception ignored) {}
        return value;
    }

    private static boolean isSecureUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
        } catch (Exception ignored) {
            return false;
        }
    }
}
