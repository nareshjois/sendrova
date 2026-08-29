package dev.sendrova.sms.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Durable set of job IDs whose SMS was accepted/sent by the modem.
 * Prevents double-send when ack fails and the relay re-leases the same job.
 */
class SentJobStore(context: Context) {
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

    fun contains(jobId: String): Boolean = ids().contains(jobId)

    fun markSent(jobId: String) {
        val next = ids()
        next.remove(jobId)
        next.add(jobId)
        while (next.size > MAX_IDS) {
            next.removeAt(0)
        }
        prefs.edit().putString(KEY_SENT_JOB_IDS, next.joinToString("\n")).commit()
    }

    fun clear() {
        prefs.edit().remove(KEY_SENT_JOB_IDS).apply()
    }

    private fun ids(): MutableList<String> {
        val raw = prefs.getString(KEY_SENT_JOB_IDS, null) ?: return mutableListOf()
        if (raw.isEmpty()) return mutableListOf()
        return raw.split('\n').filter { it.isNotEmpty() }.toMutableList()
    }

    companion object {
        private const val PREFS_NAME = "sendrova_sms_sent_jobs"
        private const val KEY_SENT_JOB_IDS = "sent_job_ids"
        /** Bound growth; older entries drop first. */
        private const val MAX_IDS = 256
    }
}
