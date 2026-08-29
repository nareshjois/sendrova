package dev.sendrova.sms

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import dev.sendrova.sms.data.CredentialStore
import dev.sendrova.sms.data.RelayApiClient
import dev.sendrova.sms.data.SentJobStore

class SendrovaApp : Application() {
    lateinit var credentials: CredentialStore
        private set
    lateinit var sentJobs: SentJobStore
        private set
    lateinit var api: RelayApiClient
        private set

    override fun onCreate() {
        super.onCreate()
        credentials = CredentialStore(this)
        sentJobs = SentJobStore(this)
        api = RelayApiClient()
        ensureNotificationChannel()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "sendrova_sms_poll"
        const val NOTIFICATION_ID = 42
        /** Poll interval while paired (plan: 2–5s). */
        const val POLL_INTERVAL_MS = 3_000L
    }
}
