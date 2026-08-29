package dev.sendrova.sms.poll

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import dev.sendrova.sms.MainActivity
import dev.sendrova.sms.R
import dev.sendrova.sms.SendrovaApp
import dev.sendrova.sms.data.RelayApiException
import dev.sendrova.sms.sms.SmsSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground poller: GET /v1/jobs/pending every [SendrovaApp.POLL_INTERVAL_MS],
 * send via SmsManager, POST status sent|failed.
 */
class JobPollService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loopJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfSafely()
                return START_NOT_STICKY
            }
            else -> startPolling()
        }
        return START_STICKY
    }

    private fun startPolling() {
        val app = application as SendrovaApp
        if (!app.credentials.isPaired) {
            stopSelfSafely()
            return
        }

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                SendrovaApp.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(SendrovaApp.NOTIFICATION_ID, notification)
        }

        if (loopJob?.isActive == true) return

        loopJob = scope.launch {
            val sender = SmsSender(applicationContext)
            while (isActive) {
                try {
                    tick(app, sender)
                } catch (e: Exception) {
                    Log.w(TAG, "poll tick failed", e)
                    publishEvent("Poll error: ${e.message}")
                }
                delay(SendrovaApp.POLL_INTERVAL_MS)
            }
        }
    }

    private suspend fun tick(app: SendrovaApp, sender: SmsSender) {
        val base = app.credentials.relayBaseUrl ?: return
        val token = app.credentials.deviceToken ?: return

        val pending = try {
            app.api.listPendingJobs(base, token)
        } catch (e: RelayApiException) {
            if (e.httpStatus == 401) {
                publishEvent("Unauthorized — unpair and pair again")
                app.credentials.clear()
                app.sentJobs.clear()
                stopSelfSafely()
            } else {
                publishEvent("Pending fetch failed: ${e.message}")
            }
            return
        }

        if (pending.jobs.isEmpty()) {
            return
        }

        for (job in pending.jobs) {
            // Modem already sent this job; ack failed / lease reclaimed — ack only, do not re-send.
            if (app.sentJobs.contains(job.jobId)) {
                publishEvent("Re-acking previously sent job ${job.jobId}")
                ackSent(app, base, token, job.jobId)
                continue
            }

            publishEvent("Sending job ${job.jobId} → ${job.to}")
            when (val result = sender.send(job.to, job.body)) {
                is SmsSender.Result.Sent -> {
                    // Persist before ack so a failed ack cannot cause a second SMS.
                    app.sentJobs.markSent(job.jobId)
                    ackSent(app, base, token, job.jobId)
                }
                is SmsSender.Result.Failed -> {
                    try {
                        app.api.updateJobStatus(
                            base,
                            token,
                            job.jobId,
                            status = "failed",
                            error = result.error,
                        )
                        publishEvent("Failed job ${job.jobId}: ${result.error}")
                    } catch (e: RelayApiException) {
                        publishEvent("Ack failed for ${job.jobId}: ${e.message}")
                    }
                }
            }
        }
    }

    private suspend fun ackSent(
        app: SendrovaApp,
        base: String,
        token: String,
        jobId: String,
    ) {
        try {
            app.api.updateJobStatus(base, token, jobId, status = "sent")
            publishEvent("Sent job $jobId")
        } catch (e: RelayApiException) {
            publishEvent("Ack sent failed for $jobId: ${e.message}")
        }
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, SendrovaApp.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun publishEvent(message: String) {
        Log.i(TAG, message)
        sendBroadcast(
            Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_MESSAGE, message),
        )
    }

    private fun stopSelfSafely() {
        loopJob?.cancel()
        loopJob = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        loopJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "JobPollService"
        const val ACTION_START = "dev.sendrova.sms.POLL_START"
        const val ACTION_STOP = "dev.sendrova.sms.POLL_STOP"
        const val ACTION_STATUS = "dev.sendrova.sms.POLL_STATUS"
        const val EXTRA_MESSAGE = "message"

        fun start(context: Context) {
            val intent = Intent(context, JobPollService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, JobPollService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
