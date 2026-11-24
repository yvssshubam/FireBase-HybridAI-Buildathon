package com.fairclaim.customer.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.cancellation.CancellationException
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Live capture only (PLAN §9 layer 1): the evidence pipeline gets frames from CameraX and nowhere
// else. There is no gallery, file picker or ACTION_GET_CONTENT anywhere in the app.

/** A captured still, upright, plus the monotonic time of the shutter press. */
class Still(val bitmap: Bitmap, val shutterElapsed: Long)

/** Hands out the bound ImageCapture so a screen can trigger the shutter. */
class CameraHandle {
    internal var capture: ImageCapture? = null
    private val executor = Executors.newSingleThreadExecutor()

    val ready: Boolean get() = capture != null

    /** Shutter: the monotonic timestamp is read here, before any processing (capturedAt is stamped at shutter). */
    suspend fun takeStill(): Still {
        val ic = capture ?: error("camera not ready")
        val shutter = SystemClock.elapsedRealtime()
        val bitmap = suspendCancellableCoroutine<Bitmap> { cont ->
            ic.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val upright = image.toBitmap().rotated(image.imageInfo.rotationDegrees)
                        cont.resume(upright)
                    } catch (e: Exception) {
                        cont.resumeWithException(e)
                    } finally {
                        image.close()
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    cont.resumeWithException(exception)
                }
            })
        }
        return Still(bitmap, shutter)
    }
}

private val CAPTURE_SIZE = ResolutionSelector.Builder()
    .setResolutionStrategy(ResolutionStrategy(Size(1600, 1200), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
    .build()

/**
 * Back-camera preview bound to the screen's lifecycle. Pass [handle] to take stills,
 * [analyzer] for the QR scanner (or both).
 */
@Composable
fun LiveCamera(
    modifier: Modifier = Modifier,
    handle: CameraHandle? = null,
    analyzer: ImageAnalysis.Analyzer? = null,
    description: String,
    onError: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    // What this composable bound, so leaving the screen releases the camera. The use cases are bound to the
    // Activity's lifecycle, which outlives the screen: without this the camera stayed on after navigating away.
    val bound = remember { BoundCamera() }

    LaunchedEffect(owner, handle, analyzer) {
        try {
            val provider = cameraProvider(context)
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val useCases = mutableListOf<androidx.camera.core.UseCase>(preview)
            val capture = handle?.let {
                ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setResolutionSelector(CAPTURE_SIZE)
                    .build()
                    .also(useCases::add)
            }
            analyzer?.let { a ->
                ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(analysisExecutor, a) }
                    .also(useCases::add)
            }
            provider.unbindAll()
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, *useCases.toTypedArray())
            bound.provider = provider
            bound.useCases = useCases.toList()
            handle?.capture = capture
        } catch (e: CancellationException) {
            throw e // screen left before the camera was ready: not an error
        } catch (e: Exception) {
            onError(e.message ?: "Camera unavailable")
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            handle?.capture = null
            bound.provider?.unbind(*bound.useCases.toTypedArray())
            bound.provider = null
            bound.useCases = emptyList()
            analysisExecutor.shutdown()
        }
    }
    AndroidView(
        factory = { previewView },
        modifier = modifier.semantics { contentDescription = description },
    )
}

private class BoundCamera {
    var provider: ProcessCameraProvider? = null
    var useCases: List<androidx.camera.core.UseCase> = emptyList()
}

/** ProcessCameraProvider without extra futures libraries. */
private suspend fun cameraProvider(context: Context): ProcessCameraProvider = suspendCancellableCoroutine { cont ->
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
        try {
            cont.resume(future.get())
        } catch (e: Exception) {
            cont.resumeWithException(e)
        }
    }, ContextCompat.getMainExecutor(context))
}

fun hasCameraPermission(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

/** Shows [content] once CAMERA is granted; otherwise explains and asks. */
@Composable
fun CameraPermissionGate(content: @Composable () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCameraPermission(context)) }
    var denied by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        denied = !ok
    }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }
    if (granted) {
        content()
    } else {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                if (denied) "FairClaim needs the camera: evidence is taken live, never picked from the gallery."
                else "Allow the camera to take a live photo.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
        }
    }
}
