package dev.sendrova.sms.sms

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
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
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                outcome.set(mapResultCode(resultCode))
                latch.countDown()
                unregisterQuietly(this)
            }
        }
        registerSentReceiver(receiver)

        smsManager.sendTextMessage(to, null, body, sentIntent, null)

        return awaitOutcome(latch, outcome, receiver, timeoutSec = SENT_TIMEOUT_SEC)
    }

    private fun sendMultipart(smsManager: SmsManager, to: String, parts: ArrayList<String>): Result {
        val partCount = parts.size
        val latch = CountDownLatch(partCount)
        val firstFailure = AtomicReference<String?>(null)
        val okCount = AtomicInteger(0)

        val sentIntents = ArrayList<PendingIntent>(partCount)
        for (i in 0 until partCount) {
            sentIntents.add(
                PendingIntent.getBroadcast(
                    context,
                    REQUEST_SENT + i,
                    Intent(ACTION_SMS_SENT)
                        .setPackage(context.packageName)
                        .putExtra(EXTRA_PART_INDEX, i)
                        .putExtra(EXTRA_PART_COUNT, partCount),
                    pendingFlags(),
                ),
            )
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val mapped = mapResultCode(resultCode)
                if (mapped == "sent") {
                    okCount.incrementAndGet()
                } else {
                    firstFailure.compareAndSet(null, mapped)
                }
                latch.countDown()
                if (latch.count == 0L) {
                    unregisterQuietly(this)
                }
            }
        }
        registerSentReceiver(receiver)

        smsManager.sendMultipartTextMessage(to, null, parts, sentIntents, null)

        val timeoutSec = SENT_TIMEOUT_SEC * partCount.coerceAtMost(10)
        val completed = latch.await(timeoutSec, TimeUnit.SECONDS)
        if (!completed) {
            unregisterQuietly(receiver)
            return Result.Failed("sms_send_timeout")
        }
        val failure = firstFailure.get()
        return if (failure == null && okCount.get() == partCount) {
            Result.Sent
        } else {
            Result.Failed(failure ?: "multipart_partial_failure")
        }
    }

    private fun awaitOutcome(
        latch: CountDownLatch,
        outcome: AtomicReference<String>,
        receiver: BroadcastReceiver,
        timeoutSec: Long,
    ): Result {
        val completed = latch.await(timeoutSec, TimeUnit.SECONDS)
        if (!completed) {
            unregisterQuietly(receiver)
            return Result.Failed("sms_send_timeout")
        }
        return when (val value = outcome.get()) {
            "sent" -> Result.Sent
            else -> Result.Failed(value)
        }
    }

    private fun registerSentReceiver(receiver: BroadcastReceiver) {
        val filter = IntentFilter(ACTION_SMS_SENT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
    }

    private fun unregisterQuietly(receiver: BroadcastReceiver) {
        try {
            context.unregisterReceiver(receiver)
        } catch (_: Exception) {
            // already unregistered
        }
    }

    private fun mapResultCode(resultCode: Int): String {
        return when (resultCode) {
            android.app.Activity.RESULT_OK -> "sent"
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "generic_failure"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
            SmsManager.RESULT_ERROR_NULL_PDU -> "null_pdu"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
            else -> "result_$resultCode"
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
        private const val EXTRA_PART_INDEX = "part_index"
        private const val EXTRA_PART_COUNT = "part_count"
        private const val REQUEST_SENT = 1001
        private const val SENT_TIMEOUT_SEC = 30L
    }
}
