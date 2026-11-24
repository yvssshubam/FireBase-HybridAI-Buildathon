package com.fairclaim.customer.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.camera.CameraHandle
import com.fairclaim.customer.camera.CameraPermissionGate
import com.fairclaim.customer.camera.LiveCamera
import com.fairclaim.customer.camera.PointF
import com.fairclaim.customer.claim.ClaimUi
import com.fairclaim.customer.claim.ClaimViewModel
import com.fairclaim.customer.claim.HandoffUi
import com.fairclaim.customer.claim.HandoffViewModel
import com.fairclaim.customer.claim.ISSUE_TYPES
import com.fairclaim.customer.claim.Stage
import com.fairclaim.customer.claim.StageState
import com.fairclaim.customer.firebase.LoadedPolicy

/** Live preview + one big shutter. No gallery, no file picker: this is the only way in. */
@Composable
private fun CameraWithShutter(handle: CameraHandle, description: String, shutterLabel: String, onShutter: () -> Unit, overlay: @Composable () -> Unit = {}) {
    CameraPermissionGate {
        Box(Modifier.fillMaxSize()) {
            LiveCamera(Modifier.fillMaxSize(), handle = handle, description = description)
            Box(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(12.dp)) { overlay() }
            Button(
                onClick = onShutter,
                shape = CircleShape,
                modifier = Modifier.align(Alignment.BottomCenter).padding(28.dp).semantics { contentDescription = shutterLabel },
            ) { Text(shutterLabel, Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) }
        }
    }
}

@Composable
fun HandoffScreen(app: AppViewModel, g: AppGraph, orderId: String) {
    val vm: HandoffViewModel = viewModel(key = "handoff-$orderId") { HandoffViewModel(g, orderId) }
    val ui by vm.ui.collectAsState()
    Scaffold(topBar = { Bar("Snap the sealed bag", onBack = { app.back() }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (val s = ui) {
                HandoffUi.Loading -> LoadingBox()
                is HandoffUi.Blocked -> MessageBox(s.message, action = "Back", onAction = { app.back() })
                is HandoffUi.Failed -> MessageBox("Something went wrong", s.message, "Try again", { vm.load() })
                is HandoffUi.Camera -> CameraWithShutter(vm.camera, "Camera preview of the sealed bag", "Take photo", vm::shoot) {
                    Text(
                        s.note ?: "Show the whole seal sticker with its 4-digit code. Don't open the bag yet.",
                        color = Color.White,
                        modifier = Modifier.padding(8.dp),
                    )
                }
                HandoffUi.Checking -> LoadingBox("Checking the seal and reading the code…")
                is HandoffUi.Rejected -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
                    Text("Can't use this photo", style = MaterialTheme.typography.titleMedium)
                    Text(s.reason)
                    SourceBadge(s.source)
                    Button(onClick = vm::retake, modifier = Modifier.fillMaxWidth()) { Text("Retake") }
                }
                is HandoffUi.Saved -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
                    Pill("Verified unboxing ✓", Brand)
                    Text(
                        if (s.sealState == "broken") "Recorded: the seal already looked broken before you opened the bag. That is noted as evidence for any claim."
                        else "Recorded: the bag was still sealed with this order's code. You can open it now.",
                    )
                    SourceBadge(s.source)
                    Button(onClick = { app.back() }, modifier = Modifier.fillMaxWidth()) { Text("Done") }
                }
            }
        }
    }
}

@Composable
fun ClaimScreen(app: AppViewModel, g: AppGraph, uid: String, orderId: String, policy: LoadedPolicy) {
    val vm: ClaimViewModel = viewModel(key = "claim-$orderId") { ClaimViewModel(g, uid, orderId, policy) }
    val ui by vm.ui.collectAsState()
    LaunchedEffect(ui) {
        val s = ui
        if (s is ClaimUi.Submitted) app.replace(Screen.Result(s.claimId))
    }
    Scaffold(topBar = { Bar("Report a problem", onBack = { app.back() }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (val s = ui) {
                ClaimUi.Loading -> LoadingBox()
                is ClaimUi.Blocked -> MessageBox(
                    s.message,
                    action = if (s.claimId != null) "See the claim" else "Back",
                    onAction = { if (s.claimId != null) app.replace(Screen.Result(s.claimId)) else app.back() },
                )
                is ClaimUi.Setup -> ClaimSetup(vm, s)
                is ClaimUi.Waiting -> LoadingBox("One claim per 30 seconds: starting in ${s.secondsLeft} s…")
                is ClaimUi.Preparing -> LoadingBox(s.text)
                is ClaimUi.Camera -> {
                    val remaining by vm.remainingMs.collectAsState()
                    CameraWithShutter(vm.camera, "Camera preview for the claim photo", "Take photo", vm::shoot) {
                        ChallengeBanner(s.fingers, s.issueType, remaining, policy.policy.challengeWindowSec, s.note)
                    }
                }
                is ClaimUi.Tap -> TapToCrop(vm, s)
                is ClaimUi.Working -> StageList(s.stages, "Checking your photo")
                is ClaimUi.Warnings -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    StageList(s.stages, "Checks done")
                    Text("Heads up: this claim will probably go to a person for review because:", fontWeight = FontWeight.SemiBold)
                    s.warnings.forEach { Text("• $it") }
                    if (s.canRetake) Button(onClick = vm::retake, modifier = Modifier.fillMaxWidth()) { Text("Retake the photo") }
                    OutlinedButton(onClick = vm::submitAnyway, modifier = Modifier.fillMaxWidth()) { Text("Submit anyway") }
                }
                is ClaimUi.Failed -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (s.stages.isNotEmpty()) StageList(s.stages, "Checks")
                    Text(s.message, color = MaterialTheme.colorScheme.error)
                    if (s.canRetake) Button(onClick = vm::retake, modifier = Modifier.fillMaxWidth()) { Text("Retake") }
                    OutlinedButton(onClick = vm::restart, modifier = Modifier.fillMaxWidth()) { Text("Start again (new challenge)") }
                }
                is ClaimUi.Submitted -> LoadingBox("Opening the decision…")
            }
        }
    }
}

@Composable
private fun ClaimSetup(vm: ClaimViewModel, s: ClaimUi.Setup) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!s.hasHandoff) {
            Text(
                "No sealed-bag snap for this order. If the bag is still closed, snap it first: without it a missing-item claim can't be refunded instantly.",
                color = Warn,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text("What's wrong?", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ISSUE_TYPES.forEach { (id, label) -> FilterChip(selected = s.issueType == id, onClick = { vm.chooseIssue(id) }, label = { Text(label) }) }
        }
        if (s.issueType != null) {
            Text(if (s.issueType == "missing") "Which items are missing?" else "Which item?", style = MaterialTheme.typography.titleMedium)
            s.order.items.forEach { item ->
                val on = item.id in s.selected
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { vm.toggleItem(item.id) }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.material3.Checkbox(checked = on, onCheckedChange = null)
                    Text(item.name, Modifier.weight(1f).padding(start = 8.dp))
                    Text(rupees(item.price))
                }
            }
            Text(
                "Next you get a live challenge with a 60-second timer: show the seal sticker next to the problem and hold up the number of fingers we ask for. " +
                    if (s.issueType == "missing") "" else "Then tap the item on the photo.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Button(onClick = vm::startChallenge, enabled = vm.canStart, modifier = Modifier.fillMaxWidth()) { Text("Start the live challenge") }
    }
}

@Composable
private fun ChallengeBanner(fingers: Int, issueType: String, remainingMs: Long, windowSec: Int, note: String?) {
    val secs = (remainingMs.coerceAtLeast(0) + 999) / 1000
    Column(
        Modifier.fillMaxWidth().padding(4.dp).semantics { contentDescription = "Challenge: show the seal sticker and hold up $fingers fingers. $secs seconds left." },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "Show the seal sticker next to the ${if (issueType == "missing") "open bag" else "problem"} and hold up $fingers finger${if (fingers == 1) "" else "s"}",
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        LinearProgressIndicator(progress = { (remainingMs.toFloat() / (windowSec * 1000f)).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Text(if (secs > 0) "$secs s left" else "Time's up — start again", color = if (secs > 10) Color.White else Color(0xFFFFB4AB))
        note?.let { Text(it, color = Color(0xFFFFB4AB)) }
    }
}

@Composable
private fun TapToCrop(vm: ClaimViewModel, s: ClaimUi.Tap) {
    val image = remember(s.photo) { s.photo.asImageBitmap() }
    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Tap on ${s.itemName} in the photo", style = MaterialTheme.typography.titleMedium)
        s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Box(
            Modifier.weight(1f).fillMaxWidth().border(BorderStroke(1.dp, Color.LightGray)),
        ) {
            Image(
                bitmap = image,
                contentDescription = "Your photo. Tap the damaged or wrong item.",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().pointerInput(s.photo) {
                    detectTapGestures { o -> vm.tap(PointF(o.x, o.y), size.width.toFloat(), size.height.toFloat()) }
                },
            )
        }
        OutlinedButton(onClick = vm::retake, modifier = Modifier.fillMaxWidth()) { Text("Retake") }
    }
}

@Composable
fun StageList(stages: List<Stage>, title: String) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        stages.forEach { st ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when (st.state) {
                    StageState.RUNNING -> SmallSpinner()
                    StageState.DONE -> Text("✓", color = Brand, fontWeight = FontWeight.Bold)
                    StageState.FAILED -> Text("✗", color = Bad, fontWeight = FontWeight.Bold)
                    StageState.SKIPPED -> Text("–", color = Color.Gray)
                    StageState.PENDING -> Text("·", color = Color.Gray)
                }
                Column(Modifier.weight(1f)) {
                    Text(st.label, style = MaterialTheme.typography.bodyMedium)
                    st.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
                SourceBadge(st.source)
            }
        }
    }
}
