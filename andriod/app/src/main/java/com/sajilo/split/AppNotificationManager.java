package com.sajilo.split;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

final class AppNotificationManager {
    private static final String UPDATE_CHANNEL = "sajilo_updates_v1";
    private static final String EVENT_CHANNEL = "event_reminders_v1";

    private AppNotificationManager() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel updates = new NotificationChannel(UPDATE_CHANNEL, context.getString(R.string.update_channel_name), NotificationManager.IMPORTANCE_HIGH);
        updates.setDescription(context.getString(R.string.update_channel_description));
        updates.enableVibration(true);updates.setVibrationPattern(new long[]{0,260,120,260});updates.setShowBadge(true);
        updates.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel events = new NotificationChannel(EVENT_CHANNEL, context.getString(R.string.event_channel_name), NotificationManager.IMPORTANCE_HIGH);
        events.setDescription(context.getString(R.string.event_channel_description));events.enableVibration(true);events.setShowBadge(true);
        events.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(updates);manager.createNotificationChannel(events);
    }

    @SuppressLint("MissingPermission")
    static boolean show(Context context, String id, String title, String body, String type, long persistentUntil) {
        if (id.isEmpty() || !PollNotificationManager.notificationsGranted(context)) return false;
        createChannels(context);
        boolean persistent = persistentUntil > System.currentTimeMillis();
        String channel = persistent ? EVENT_CHANNEL : UPDATE_CHANNEL;
        Intent app = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent review = PendingIntent.getActivity(context, requestCode(id), app, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_poll).setColor(Color.rgb(38,118,99)).setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(review)
            .setCategory(persistent ? NotificationCompat.CATEGORY_EVENT : NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setVisibility(persistent ? NotificationCompat.VISIBILITY_PUBLIC : NotificationCompat.VISIBILITY_PRIVATE)
            .setGroup("sajilo_" + type).setOnlyAlertOnce(persistent).setAutoCancel(!persistent).setOngoing(persistent);
        if (persistent) builder.setTimeoutAfter(Math.max(1,persistentUntil-System.currentTimeMillis()));
        else builder.addAction(R.drawable.ic_action_yes, context.getString(R.string.payment_review), review);
        Notification notification=builder.build();
        if(persistent) notification.flags|=Notification.FLAG_ONGOING_EVENT|Notification.FLAG_NO_CLEAR;
        NotificationManagerCompat.from(context).notify(notificationId(id),notification);
        return true;
    }

    private static int notificationId(String id){return ("inbox:"+id).hashCode() & 0x7fffffff;}
    private static int requestCode(String id){return ("inbox-open:"+id).hashCode() & 0x7fffffff;}
}
