package dev.sendrova.sms.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin HTTP client for device-facing endpoints in packages/sms-relay-api OpenAPI.
 */
class RelayApiClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun pairComplete(relayBaseUrl: String, pairId: String, secret: String): PairCompleteResponse {
        val body = JSONObject()
            .put("pairId", pairId)
            .put("secret", secret)
            .toString()
        val request = Request.Builder()
            .url("${relayBaseUrl.trimEnd('/')}/v1/pair/complete")
            .post(body.toRequestBody(jsonMedia))
            .header("Accept", "application/json")
            .build()
        return execute(request) { json ->
            PairCompleteResponse(
                deviceId = json.getString("deviceId"),
                deviceToken = json.getString("deviceToken"),
            )
        }
    }

    fun listPendingJobs(relayBaseUrl: String, deviceToken: String): PendingJobsResponse {
        val request = Request.Builder()
            .url("${relayBaseUrl.trimEnd('/')}/v1/jobs/pending")
            .get()
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $deviceToken")
            .build()
        return execute(request) { json ->
            val jobsJson = json.optJSONArray("jobs") ?: JSONArray()
            val jobs = buildList {
                for (i in 0 until jobsJson.length()) {
                    val item = jobsJson.getJSONObject(i)
                    add(
                        SmsJob(
                            jobId = item.getString("jobId"),
                            to = item.getString("to"),
                            body = item.getString("body"),
                            clientJobId = item.getString("clientJobId"),
                            status = item.getString("status"),
                            error = if (item.isNull("error")) null else item.optString("error", null),
                        ),
                    )
                }
            }
            PendingJobsResponse(jobs = jobs)
        }
    }

    fun updateJobStatus(
        relayBaseUrl: String,
        deviceToken: String,
        jobId: String,
        status: String,
        error: String? = null,
    ): JobStatusResponse {
        val payload = JSONObject().put("status", status)
        if (error != null) {
            payload.put("error", error)
        }
        val request = Request.Builder()
            .url("${relayBaseUrl.trimEnd('/')}/v1/jobs/$jobId/status")
            .post(payload.toString().toRequestBody(jsonMedia))
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $deviceToken")
            .build()
        return execute(request) { json ->
            JobStatusResponse(
                jobId = json.getString("jobId"),
                status = json.getString("status"),
                clientJobId = json.optString("clientJobId").ifBlank { null },
                error = if (json.isNull("error")) null else json.optString("error", null),
                updatedAt = json.optString("updatedAt").ifBlank { null },
            )
        }
    }

    fun unpair(relayBaseUrl: String, deviceToken: String) {
        val request = Request.Builder()
            .url("${relayBaseUrl.trimEnd('/')}/v1/pair/unpair")
            .post("{}".toRequestBody(jsonMedia))
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $deviceToken")
            .build()
        execute(request) { /* ok: true */ }
    }

    private fun <T> execute(request: Request, map: (JSONObject) -> T): T {
        try {
            http.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw parseError(response.code, raw)
                }
                if (raw.isBlank()) {
                    @Suppress("UNCHECKED_CAST")
                    return Unit as T
                }
                return map(JSONObject(raw))
            }
        } catch (e: RelayApiException) {
            throw e
        } catch (e: IOException) {
            throw RelayApiException("network_error", e.message ?: "Network error", 0)
        } catch (e: Exception) {
            throw RelayApiException("parse_error", e.message ?: "Invalid response", 0)
        }
    }

    private fun parseError(httpStatus: Int, raw: String): RelayApiException {
        return try {
            val envelope = JSONObject(raw).getJSONObject("error")
            RelayApiException(
                code = envelope.optString("code", "http_$httpStatus"),
                message = envelope.optString("message", "HTTP $httpStatus"),
                httpStatus = httpStatus,
            )
        } catch (_: Exception) {
            RelayApiException("http_$httpStatus", raw.ifBlank { "HTTP $httpStatus" }, httpStatus)
        }
    }
}
