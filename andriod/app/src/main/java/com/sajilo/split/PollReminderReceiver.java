package com.sajilo.split;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class PollReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String pollId = intent == null ? null : intent.getStringExtra("pollId");
        if (pollId == null) return;
        PollPayload payload = PollNotificationManager.loadPayload(context, pollId);
        if (payload != null) PollNotificationManager.show(context, payload);
    }
}
