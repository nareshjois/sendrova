package dev.sendrova.sms.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persists relay pairing credentials in EncryptedSharedPreferences.
 */
class CredentialStore(context: Context) {
    private val prefs: SharedPreferences

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    val isPaired: Boolean
        get() = !relayBaseUrl.isNullOrBlank() &&
            !deviceId.isNullOrBlank() &&
            !deviceToken.isNullOrBlank()

    var relayBaseUrl: String?
        get() = prefs.getString(KEY_RELAY_BASE_URL, null)
        private set(value) = prefs.edit().putString(KEY_RELAY_BASE_URL, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var deviceToken: String?
        get() = prefs.getString(KEY_DEVICE_TOKEN, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    fun savePairing(relayBaseUrl: String, deviceId: String, deviceToken: String) {
        prefs.edit()
            .putString(KEY_RELAY_BASE_URL, relayBaseUrl.trimEnd('/'))
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, deviceToken)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS_NAME = "sendrova_sms_credentials"
        private const val KEY_RELAY_BASE_URL = "relay_base_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
    }
}
