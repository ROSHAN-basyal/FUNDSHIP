package com.sajilo.split;

import android.app.job.JobParameters;
import android.app.job.JobService;

import org.json.JSONObject;

public class PushRegistrationJobService extends JobService {
    private FundsApi api;
    private JobParameters activeParameters;
    private volatile boolean stopped;

    @Override public boolean onStartJob(JobParameters parameters) {
        activeParameters = parameters;
        SecureSessionStore sessions = new SecureSessionStore(this);
        String fcmToken = parameters.getExtras().getString("token", PushTokenRegistration.token(this));
        if (fcmToken == null || fcmToken.isEmpty() || !sessions.exists()) return false;
        try {
            api = new FundsApi();
            api.setToken(sessions.load());
            JSONObject body = new JSONObject();
            body.put("token", fcmToken);
            body.put("deviceId", PushTokenRegistration.deviceId(this));
            body.put("appVersion", BuildConfig.VERSION_NAME);
            api.post("/android/push/register", body, new FundsApi.Callback() {
                @Override public void success(JSONObject ignored) {
                    finish(false);
                }

                @Override public void error(String ignored) {
                    finish(false);
                }

                @Override public void error(String ignored, int status, boolean networkFailure) {
                    boolean retry = networkFailure || status == 408 || status == 429 || status >= 500;
                    finish(retry);
                }
            });
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void finish(boolean retry) {
        if (stopped) return;
        if (api != null) api.shutdown();
        jobFinished(activeParameters, retry);
    }

    @Override public boolean onStopJob(JobParameters parameters) {
        stopped = true;
        if (api != null) api.shutdown();
        return true;
    }
}
