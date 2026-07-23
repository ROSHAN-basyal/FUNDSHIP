package com.sajilo.split;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class FundsApi {
    interface Callback {
        void success(JSONObject data);
        void error(String message);
    }

    private static final String ROOT = BuildConfig.FUNDSHIP_API_URL;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile String token = "";

    void setToken(String value) { token = value == null ? "" : value; }
    String token() { return token; }
    void clearToken() { token = ""; }

    void login(String credentialId, String password, Callback callback) {
        JSONObject body = new JSONObject();
        try { body.put("credentialId", credentialId);body.put("password", password); }
        catch (Exception ignored) {}
        request("/auth/login", "POST", body, callback);
    }

    void bootstrap(Callback callback) { request("/bootstrap", "GET", null, callback); }
    void get(String path, Callback callback) { request(path, "GET", null, callback); }
    void post(String path, JSONObject body, Callback callback) { request(path, "POST", body, callback); }
    void delete(String path, Callback callback) { request(path, "DELETE", null, callback); }

    private void request(String path, String method, JSONObject body, Callback callback) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(ROOT + path).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json");
                if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) {
                    connection.setDoOutput(true);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                String raw = read(stream);
                JSONObject response = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
                if (status >= 200 && status < 300) main.post(() -> callback.success(response));
                else {
                    String message = response.optString("error", "Request failed (" + status + ")");
                    main.post(() -> callback.error(message));
                }
            } catch (Exception exception) {
                String message = exception.getMessage() == null ? "Failed to reach the FUNDSHIP server." : exception.getMessage();
                main.post(() -> callback.error(message));
            } finally { if (connection != null) connection.disconnect(); }
        });
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;while ((line = reader.readLine()) != null) value.append(line);
        }
        return value.toString();
    }
}
