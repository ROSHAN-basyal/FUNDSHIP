package com.sajilo.split;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class OfflinePaymentQueue {
    static final int JOB_ID = 47102;
    private static final String PREFS = "fundship_offline_payments";
    private static final String KEY_ALIAS = "fundship_offline_payments_v1";
    private final Context context;
    private final SharedPreferences prefs;

    OfflinePaymentQueue(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized JSONObject enqueue(
        String userId,
        String kind,
        String path,
        JSONObject payload,
        String label,
        double amount,
        String purpose
    ) {
        JSONArray items = load();
        String now = isoNow();
        JSONObject item = new JSONObject();
        try {
            String id = payload.optString("clientRequestId");
            if (id.isEmpty()) id = UUID.randomUUID().toString();
            payload.put("clientRequestId", id);
            item.put("id", id);
            item.put("userId", userId);
            item.put("kind", kind);
            item.put("path", path);
            item.put("payload", new JSONObject(payload.toString()));
            item.put("label", label);
            item.put("amount", amount);
            item.put("purpose", purpose);
            item.put("status", "pending");
            item.put("attempts", 0);
            item.put("createdAt", now);
            item.put("updatedAt", now);
            items.put(item);
            save(items);
        } catch (Exception ignored) {}
        schedule(context, 0);
        return item;
    }

    synchronized JSONArray forUser(String userId) {
        JSONArray result = new JSONArray();
        for (JSONObject item : NativeUi.objects(load())) {
            if (userId.equals(item.optString("userId"))) result.put(item);
        }
        return result;
    }

    synchronized JSONArray sendable(String userId) {
        JSONArray result = new JSONArray();
        long now = System.currentTimeMillis();
        for (JSONObject item : NativeUi.objects(load())) {
            if (!userId.equals(item.optString("userId"))) continue;
            String status = item.optString("status");
            if ("sent".equals(status)) continue;
            if ("failed".equals(status)) continue;
            long next = item.optLong("nextAttemptAt", 0);
            if (next > now) continue;
            result.put(item);
        }
        return result;
    }

    synchronized void update(String id, String status, int attempts, String error, long nextAttemptAt) {
        JSONArray items = load();
        for (JSONObject item : NativeUi.objects(items)) {
            if (!id.equals(item.optString("id"))) continue;
            try {
                item.put("status", status);
                item.put("attempts", attempts);
                item.put("updatedAt", isoNow());
                if (error == null || error.isEmpty()) item.remove("lastError"); else item.put("lastError", error);
                if (nextAttemptAt <= 0) item.remove("nextAttemptAt"); else item.put("nextAttemptAt", nextAttemptAt);
            } catch (Exception ignored) {}
            break;
        }
        save(trimSent(items));
    }

    synchronized void recordSynced(int count) {
        if (count <= 0) return;
        prefs.edit().putInt("synced_count", prefs.getInt("synced_count", 0) + count).apply();
    }

    synchronized int consumeSyncedCount() {
        int count = prefs.getInt("synced_count", 0);
        if (count > 0) prefs.edit().remove("synced_count").apply();
        return count;
    }

    private JSONArray load() {
        String encoded = prefs.getString("ciphertext", "");
        String iv = prefs.getString("iv", "");
        if (encoded.isEmpty() || iv.isEmpty()) return new JSONArray();
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String json = new String(cipher.doFinal(Base64.decode(encoded, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            return new JSONArray(json);
        } catch (Exception error) {
            prefs.edit().remove("ciphertext").remove("iv").apply();
            return new JSONArray();
        }
    }

    private void save(JSONArray items) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(items.toString().getBytes(StandardCharsets.UTF_8));
            prefs.edit()
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .commit();
        } catch (Exception ignored) {}
    }

    private static JSONArray trimSent(JSONArray items) {
        int sent = 0;
        for (JSONObject item : NativeUi.objects(items)) if ("sent".equals(item.optString("status"))) sent += 1;
        if (sent <= 50) return items;
        JSONArray kept = new JSONArray();
        int remove = sent - 50;
        for (JSONObject item : NativeUi.objects(items)) {
            if (remove > 0 && "sent".equals(item.optString("status"))) {
                remove -= 1;
                continue;
            }
            kept.put(item);
        }
        return kept;
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private static String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    static void schedule(Context context, long minimumLatencyMs) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo.Builder job = new JobInfo.Builder(
            JOB_ID,
            new ComponentName(context, OfflineSyncJobService.class)
        ).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL);
        if (minimumLatencyMs > 0) job.setMinimumLatency(minimumLatencyMs);
        scheduler.schedule(job.build());
    }
}
