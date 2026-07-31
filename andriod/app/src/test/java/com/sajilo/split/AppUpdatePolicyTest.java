package com.sajilo.split;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AppUpdatePolicyTest {
    private JSONObject validPolicy() throws Exception {
        return new JSONObject()
                .put("updateAvailable", true)
                .put("latestVersionCode", 6)
                .put("latestVersionName", "2.4-native")
                .put("mandatory", true)
                .put("apkUrl", "https://example.supabase.co/storage/v1/object/public/app-releases/FUNDSHIP-2.4-native.apk")
                .put("sha256", "a".repeat(64))
                .put("fileSizeBytes", 4_800_000)
                .put("title", "Update required")
                .put("message", "Install the secure update.")
                .put("releaseNotes", "Faster sync");
    }

    @Test public void parsesValidMandatoryRelease() throws Exception {
        AppUpdatePolicy policy = AppUpdatePolicy.fromJson(validPolicy(), 5);
        assertEquals(6, policy.versionCode);
        assertTrue(policy.mandatory);
        assertEquals("2.4-native", policy.versionName);
    }

    @Test public void ignoresCurrentOrOlderRelease() throws Exception {
        assertNull(AppUpdatePolicy.fromJson(validPolicy().put("latestVersionCode", 5), 5));
    }

    @Test public void rejectsInsecureOrUnverifiablePackage() throws Exception {
        assertNull(AppUpdatePolicy.fromJson(validPolicy().put("apkUrl", "http://example.com/update.apk"), 5));
        assertNull(AppUpdatePolicy.fromJson(validPolicy().put("sha256", "not-a-checksum"), 5));
    }
}
