package dev.sendrova.sms.data

import android.net.Uri

/**
 * Parsed [sendrova://sms-pair](qr-payload.md) deep link / paste string.
 */
data class PairPayload(
    val relayBaseUrl: String,
    val pairId: String,
    val secret: String,
)

object PairUriParser {
    fun parse(raw: String): PairPayload? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null

        val uri = try {
            Uri.parse(trimmed)
        } catch (_: Exception) {
            return null
        }

        if (uri.scheme != "sendrova") return null
        if (uri.host != "sms-pair" && uri.authority != "sms-pair") return null

        val encodedBase = uri.getQueryParameter("u") ?: return null
        val pairId = uri.getQueryParameter("pairId") ?: return null
        val secret = uri.getQueryParameter("secret") ?: return null
        if (pairId.isBlank() || secret.isBlank() || encodedBase.isBlank()) return null

        val relayBaseUrl = Uri.decode(encodedBase).trimEnd('/')
        if (!relayBaseUrl.startsWith("http://") && !relayBaseUrl.startsWith("https://")) {
            return null
        }

        return PairPayload(
            relayBaseUrl = relayBaseUrl,
            pairId = pairId,
            secret = secret,
        )
    }
}
