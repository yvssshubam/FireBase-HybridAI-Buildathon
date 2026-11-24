package com.fairclaim.customer.claim

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.ai.CheckResult
import com.fairclaim.customer.ai.summary
import com.fairclaim.customer.camera.CameraHandle
import com.fairclaim.customer.camera.scaledToMax
import com.fairclaim.customer.data.OrderDoc
import com.fairclaim.customer.data.OrderStatus
import com.fairclaim.customer.data.handoffDoc
import com.fairclaim.engine.InferenceSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonPrimitive

// Flow B, the handoff snap (load-bearing for liability): the only evidence of the seal before the
// customer opens the bag. Live camera → HandoffCheck (PREFER_ON_DEVICE, structured output) →
// handoff/{orderId}, then the order is marked delivered.

sealed interface HandoffUi {
    data object Loading : HandoffUi
    data class Blocked(val message: String) : HandoffUi
    data class Camera(val note: String?) : HandoffUi
    data object Checking : HandoffUi
    /** The photo can't be used: say why, offer a retake. */
    data class Rejected(val reason: String, val source: InferenceSource?) : HandoffUi
    data class Saved(val sealState: String, val source: InferenceSource) : HandoffUi
    data class Failed(val message: String) : HandoffUi
}

class HandoffViewModel(private val g: AppGraph, private val orderId: String) : ViewModel() {
    private val _ui = MutableStateFlow<HandoffUi>(HandoffUi.Loading)
    val ui: StateFlow<HandoffUi> = _ui.asStateFlow()
    val camera = CameraHandle()
    private var order: OrderDoc? = null

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _ui.value = HandoffUi.Loading
            try {
                val o = g.repo.order(orderId)
                order = o
                _ui.value = when {
                    o == null -> HandoffUi.Blocked("Order not found.")
                    !o.claimable -> HandoffUi.Blocked("The restaurant hasn't dispatched this order yet.")
                    g.repo.handoffOnce(orderId) != null -> HandoffUi.Blocked("The sealed-bag snap for this order is already recorded.")
                    else -> HandoffUi.Camera(null)
                }
                g.deviceModel.warmUp()
            } catch (e: Exception) {
                _ui.value = HandoffUi.Failed("Couldn't load the order: ${e.message}")
            }
        }
    }

    fun retake() {
        _ui.value = HandoffUi.Camera(null)
    }

    fun shoot() {
        val o = order ?: return
        val code = o.sealCode ?: return
        viewModelScope.launch {
            try {
                val still = camera.takeStill()
                val capturedAt = System.currentTimeMillis() // display only; the rules just need an int
                _ui.value = HandoffUi.Checking
                val frame = withContext(Dispatchers.Default) { still.bitmap.scaledToMax(1024) }
                when (val r = g.ai.handoffCheck(frame)) {
                    is CheckResult.Failed -> _ui.value = HandoffUi.Rejected(r.summary(), null)
                    is CheckResult.Ok -> {
                        val read = r.json["seal_code_read"]?.jsonPrimitive?.content.orEmpty()
                        val seal = r.json["seal_state"]?.jsonPrimitive?.content.orEmpty()
                        // Same "usable handoff" test as the engine (classifyEvidence): right code, seal visible.
                        val problem = when {
                            seal == "not_visible" -> "We couldn't see the seal sticker. Keep the whole sticker in the frame."
                            read.isEmpty() -> "We couldn't read the 4-digit seal code. Hold the phone closer, in good light."
                            read != code -> "We read the code $read, which isn't this order's seal code. Is this the right bag?"
                            else -> null
                        }
                        if (problem != null) {
                            _ui.value = HandoffUi.Rejected(problem, r.source)
                            return@launch
                        }
                        g.repo.writeHandoff(o.id, handoffDoc(r.json, r.source.wire, capturedAt))
                        if (o.status == OrderStatus.DISPATCHED) g.repo.markDelivered(o.id)
                        _ui.value = HandoffUi.Saved(seal, r.source)
                    }
                }
            } catch (e: Exception) {
                _ui.value = HandoffUi.Failed("Couldn't save the snap: ${e.message}")
            }
        }
    }
}
