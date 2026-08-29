package dev.sendrova.sms

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import dev.sendrova.sms.data.PairUriParser
import dev.sendrova.sms.data.RelayApiException
import dev.sendrova.sms.databinding.ActivityMainBinding
import dev.sendrova.sms.poll.JobPollService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val app get() = application as SendrovaApp

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val message = intent?.getStringExtra(JobPollService.EXTRA_MESSAGE) ?: return
            binding.eventValue.text = message
        }
    }

    private val smsPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            maybeStartPolling()
        } else {
            toast(getString(R.string.permission_sms_rationale))
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            launchQrScanner()
        } else {
            toast(getString(R.string.permission_camera_rationale))
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* polling still works without notification permission on older APIs */ }

    private val qrLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents ?: return@registerForActivityResult
        binding.pairUriInput.setText(contents)
        pairFromRaw(contents)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.pairButton.setOnClickListener {
            pairFromRaw(binding.pairUriInput.text?.toString().orEmpty())
        }
        binding.scanQrButton.setOnClickListener { ensureCameraThenScan() }
        binding.unpairButton.setOnClickListener { unpair() }

        handleIncomingIntent(intent)
        refreshUi()
        ensureRuntimePermissions()
        maybeStartPolling()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(JobPollService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, filter)
        }
        refreshUi()
    }

    override fun onStop() {
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val data: Uri? = intent?.data
        if (intent?.action == Intent.ACTION_VIEW && data != null) {
            val raw = data.toString()
            binding.pairUriInput.setText(raw)
            pairFromRaw(raw)
        }
    }

    private fun ensureRuntimePermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            smsPermissionLauncher.launch(Manifest.permission.SEND_SMS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun ensureCameraThenScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            launchQrScanner()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scan Sendrova SMS pair QR")
            .setBeepEnabled(false)
            .setOrientationLocked(true)
            .setCaptureActivity(com.journeyapps.barcodescanner.CaptureActivity::class.java)
        qrLauncher.launch(options)
    }

    private fun pairFromRaw(raw: String) {
        val payload = PairUriParser.parse(raw)
        if (payload == null) {
            toast(getString(R.string.error_invalid_pair_uri))
            return
        }

        binding.statusText.setText(R.string.status_pairing)
        binding.pairButton.isEnabled = false

        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    app.api.pairComplete(payload.relayBaseUrl, payload.pairId, payload.secret)
                }
                app.credentials.savePairing(
                    relayBaseUrl = payload.relayBaseUrl,
                    deviceId = response.deviceId,
                    deviceToken = response.deviceToken,
                )
                toast(getString(R.string.paired_ok))
                binding.eventValue.text = "Paired as ${response.deviceId}"
                refreshUi()
                maybeStartPolling()
            } catch (e: RelayApiException) {
                toast(getString(R.string.error_pair_failed, e.message))
                binding.eventValue.text = e.message
                refreshUi()
            } catch (e: Exception) {
                toast(getString(R.string.error_pair_failed, e.message ?: "unknown"))
                refreshUi()
            } finally {
                binding.pairButton.isEnabled = true
            }
        }
    }

    private fun unpair() {
        val base = app.credentials.relayBaseUrl
        val token = app.credentials.deviceToken
        JobPollService.stop(this)

        lifecycleScope.launch {
            if (base != null && token != null) {
                try {
                    withContext(Dispatchers.IO) {
                        app.api.unpair(base, token)
                    }
                } catch (_: Exception) {
                    // Local clear still happens; server may already be unbound.
                }
            }
            app.credentials.clear()
            app.sentJobs.clear()
            toast(getString(R.string.unpaired_ok))
            binding.eventValue.text = getString(R.string.unpaired_ok)
            refreshUi()
        }
    }

    private fun maybeStartPolling() {
        if (!app.credentials.isPaired) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            smsPermissionLauncher.launch(Manifest.permission.SEND_SMS)
            return
        }
        JobPollService.start(this)
    }

    private fun refreshUi() {
        val paired = app.credentials.isPaired
        binding.statusText.setText(
            if (paired) R.string.status_paired else R.string.status_unpaired,
        )
        binding.relayValue.text = app.credentials.relayBaseUrl ?: "—"
        binding.deviceValue.text = app.credentials.deviceId ?: "—"
        binding.pairUriLayout.visibility = if (paired) View.GONE else View.VISIBLE
        binding.pairActions.visibility = if (paired) View.GONE else View.VISIBLE
        binding.unpairButton.visibility = if (paired) View.VISIBLE else View.GONE
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}
