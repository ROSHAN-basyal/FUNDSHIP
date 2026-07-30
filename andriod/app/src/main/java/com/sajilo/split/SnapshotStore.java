package com.sajilo.split;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SnapshotStore {
    private static final String PREFS = "fundship_last_verified_snapshot";
    private static final String VALUE = "snapshot";
    private static final String KEY_ALIAS = "fundship_snapshot_v1";
    private final SharedPreferences preferences;

    SnapshotStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    JSONObject load() {
        try {
            String raw;
            String encrypted = preferences.getString("ciphertext", "");
            String iv = preferences.getString("iv", "");
            if (!encrypted.isEmpty() && !iv.isEmpty()) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                raw = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            } else {
                // One-time upgrade from older plaintext snapshots.
                raw = preferences.getString(VALUE, "");
            }
            if (raw == null || raw.isEmpty()) return null;
            JSONObject value = new JSONObject(raw);
            if (value.optJSONObject("user") == null) return null;
            if (encrypted.isEmpty()) save(value);
            return value;
        } catch (Exception ignored) {
            clear();
            return null;
        }
    }

    void save(JSONObject snapshot) {
        if (snapshot == null || snapshot.optJSONObject("user") == null) return;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(snapshot.toString().getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .remove(VALUE)
                .apply();
        } catch (Exception ignored) {}
    }

    void clear() {
        preferences.edit().clear().apply();
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
