package dev.sendrova.sms.sms

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Sends text SMS via [SmsManager]. Patterns inspired by open SMS gateway apps;
 * reimplemented for Sendrova (no upstream fork).
 */
class SmsSender(private val context: Context) {
    fun send(to: String, body: String): Result {
        val destination = to.trim()
        if (destination.isEmpty()) {
            return Result.Failed("empty_destination")
        }
        if (body.isEmpty()) {
            return Result.Failed("empty_body")
        }

        return try {
            val smsManager = smsManager()
            val parts = smsManager.divideMessage(body)
            if (parts.size == 1) {
                sendSingle(smsManager, destination, body)
            } else {
                sendMultipart(smsManager, destination, parts)
            }
        } catch (e: SecurityException) {
            Result.Failed("sms_permission_denied: ${e.message}")
        } catch (e: Exception) {
            Result.Failed(e.message ?: "sms_send_failed")
        }
    }

    private fun sendSingle(smsManager: SmsManager, to: String, body: String): Result {
        val latch = CountDownLatch(1)
        val outcome = AtomicReference("pending")
        val sentIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_SENT,
            Intent(ACTION_SMS_SENT).setPackage(context.packageName),
            pendingFlags(),
        )
        // Register a one-shot receiver for this send.
        val filter = android.content.IntentFilter(ACTION_SMS_SENT)
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                outcome.set(
                    when (resultCode) {
                        android.app.Activity.RESULT_OK -> "sent"
                        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "generic_failure"
                        SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
                        SmsManager.RESULT_ERROR_NULL_PDU -> "null_pdu"
                        SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
                        else -> "result_$resultCode"
                    },
                )
                latch.countDown()
                try {
                    context.unregisterReceiver(this)
                } catch (_: Exception) {
                    // already unregistered
                }
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        smsManager.sendTextMessage(to, null, body, sentIntent, null)

        val completed = latch.await(SENT_TIMEOUT_SEC, TimeUnit.SECONDS)
        if (!completed) {
            try {
                context.unregisterReceiver(receiver)
            } catch (_: Exception) {
            }
            return Result.Failed("sms_send_timeout")
        }
        return when (val value = outcome.get()) {
            "sent" -> Result.Sent
            else -> Result.Failed(value)
        }
    }

    private fun sendMultipart(smsManager: SmsManager, to: String, parts: ArrayList<String>): Result {
        // Multipart: fire-and-forget with best-effort; modem accepts the queue.
        // Still treat as sent if no SecurityException — detailed per-part acks are v2.
        return try {
            smsManager.sendMultipartTextMessage(to, null, parts, null, null)
            Result.Sent
        } catch (e: Exception) {
            Result.Failed(e.message ?: "multipart_send_failed")
        }
    }

    private fun smsManager(): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
                ?: SmsManager.getDefault()
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
    }

    private fun pendingFlags(): Int {
        return PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    }

    sealed class Result {
        data object Sent : Result()
        data class Failed(val error: String) : Result()
    }

    companion object {
        private const val ACTION_SMS_SENT = "dev.sendrova.sms.SMS_SENT"
        private const val REQUEST_SENT = 1001
        private const val SENT_TIMEOUT_SEC = 30L
    }
}
