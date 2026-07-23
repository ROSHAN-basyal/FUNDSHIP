package com.sajilo.split;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class PollActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PollPayload payload = PollPayload.fromIntent(intent);
        String action = intent == null ? null : intent.getAction();
        if (payload == null || action == null) return;
        String choice = intent.getStringExtra(PollNotificationManager.EXTRA_CHOICE);
        PendingResult pending = goAsync();
        PollNotificationManager.handleAction(context, payload, action, choice, false, pending::finish);
    }
}
