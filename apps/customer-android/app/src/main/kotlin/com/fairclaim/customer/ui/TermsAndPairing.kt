package com.fairclaim.customer.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.fairclaim.customer.camera.CameraPermissionGate
import com.fairclaim.customer.camera.LiveCamera
import com.fairclaim.customer.camera.QrAnalyzer
import com.fairclaim.customer.data.TERMS_VERSION
import kotlinx.coroutines.launch

/** First run (§23): notice + consent, stored as users/{uid} { termsVersion, acceptedAt, role }. */
@Composable
fun TermsScreen(onAccept: () -> Unit) {
    val context = LocalContext.current
    var agreed by remember { mutableStateOf(false) }
    var linkError by remember { mutableStateOf<String?>(null) }
    Scaffold(topBar = { Bar("Welcome to FairClaim") }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Fast refunds for honest customers. Proof for restaurants.", style = MaterialTheme.typography.titleMedium)
            Text(
                "This is a hackathon prototype: refunds, holds and who pays are simulated and no real money moves. " +
                    "Claim photos are taken live and checked on this phone with Gemini Nano when it can run it, otherwise by Gemini in the cloud " +
                    "for that check only. Only the small crop of the item you tap is stored, never the full photo. No name, phone number or location is collected.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text("For people aged 18 and over. Don't use fake, edited or other people's photos.", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { if (!openWeb(context, TERMS_PATH)) linkError = "No browser found." }) { Text("Read the Terms") }
                OutlinedButton(onClick = { if (!openWeb(context, PRIVACY_PATH)) linkError = "No browser found." }) { Text("Privacy Policy") }
            }
            if (webPlaceholder) Text("(The web pages aren't deployed for this build yet.)", style = MaterialTheme.typography.bodySmall)
            linkError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = agreed, onCheckedChange = { agreed = it })
                Text("I agree to the Terms and the Privacy Policy (version $TERMS_VERSION)", style = MaterialTheme.typography.bodyMedium)
            }
            Button(onClick = onAccept, enabled = agreed, modifier = Modifier.fillMaxWidth()) { Text("Continue") }
        }
    }
}

/** Pair with the restaurant web app: scan its "Connect a phone" QR, or type the code under it. */
@Composable
fun PairScreen(vm: AppViewModel, onBack: (() -> Unit)?) {
    val state by vm.pairing.collectAsState()
    var typed by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val analyzer = remember {
        QrAnalyzer { text -> scope.launch { if (vm.pairing.value !is AppViewModel.PairState.Looking) vm.pairFromScan(text) } }
    }
    Scaffold(topBar = { Bar("Connect to a restaurant", onBack) }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("In the restaurant web app, open \"Connect a phone\" and point the camera at the QR code.", style = MaterialTheme.typography.bodyMedium)
            if (scanning) {
                Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
                    CameraPermissionGate {
                        LiveCamera(Modifier.fillMaxSize(), analyzer = analyzer, description = "Camera preview for scanning the restaurant QR code")
                    }
                }
            } else {
                TextButton(onClick = { scanning = true }) { Text("Scan the QR again") }
            }
            when (val s = state) {
                AppViewModel.PairState.Looking -> Text("Looking up the restaurant…")
                is AppViewModel.PairState.Error -> Text(s.message, color = MaterialTheme.colorScheme.error)
                is AppViewModel.PairState.Done -> Text("Connected to ${s.restaurant.name}.")
                AppViewModel.PairState.Idle -> {}
            }
            Text("Or type the 6-character code shown under the QR:", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it.take(8) },
                label = { Text("Pair code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { vm.pairFromTyped(typed) }),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { scanning = false; vm.pairFromTyped(typed) }, enabled = typed.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Connect") }
        }
    }
}
