@file:OptIn(PublicPreviewAPI::class)

package com.fairclaim.customer.ai

import android.util.Log
// TODO(verify): the non-deprecated com.google.firebase.ai.DownloadStatus has the same subclasses/fields as the deprecated
// com.google.firebase.ai.ondevice.DownloadStatus (DownloadStarted.bytesToDownload, DownloadInProgress.totalBytesDownloaded).
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.type.PublicPreviewAPI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// Gemini Nano status chip + model download + warm-up. Uses GenerativeModel.onDeviceExtension
// (firebase-ai); FirebaseAIOnDevice.checkStatus()/download() are deprecated in favour of it.
// Inference never waits on this: until the model is AVAILABLE, PREFER_ON_DEVICE runs in the cloud.

sealed interface DeviceModelState {
    data object Checking : DeviceModelState
    data object Available : DeviceModelState
    data object Downloadable : DeviceModelState
    /** [fraction] null until the size is known. */
    data class Downloading(val fraction: Float?) : DeviceModelState
    data object Unavailable : DeviceModelState
    data class Failed(val message: String) : DeviceModelState
}

class DeviceModel(private val model: GenerativeModel, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<DeviceModelState>(DeviceModelState.Checking)
    val state: StateFlow<DeviceModelState> = _state.asStateFlow()

    private var download: Job? = null
    private var warmedUp = false

    suspend fun refresh(): DeviceModelState {
        val ext = model.onDeviceExtension ?: return DeviceModelState.Unavailable.also { _state.value = it }
        val s = try {
            when (ext.checkStatus()) {
                OnDeviceModelStatus.AVAILABLE -> DeviceModelState.Available
                OnDeviceModelStatus.DOWNLOADABLE -> DeviceModelState.Downloadable
                OnDeviceModelStatus.DOWNLOADING -> (_state.value as? DeviceModelState.Downloading) ?: DeviceModelState.Downloading(null)
                else -> DeviceModelState.Unavailable
            }
        } catch (e: Exception) {
            Log.w(TAG, "checkStatus failed", e)
            DeviceModelState.Unavailable
        }
        _state.value = s
        return s
    }

    /** Not automatic: started after the Terms are accepted (and from the chip). */
    fun startDownloadIfNeeded() {
        if (download?.isActive == true) return
        download = scope.launch {
            if (refresh() != DeviceModelState.Downloadable) return@launch
            val ext = model.onDeviceExtension ?: return@launch
            var total = 0L
            try {
                ext.download().collect { s ->
                    _state.value = when (s) {
                        is DownloadStatus.DownloadStarted -> { total = s.bytesToDownload; DeviceModelState.Downloading(0f) }
                        is DownloadStatus.DownloadInProgress ->
                            DeviceModelState.Downloading(if (total > 0) (s.totalBytesDownloaded.toFloat() / total).coerceIn(0f, 1f) else null)
                        is DownloadStatus.DownloadCompleted -> DeviceModelState.Available
                        is DownloadStatus.DownloadFailed -> DeviceModelState.Failed("Model download failed")
                        else -> _state.value
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "download failed", e)
                _state.value = DeviceModelState.Failed(e.message ?: "Model download failed")
            }
            refresh()
        }
    }

    /** Loads Nano into memory before the challenge clock starts (order and claim screens). */
    fun warmUp() {
        if (warmedUp || _state.value != DeviceModelState.Available) return
        scope.launch {
            try {
                model.onDeviceExtension?.warmUp()
                warmedUp = true
            } catch (e: Exception) {
                Log.w(TAG, "warmUp failed", e) // not fatal: the first call just loads the model itself
            }
        }
    }

    suspend fun modelName(): String? = try {
        model.onDeviceExtension?.getModelName()
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val TAG = "FairClaim/Nano"
    }
}
