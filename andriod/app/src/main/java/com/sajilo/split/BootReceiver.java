package com.sajilo.split;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        for (String pollId : PollNotificationManager.activePollIds(context)) {
            PollPayload payload = PollNotificationManager.loadPayload(context, pollId);
            if (payload != null) PollNotificationManager.scheduleReminder(context, payload, 5);
        }
    }
}
