package com.sajilo.split;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.PersistableBundle;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.UUID;

final class PushTokenRegistration {
    static final int JOB_ID = 47103;
    private static final String PREFS = "fundship_android_push";
    private static final String DEVICE_ID = "device_id";
    private static final String FCM_TOKEN = "fcm_token";

    private PushTokenRegistration() {}

    static void refresh(Context context) {
        Context app = context.getApplicationContext();
        try {
            if (FirebaseApp.getApps(app).isEmpty() && FirebaseApp.initializeApp(app) == null) return;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null || task.getResult().isEmpty()) return;
                saveToken(app, task.getResult());
                schedule(app);
            });
        } catch (RuntimeException ignored) {
            // A build without google-services.json remains usable, but cannot
            // register for background push until Firebase is configured.
        }
    }

    static void tokenChanged(Context context, String token) {
        if (token == null || token.isEmpty()) return;
        saveToken(context, token);
        schedule(context);
    }

    static String token(Context context) {
        return preferences(context).getString(FCM_TOKEN, "");
    }

    static String deviceId(Context context) {
        SharedPreferences preferences = preferences(context);
        String existing = preferences.getString(DEVICE_ID, "");
        if (!existing.isEmpty()) return existing;
        String created = UUID.randomUUID().toString();
        preferences.edit().putString(DEVICE_ID, created).apply();
        return created;
    }

    static void cancelPending(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }

    static void schedule(Context context) {
        if (token(context).isEmpty() || !new SecureSessionStore(context).exists()) return;
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        PersistableBundle extras = new PersistableBundle();
        extras.putString("token", token(context));
        JobInfo job = new JobInfo.Builder(
            JOB_ID,
            new ComponentName(context, PushRegistrationJobService.class)
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setExtras(extras)
            .build();
        scheduler.schedule(job);
    }

    private static void saveToken(Context context, String token) {
        preferences(context).edit().putString(FCM_TOKEN, token).apply();
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
