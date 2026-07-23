package com.sajilo.split;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.media.RingtoneManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

final class PollNotificationManager {
    static final String CHANNEL_ID = "urgent_poll_alerts_v3";
    private static final String LEGACY_CALL_CHANNEL_ID = "incoming_poll_calls_v2";
    static final String ACTION_YES = "com.sajilo.split.POLL_YES";
    static final String ACTION_NO = "com.sajilo.split.POLL_NO";
    static final String ACTION_OPTION = "com.sajilo.split.POLL_OPTION";
    static final String ACTION_LATER = "com.sajilo.split.POLL_LATER";
    static final String ACTION_DISMISSED = "com.sajilo.split.POLL_DISMISSED";
    static final String EXTRA_CHOICE = "poll_choice";
    private static final String PREFS = "sajilo_poll_notifications";
    private static final String ACTIVE_IDS = "active_poll_ids";
    private static final String PAYLOAD_PREFIX = "payload_";
    private static final String PENDING_ACTIONS = "pending_actions";

    private PollNotificationManager() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.deleteNotificationChannel(LEGACY_CALL_CHANNEL_ID);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.poll_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.poll_channel_description));
        channel.enableLights(true);
        channel.setLightColor(Color.rgb(221, 112, 74));
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 500, 260, 500, 260, 850 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(true);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio);
        manager.createNotificationChannel(channel);
    }

    static boolean notificationsGranted(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    static boolean canUseFullScreenIntent(Context context) {
        return NotificationManagerCompat.from(context).canUseFullScreenIntent();
    }

    @SuppressLint("MissingPermission")
    static boolean show(Context context, PollPayload payload) {
        if (payload == null || payload.pollId.isEmpty()) return false;
        createChannel(context);
        savePayload(context, payload);
        if (!notificationsGranted(context)) return false;

        PendingIntent fullScreen = PendingIntent.getActivity(
            context, requestCode(payload.pollId, "full"),
            new Intent(context, PollAlertActivity.class)
                .putExtra(PollPayload.EXTRA_JSON, payload.asIntentExtra())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            pendingFlags()
        );

        boolean optionPoll = "options".equals(payload.pollType);
        String summary = payload.dateLabel + " · " + payload.timeLabel + " · " + payload.yesCount + " of " + payload.minYes + (optionPoll ? " votes" : " yes");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_poll)
            .setColor(Color.rgb(221, 112, 74))
            .setContentTitle(payload.groupEmoji + "  " + payload.groupName)
            .setContentText(payload.title)
            .setSubText(summary)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(payload.title + "\n" + summary))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_LIGHTS | NotificationCompat.DEFAULT_VIBRATE)
            .setAutoCancel(false)
            .setOngoing(false)
            .setOnlyAlertOnce(false)
            .setContentIntent(fullScreen)
            .setDeleteIntent(actionIntent(context, payload, ACTION_DISMISSED, "dismiss"));

        if (optionPoll) {
            int visibleChoices = Math.min(payload.options.length(), payload.options.length() > 3 ? 2 : 3);
            for (int index = 0; index < visibleChoices; index++) {
                JSONObject option = payload.options.optJSONObject(index);
                if (option == null) continue;
                builder.addAction(R.drawable.ic_action_yes, option.optString("label", "Choose"),
                    optionIntent(context, payload, option.optString("id"), "option_" + index));
            }
            if (payload.options.length() > 3) builder.addAction(R.drawable.ic_stat_poll, "More options", fullScreen);
            else if (payload.options.length() == 0) builder.addAction(R.drawable.ic_stat_poll, "View options", fullScreen);
        } else {
            builder.addAction(R.drawable.ic_action_decline, context.getString(R.string.poll_no), actionIntent(context, payload, ACTION_NO, "no"));
            builder.addAction(R.drawable.ic_action_later, context.getString(R.string.poll_later), actionIntent(context, payload, ACTION_LATER, "later"));
            builder.addAction(R.drawable.ic_action_yes, context.getString(R.string.poll_yes), actionIntent(context, payload, ACTION_YES, "yes"));
        }

        if (canUseFullScreenIntent(context)) builder.setFullScreenIntent(fullScreen, true);
        Notification notification = builder.build();
        NotificationManagerCompat.from(context).notify(notificationId(payload.pollId), notification);
        return true;
    }

    static void handleAction(Context context, PollPayload payload, String action, boolean launchApp) {
        handleAction(context, payload, action, null, launchApp, () -> {});
    }

    static void handleAction(Context context, PollPayload payload, String action, String choice, boolean launchApp, Runnable finished) {
        if (payload == null) return;
        if (ACTION_LATER.equals(action) || ACTION_DISMISSED.equals(action)) {
            NotificationManagerCompat.from(context).cancel(notificationId(payload.pollId));
            scheduleReminder(context, payload, payload.remindAfterMinutes);
            finished.run();
            return;
        }

        String vote = ACTION_YES.equals(action) ? "yes" : ACTION_NO.equals(action) ? "no" : ACTION_OPTION.equals(action) ? choice : "";
        if (vote == null || vote.isEmpty()) { finished.run(); return; }
        submitVote(context, payload, vote, () -> {
            if (launchApp) {
                Intent app = new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                context.startActivity(app);
            }
            finished.run();
        });
    }

    private static void submitVote(Context context, PollPayload payload, String choice, Runnable finished) {
        NotificationManagerCompat.from(context).cancel(notificationId(payload.pollId));
        savePendingAction(context, payload.pollId, choice);
        removePayload(context, payload.pollId);
        String token="";
        try { SecureSessionStore store=new SecureSessionStore(context);if(store.exists())token=store.load(); }
        catch(Exception ignored) {}
        if(token.isEmpty()){finished.run();return;}
        FundsApi api=new FundsApi();api.setToken(token);JSONObject body=new JSONObject();
        try { body.put("choice",choice); } catch(JSONException ignored) {}
        api.post("/polls/"+payload.pollId+"/vote",body,new FundsApi.Callback(){
            public void success(JSONObject response){removePendingAction(context,payload.pollId);finished.run();}
            public void error(String message){finished.run();}
        });
    }

    static void cancel(Context context, String pollId) {
        NotificationManagerCompat.from(context).cancel(notificationId(pollId));
        cancelReminder(context, pollId);
        removePayload(context, pollId);
    }

    static void scheduleReminder(Context context, PollPayload payload, int afterMinutes) {
        savePayload(context, payload);
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        long triggerAt = SystemClock.elapsedRealtime() + Math.max(1, afterMinutes) * 60_000L;
        alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, reminderIntent(context, payload.pollId));
    }

    static void cancelReminder(Context context, String pollId) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        alarm.cancel(reminderIntent(context, pollId));
    }

    static PollPayload loadPayload(Context context, String pollId) {
        return PollPayload.fromJson(prefs(context).getString(PAYLOAD_PREFIX + pollId, null));
    }

    static Set<String> activePollIds(Context context) {
        return new HashSet<>(prefs(context).getStringSet(ACTIVE_IDS, new HashSet<>()));
    }

    static JSONArray takePendingActions(Context context) {
        SharedPreferences preferences = prefs(context);
        String raw = preferences.getString(PENDING_ACTIONS, null);
        preferences.edit().remove(PENDING_ACTIONS).apply();
        if (raw == null) return new JSONArray();
        try { return new JSONArray(raw); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    static Intent fullScreenSettingsIntent(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.getPackageName()));
        }
        return notificationSettingsIntent(context);
    }

    static Intent notificationSettingsIntent(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        }
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()));
    }

    private static PendingIntent appIntent(Context context, PollPayload payload) {
        Intent intent = new Intent(context, MainActivity.class)
            .putExtra("pollId", payload.pollId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode(payload.pollId, "open"), intent, pendingFlags());
    }

    private static PendingIntent actionIntent(Context context, PollPayload payload, String action, String suffix) {
        Intent intent = new Intent(context, PollActionReceiver.class)
            .setAction(action)
            .putExtra(PollPayload.EXTRA_JSON, payload.asIntentExtra());
        return PendingIntent.getBroadcast(context, requestCode(payload.pollId, suffix), intent, pendingFlags());
    }

    private static PendingIntent optionIntent(Context context, PollPayload payload, String choice, String suffix) {
        Intent intent = new Intent(context, PollActionReceiver.class)
            .setAction(ACTION_OPTION)
            .putExtra(EXTRA_CHOICE, choice)
            .putExtra(PollPayload.EXTRA_JSON, payload.asIntentExtra());
        return PendingIntent.getBroadcast(context, requestCode(payload.pollId, suffix), intent, pendingFlags());
    }

    private static PendingIntent reminderIntent(Context context, String pollId) {
        Intent intent = new Intent(context, PollReminderReceiver.class).setAction("remind:" + pollId).putExtra("pollId", pollId);
        return PendingIntent.getBroadcast(context, requestCode(pollId, "alarm"), intent, pendingFlags());
    }

    private static void savePayload(Context context, PollPayload payload) {
        SharedPreferences preferences = prefs(context);
        Set<String> ids = new HashSet<>(preferences.getStringSet(ACTIVE_IDS, new HashSet<>()));
        ids.add(payload.pollId);
        preferences.edit().putString(PAYLOAD_PREFIX + payload.pollId, payload.asIntentExtra()).putStringSet(ACTIVE_IDS, ids).apply();
    }

    private static void removePayload(Context context, String pollId) {
        SharedPreferences preferences = prefs(context);
        Set<String> ids = new HashSet<>(preferences.getStringSet(ACTIVE_IDS, new HashSet<>()));
        ids.remove(pollId);
        preferences.edit().remove(PAYLOAD_PREFIX + pollId).putStringSet(ACTIVE_IDS, ids).apply();
        cancelReminder(context, pollId);
    }

    private static void savePendingAction(Context context, String pollId, String action) {
        SharedPreferences preferences = prefs(context);
        JSONArray existing;
        try { existing = new JSONArray(preferences.getString(PENDING_ACTIONS, "[]")); }
        catch (JSONException ignored) { existing = new JSONArray(); }
        JSONArray queued = new JSONArray();
        for (int index = 0; index < existing.length(); index++) {
            JSONObject item = existing.optJSONObject(index);
            if (item != null && !pollId.equals(item.optString("pollId"))) queued.put(item);
        }
        JSONObject next = new JSONObject();
        try { next.put("pollId", pollId); next.put("action", action); queued.put(next); }
        catch (JSONException ignored) {}
        preferences.edit().putString(PENDING_ACTIONS, queued.toString()).apply();
    }

    private static void removePendingAction(Context context,String pollId){
        SharedPreferences preferences=prefs(context);JSONArray existing;
        try { existing=new JSONArray(preferences.getString(PENDING_ACTIONS,"[]")); }
        catch(JSONException ignored){existing=new JSONArray();}
        JSONArray queued=new JSONArray();for(int index=0;index<existing.length();index++){JSONObject item=existing.optJSONObject(index);if(item!=null&&!pollId.equals(item.optString("pollId")))queued.put(item);}
        preferences.edit().putString(PENDING_ACTIONS,queued.toString()).apply();
    }

    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static int requestCode(String pollId, String suffix) { return (pollId + suffix).hashCode() & 0x7fffffff; }
    private static int notificationId(String pollId) { return pollId.hashCode() & 0x7fffffff; }
    private static int pendingFlags() { return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE; }
}
