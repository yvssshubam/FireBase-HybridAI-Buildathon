package com.fairclaim.customer.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.BuildConfig
import com.fairclaim.customer.ai.CLOUD_MODEL
import com.fairclaim.customer.data.EvidenceDoc
import com.fairclaim.customer.firebase.LoadedPolicy
import com.fairclaim.engine.InferenceSource
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ResultScreen(app: AppViewModel, g: AppGraph, claimId: String) {
    val claims by app.claims.collectAsState()
    val decisions by app.decisions.collectAsState()
    val holds by app.holds.collectAsState()
    val orders by app.orders.collectAsState()
    val handoffs by app.handoffs.collectAsState()
    val finishing by app.finishing.collectAsState()
    val claim = (claims as? Loadable.Ok)?.value?.firstOrNull { it.claimId == claimId }
    val decision = (decisions as? Loadable.Ok)?.value?.firstOrNull { it.claimId == claimId }
    val hold = (holds as? Loadable.Ok)?.value?.firstOrNull { it.claimId == claimId }
    val order = claim?.let { c -> (orders as? Loadable.Ok)?.value?.firstOrNull { it.id == c.orderId } }
    val dispatch by produceState<EvidenceDoc?>(null, claim?.orderId) {
        value = claim?.orderId?.let { runCatching { g.repo.dispatchOnce(it) }.getOrNull() }
    }
    var lang by remember { mutableStateOf("en") }

    Scaffold(topBar = { Bar("Your claim", onBack = { app.back() }) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (claims is Loadable.Loading || decisions is Loadable.Loading) {
                LoadingBox()
                return@Column
            }
            if (claim == null) {
                MessageBox("Claim not found", (claims as? Loadable.Error)?.message)
                return@Column
            }
            if (decision == null) {
                val err = finishing[claimId]
                val running = finishing.containsKey(claimId) && err == null
                MessageBox(
                    if (running) "Deciding…" else "Your claim is saved",
                    err ?: "The decision hasn't been written yet.",
                    action = if (running) null else "Finish the decision",
                    onAction = { app.finishDecision(claimId) },
                )
                return@Column
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val (headline, color) = when (decision.verdict) {
                    "auto_refund" -> "Refunded ${rupees(decision.refundAmount)}" to Brand
                    "hold" -> "${rupees(decision.refundAmount)} approved, on hold" to Warn
                    else -> "Under review" to Warn
                }
                Text(headline, style = MaterialTheme.typography.headlineSmall, color = color, fontWeight = FontWeight.Bold)
                Text("Simulated refund: no real money moves in this prototype.", style = MaterialTheme.typography.bodySmall)
                if (decision.verdict == "review") Text("A person checks this claim before any refund. No instant refund was made.")

                if (decision.refundAmount > 0) Section("Who pays") {
                    KeyValue("Restaurant", rupees(decision.liability["restaurant"] ?: 0L))
                    KeyValue("Delivery (rider / platform)", rupees(decision.liability["transit"] ?: 0L))
                    if ((decision.liability["platform"] ?: 0L) > 0L) KeyValue("Platform", rupees(decision.liability["platform"] ?: 0L))
                    decision.split?.let { (r, t) -> Text("Split by the evidence: restaurant ${r / 10} %, delivery ${t / 10} %.", style = MaterialTheme.typography.bodySmall) }
                }

                if (hold != null) HoldBox(app, hold.claimId, hold.state, hold.endsAt)

                Section("Why") {
                    decision.reasons.forEach { Text("• ${g.reasons.text(it)}", style = MaterialTheme.typography.bodyMedium) }
                }

                val texts = mapOf(
                    "en" to decision.explanations["customer_en"].orEmpty(),
                    "hi" to decision.explanations["customer_hi"].orEmpty(),
                    "ta" to decision.explanations["customer_ta"].orEmpty(),
                ).filterValues { it.isNotBlank() }
                if (texts.isNotEmpty()) Section("Explanation") {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("en" to "English", "hi" to "हिन्दी", "ta" to "தமிழ்").filter { it.first in texts }.forEach { (k, label) ->
                            FilterChip(selected = lang == k, onClick = { lang = k }, label = { Text(label) })
                        }
                    }
                    // Plain text only (never rendered as markup), capped at 600 characters.
                    Text((texts[lang] ?: texts.values.first()).take(600), style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (decision.reviewStatus == "ok") "Review + explanation:" else "Review unavailable; note written by the rules.", style = MaterialTheme.typography.bodySmall)
                        if (decision.reviewStatus == "ok") SourceBadge(InferenceSource.IN_CLOUD)
                    }
                }

                Section("Where each check ran") {
                    BadgeRow("Dispatch photo (restaurant)", dispatch?.let { sourceOf(it.inferenceSource) }, if (dispatch == null) "none recorded" else null)
                    BadgeRow("Sealed-bag snap", handoffs[claim.orderId]?.let { sourceOf(it.inferenceSource) }, if (handoffs[claim.orderId] == null) "not taken" else null)
                    BadgeRow("Claim photo: code + fingers", sourceOf(claim.inferenceSources["challenge"]), null)
                    BadgeRow("Tapped item: damage", sourceOf(claim.inferenceSources["damage"]), if (claim.inferenceSources["damage"] == null) "not needed" else null)
                    BadgeRow("Refund amount and who pays", null, "fixed rules on this phone, no AI")
                }
                order?.let { o ->
                    Section("Order") { Text(o.items.joinToString(", ") { it.name } + " · " + rupees(o.total), style = MaterialTheme.typography.bodySmall) }
                }
                Text("Policy ${decision.policyVersion} · claim ${claim.claimId}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun BadgeRow(label: String, source: InferenceSource?, note: String?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (source != null) SourceBadge(source) else Text(note.orEmpty(), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun HoldBox(app: AppViewModel, claimId: String, state: String, endsAt: Long?) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    Section("Hold") {
        when (state) {
            "held" -> {
                if (endsAt == null) {
                    Text("Held while the restaurant can respond.")
                } else if (now < endsAt) {
                    val h = (endsAt - now) / 3_600_000
                    val m = (endsAt - now) / 60_000 % 60
                    Text("Held for about ${h} h ${m} min more while the restaurant can respond with evidence. Your refund amount won't change; only who pays can.")
                } else {
                    Text("The window is over and nobody answered, so the hold settles as decided.")
                    // Rules: either party may settle once the server-clock window has passed (device time is only a hint).
                    LaunchedEffect(claimId) { app.settleHold(claimId) }
                }
            }
            "accepted" -> Text("The restaurant accepted the split.")
            "settled" -> Text("Settled as decided.")
            "resolved" -> Text("Settled after the restaurant's counter-evidence.")
            "escalated" -> Text("The restaurant sent counter-evidence that needs a person to review it.")
            else -> Text(state)
        }
    }
}

@Composable
fun SettingsScreen(app: AppViewModel, g: AppGraph, restaurantName: String?, policy: LoadedPolicy?) {
    val context = LocalContext.current
    val model by g.deviceModel.state.collectAsState()
    val deleting by app.deleting.collectAsState()
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var diag by remember { mutableStateOf<List<String>>(emptyList()) }
    var running by remember { mutableStateOf(false) }
    val modelName by produceState<String?>(null, model) { value = g.deviceModel.modelName() }

    Scaffold(topBar = { Bar("Settings", onBack = { app.back() }) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Section("Restaurant") {
                Text(restaurantName ?: "Not connected")
                OutlinedButton(onClick = { app.unpair() }) { Text("Connect to another restaurant") }
            }
            Section("Refund policy") {
                KeyValue("Version", policy?.policy?.policyVersion ?: "loading")
                KeyValue("Source", when (policy?.source) { LoadedPolicy.Source.REMOTE -> "Remote Config"; LoadedPolicy.Source.BUNDLED -> "bundled default"; null -> "…" })
                policy?.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                policy?.policy?.let { KeyValue("Instant-refund limit", rupees(it.autoApproveCap)) }
            }
            Section("On-device model (Gemini Nano)") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ModelChip(model) { g.deviceModel.startDownloadIfNeeded() }
                    modelName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
                Text("Without Gemini Nano every check runs in the cloud with $CLOUD_MODEL; the evidence rules are the same.", style = MaterialTheme.typography.bodySmall)
            }
            Section("Diagnostics (T0 / T1)") {
                Text("App Check provider: ${g.appCheckProvider}", style = MaterialTheme.typography.bodySmall)
                Button(enabled = !running, onClick = {
                    running = true
                    scope.launch {
                        diag = Diagnostics.run(g)
                        running = false
                    }
                }) { Text(if (running) "Running…" else "Run App Check + model tests") }
                diag.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
            Section("Legal") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { openWeb(context, TERMS_PATH) }) { Text("Terms") }
                    TextButton(onClick = { openWeb(context, PRIVACY_PATH) }) { Text("Privacy") }
                }
            }
            HorizontalDivider()
            Section("Your data") {
                Text(
                    "\"Delete my data\" deletes your claims, the photo crops and your user record. Orders, sealed-bag snaps, decisions, holds and the " +
                        "one-claim-per-order and rate-limit markers stay: the security rules don't allow deleting them, so the restaurant's records stay " +
                        "consistent and the limits can't be reset. Crops are also deleted automatically after 3 days.",
                    style = MaterialTheme.typography.bodySmall,
                )
                when (val d = deleting) {
                    AppViewModel.DeleteState.Running -> Text("Deleting…")
                    is AppViewModel.DeleteState.Done -> Text("Deleted ${d.report.claims} claim(s) and ${d.report.crops} crop(s)${if (d.report.cropsAlreadyGone > 0) " (${d.report.cropsAlreadyGone} crop(s) were already gone)" else ""}.")
                    is AppViewModel.DeleteState.Failed -> Text("Delete failed: ${d.message}", color = MaterialTheme.colorScheme.error)
                    AppViewModel.DeleteState.Idle -> {}
                }
                Button(
                    onClick = { confirmDelete = true },
                    enabled = deleting != AppViewModel.DeleteState.Running,
                    colors = ButtonDefaults.buttonColors(containerColor = Bad),
                ) { Text("Delete my data") }
            }
            Text("FairClaim ${BuildConfig.VERSION_NAME} (${if (BuildConfig.DEBUG) "debug" else "release"})", style = MaterialTheme.typography.bodySmall)
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete your claims and crops?") },
            text = { Text("This can't be undone. You'll see the Terms screen again afterwards.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; app.deleteMyData() }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
