package id.universe.mobile.ui.components

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import java.util.concurrent.Executors
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import id.universe.mobile.ui.theme.Theme

/** CameraX with ML Kit's bundled QR model: no download, no network. */
@Composable
actual fun QrCamera(onCode: (String) -> Unit, modifier: Modifier, overlay: @Composable BoxScope.() -> Unit) {
    val context = LocalContext.current
    val hasCamera = {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
    var granted by remember { mutableStateOf(hasCamera()) }
    /* Denied for good ("jangan tanya lagi"): only the app's settings can grant it now. */
    var blocked by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        blocked = !ok && context.findActivity()?.let {
            !ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.CAMERA)
        } == true
    }
    /* Granted in Settings and come back: read it again rather than keep asking. */
    LifecycleResumeEffect(Unit) {
        granted = hasCamera()
        onPauseOrDispose { }
    }
    if (!granted) {
        Column(
            modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Txt(
                if (blocked) {
                    "Izin kamera ditolak. Buka pengaturan aplikasi untuk mengizinkannya, atau ketik NIK manual."
                } else {
                    "Izinkan kamera untuk membaca QR di ID card, atau ketik NIK manual."
                },
                Theme.type.callout,
                color = ViewfinderInk,
                align = TextAlign.Center,
            )
            ActionButton(
                if (blocked) "Buka pengaturan" else "Izinkan kamera",
                {
                    if (blocked) {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                        )
                    } else {
                        ask.launch(Manifest.permission.CAMERA)
                    }
                },
                Modifier.widthIn(max = 240.dp),
                height = 44.dp,
            )
        }
        return
    }

    val owner = LocalLifecycleOwner.current
    val latest by rememberUpdatedState(onCode)
    val controller = remember { LifecycleCameraController(context) }
    DisposableEffect(owner) {
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
        /* Frames are read off the main thread; only the answer comes back to it. */
        val frames = Executors.newSingleThreadExecutor()
        val main = ContextCompat.getMainExecutor(context)
        controller.setImageAnalysisAnalyzer(
            frames,
            MlKitAnalyzer(listOf(scanner), ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL, main) { result ->
                result.getValue(scanner)?.firstNotNullOfOrNull { it.rawValue }?.let { latest(it) }
            },
        )
        controller.bindToLifecycle(owner)
        onDispose {
            /* No new frames first, then the reader goes. */
            controller.unbind()
            controller.clearImageAnalysisAnalyzer()
            scanner.close()
            frames.shutdown()
        }
    }
    Box(modifier) {
        AndroidView(
            factory = {
                PreviewView(it).apply {
                    /* A TextureView, so the rounded viewfinder clips it and the overlay draws above it. */
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    this.controller = controller
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        overlay()
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
