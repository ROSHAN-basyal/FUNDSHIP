package com.sajilo.split;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

final class SnapshotStore {
    private static final String PREFS = "fundship_last_verified_snapshot";
    private static final String VALUE = "snapshot";
    private final SharedPreferences preferences;

    SnapshotStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    JSONObject load() {
        String raw = preferences.getString(VALUE, "");
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject value = new JSONObject(raw);
            return value.optJSONObject("user") == null ? null : value;
        } catch (Exception ignored) {
            clear();
            return null;
        }
    }

    void save(JSONObject snapshot) {
        if (snapshot == null || snapshot.optJSONObject("user") == null) return;
        preferences.edit().putString(VALUE, snapshot.toString()).apply();
    }

    void clear() {
        preferences.edit().clear().apply();
    }
}
