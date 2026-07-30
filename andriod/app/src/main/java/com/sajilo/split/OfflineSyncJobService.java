package com.sajilo.split;

import android.app.job.JobParameters;
import android.app.job.JobService;

import org.json.JSONArray;
import org.json.JSONObject;

public class OfflineSyncJobService extends JobService {
    private JobParameters activeParameters;
    private OfflinePaymentQueue queue;
    private FundsApi api;
    private JSONArray items;
    private int index;
    private int synced;
    private long retryDelayMs;
    private volatile boolean stopped;

    @Override public boolean onStartJob(JobParameters params) {
        activeParameters = params;
        queue = new OfflinePaymentQueue(this);
        SecureSessionStore sessions = new SecureSessionStore(this);
        if (!sessions.exists()) return false;
        try {
            api = new FundsApi();
            api.setToken(sessions.load());
            JSONObject snapshot = new SnapshotStore(this).load();
            String userId = snapshot == null || snapshot.optJSONObject("user") == null
                ? ""
                : snapshot.optJSONObject("user").optString("id");
            if (userId.isEmpty()) return false;
            items = queue.sendable(userId);
            if (items.length() == 0) return false;
            sendNext();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void sendNext() {
        if (stopped) return;
        if (index >= items.length()) {
            queue.recordSynced(synced);
            api.shutdown();
            jobFinished(activeParameters, false);
            if (retryDelayMs > 0) OfflinePaymentQueue.schedule(this, retryDelayMs);
            return;
        }
        JSONObject item = items.optJSONObject(index++);
        if (item == null) { sendNext(); return; }
        String id = item.optString("id");
        int attempts = item.optInt("attempts") + 1;
        queue.update(id, "sending", attempts, null, 0);
        api.post(item.optString("path"), item.optJSONObject("payload"), new FundsApi.Callback() {
            @Override public void success(JSONObject ignored) {
                queue.update(id, "sent", attempts, null, 0);
                synced += 1;
                sendNext();
            }

            @Override public void error(String message) {}

            @Override public void error(String message, int status, boolean networkFailure) {
                boolean permanent = !networkFailure && status >= 400 && status < 500 && status != 408 && status != 429;
                boolean failed = permanent || attempts >= 5;
                long delaySeconds = Math.min(15 * 60, 15L * (1L << Math.min(attempts, 6)));
                long retryAt = failed ? 0 : System.currentTimeMillis() + delaySeconds * 1000;
                if (!failed) retryDelayMs = retryDelayMs == 0 ? delaySeconds * 1000 : Math.min(retryDelayMs, delaySeconds * 1000);
                queue.update(id, failed ? "failed" : "pending", attempts, message, retryAt);
                sendNext();
            }
        });
    }

    @Override public boolean onStopJob(JobParameters params) {
        stopped = true;
        if (api != null) api.shutdown();
        return true;
    }
}
