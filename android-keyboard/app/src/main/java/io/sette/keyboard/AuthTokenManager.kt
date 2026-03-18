package io.sette.keyboard

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * AuthTokenManager (B.3)
 *
 * Secure storage for JWT using Android EncryptedSharedPreferences
 * (AES-256 + KeyStore). Never uses plain SharedPreferences.
 *
 * Security Considerations:
 *   - JWT stored in EncryptedSharedPreferences (AES-256 + KeyStore)
 *   - On token expiry (401), shows in-panel prompt to re-authenticate
 *   - The keyboard must NOT log keystrokes from other apps
 */
object AuthTokenManager {

    private const val PREFS_NAME = "settepay_secure_prefs"
    private const val KEY_JWT = "jwt_token"
    private const val KEY_EXPIRY = "jwt_expiry"

    private fun getEncryptedPrefs(context: Context) =
        EncryptedSharedPreferences.create(
            PREFS_NAME,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )

    fun getToken(context: Context): String? {
        val prefs = getEncryptedPrefs(context)
        val token = prefs.getString(KEY_JWT, null) ?: return null
        val expiry = prefs.getLong(KEY_EXPIRY, 0)

        // Check if token is expired
        if (System.currentTimeMillis() > expiry) {
            clearToken(context)
            return null
        }

        return token
    }

    fun saveToken(context: Context, token: String, expiresInMs: Long) {
        val prefs = getEncryptedPrefs(context)
        prefs.edit()
            .putString(KEY_JWT, token)
            .putLong(KEY_EXPIRY, System.currentTimeMillis() + expiresInMs)
            .apply()
    }

    fun clearToken(context: Context) {
        val prefs = getEncryptedPrefs(context)
        prefs.edit()
            .remove(KEY_JWT)
            .remove(KEY_EXPIRY)
            .apply()
    }
}
