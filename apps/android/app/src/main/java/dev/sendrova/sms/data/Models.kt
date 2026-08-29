package dev.sendrova.sms.data

data class PairCompleteResponse(
    val deviceId: String,
    val deviceToken: String,
)

data class SmsJob(
    val jobId: String,
    val to: String,
    val body: String,
    val clientJobId: String,
    val status: String,
    val error: String? = null,
)

data class PendingJobsResponse(
    val jobs: List<SmsJob>,
)

data class JobStatusResponse(
    val jobId: String,
    val status: String,
    val clientJobId: String? = null,
    val error: String? = null,
    val updatedAt: String? = null,
)

class RelayApiException(
    val code: String,
    override val message: String,
    val httpStatus: Int,
) : Exception(message)
