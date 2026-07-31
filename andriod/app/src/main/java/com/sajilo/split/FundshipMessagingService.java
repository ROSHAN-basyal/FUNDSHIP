package com.sajilo.split;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class FundshipMessagingService extends FirebaseMessagingService {
    @Override public void onCreate() {
        super.onCreate();
        PollNotificationManager.createChannel(this);
        PaymentNotificationManager.createChannel(this);
    }

    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        if (!new SecureSessionStore(this).exists()) return;
        Map<String, String> data = message.getData();
        String kind = data.get("kind");
        if ("poll_open".equals(kind)) {
            PollPayload payload = PollPayload.fromJson(data.get("pollPayload"));
            if (payload != null && !PollNotificationManager.wasDelivered(this, payload.pollId)) {
                PollNotificationManager.show(this, payload);
            }
            return;
        }
        if ("payment_request".equals(kind)) {
            int amount;
            try { amount = Integer.parseInt(data.getOrDefault("amount", "0")); }
            catch (NumberFormatException ignored) { amount = 0; }
            String requestId = data.getOrDefault("requestId", "");
            if (!PaymentNotificationManager.wasDelivered(this, requestId)) {
                PaymentNotificationManager.showIncoming(
                    this,
                    requestId,
                    data.getOrDefault("senderName", "A connection"),
                    amount,
                    data.getOrDefault("purpose", "Payment request")
                );
            }
        }
    }

    @Override public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushTokenRegistration.tokenChanged(this, token);
    }

    @Override public void onDeletedMessages() {
        // The normal authenticated sync reconciles missed state the next time
        // FUNDSHIP opens. Refreshing registration here repairs rotated tokens
        // without starting a persistent background service.
        PushTokenRegistration.refresh(this);
    }
}
