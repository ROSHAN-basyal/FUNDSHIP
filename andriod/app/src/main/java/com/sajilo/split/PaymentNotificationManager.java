package com.sajilo.split;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

final class PaymentNotificationManager {
    static final String CHANNEL_ID = "payment_requests_v1";
    private static final String GROUP_KEY = "sajilo_incoming_payments";
    private static final String PREFS = "fundship_payment_notifications";
    private static final String DELIVERED_IDS = "delivered_ids";

    private PaymentNotificationManager() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.payment_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.payment_channel_description));
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 220, 120, 220 });
        channel.enableLights(true);
        channel.setLightColor(Color.rgb(38, 118, 99));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    @SuppressLint("MissingPermission")
    static boolean showIncoming(Context context, String requestId, String senderName, int amount, String purpose) {
        if (requestId.isEmpty() || senderName.isEmpty() || !PollNotificationManager.notificationsGranted(context)) return false;
        createChannel(context);

        Intent app = new Intent(context, MainActivity.class)
            .putExtra("page", "home")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent review = PendingIntent.getActivity(
            context,
            requestCode(requestId),
            app,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String amountText = "NPR " + amount;
        String detail = senderName + " requested verification for " + amountText;
        Notification publicVersion = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_payment)
            .setContentTitle(context.getString(R.string.payment_public_title))
            .setContentText(context.getString(R.string.payment_public_text))
            .build();

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_payment)
            .setColor(Color.rgb(38, 118, 99))
            .setContentTitle(context.getString(R.string.payment_notification_title, senderName))
            .setContentText(detail)
            .setSubText(purpose)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(detail + "\n" + purpose))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(review)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY)
            .addAction(R.drawable.ic_action_yes, context.getString(R.string.payment_review), review)
            .build();

        NotificationManagerCompat.from(context).notify(notificationId(requestId), notification);
        markDelivered(context, requestId);
        return true;
    }

    static void cancel(Context context, String requestId) {
        NotificationManagerCompat.from(context).cancel(notificationId(requestId));
        Set<String> delivered = deliveredIds(context);
        delivered.remove(requestId);
        saveDeliveredIds(context, delivered);
    }

    static boolean wasDelivered(Context context, String requestId) {
        return deliveredIds(context).contains(requestId);
    }

    static void reconcile(Context context, JSONArray incoming) {
        Set<Integer> expected = new HashSet<>();
        Set<String> expectedIds = new HashSet<>();
        for (JSONObject item : NativeUi.objects(incoming)) {
            String id = item.optString("id");
            expected.add(notificationId(id));
            expectedIds.add(id);
        }
        Set<String> delivered = deliveredIds(context);
        if (delivered.retainAll(expectedIds)) saveDeliveredIds(context, delivered);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            String channel = active.getNotification().getChannelId();
            if (CHANNEL_ID.equals(channel) && !expected.contains(active.getId())) {
                manager.cancel(active.getId());
            }
        }
    }

    private static void markDelivered(Context context, String requestId) {
        Set<String> delivered = deliveredIds(context);
        if (delivered.size() >= 256) delivered.clear();
        delivered.add(requestId);
        saveDeliveredIds(context, delivered);
    }

    private static Set<String> deliveredIds(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return new HashSet<>(preferences.getStringSet(DELIVERED_IDS, new HashSet<>()));
    }

    private static void saveDeliveredIds(Context context, Set<String> ids) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(DELIVERED_IDS, new HashSet<>(ids))
            .apply();
    }

    private static int notificationId(String requestId) {
        return ("payment:" + requestId).hashCode() & 0x7fffffff;
    }

    private static int requestCode(String requestId) {
        return ("review:" + requestId).hashCode() & 0x7fffffff;
    }
}
