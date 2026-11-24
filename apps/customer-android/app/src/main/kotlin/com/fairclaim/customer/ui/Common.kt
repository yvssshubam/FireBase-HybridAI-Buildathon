package com.fairclaim.customer.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fairclaim.customer.BuildConfig
import com.fairclaim.customer.ai.DeviceModelState
import com.fairclaim.engine.InferenceSource

val Brand = Color(0xFF0F6E5A)
val Warn = Color(0xFFB45309)
val Bad = Color(0xFFB91C1C)

private val scheme: ColorScheme = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    secondary = Color(0xFF365E57),
    error = Bad,
)

@Composable
fun FairClaimTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Bar(title: String, onBack: (() -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1) },
        navigationIcon = {
            if (onBack != null) TextButton(onClick = onBack, modifier = Modifier.semantics { contentDescription = "Back" }) { Text("‹ Back") }
        },
        actions = { actions() },
    )
}

@Composable
fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
fun LoadingBox(text: String = "Loading…") {
    Centered {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator()
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun MessageBox(title: String, body: String? = null, action: String? = null, onAction: () -> Unit = {}, secondary: String? = null, onSecondary: () -> Unit = {}) {
    Centered {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium)
            if (action != null) Button(onClick = onAction) { Text(action) }
            if (secondary != null) OutlinedButton(onClick = onSecondary) { Text(secondary) }
        }
    }
}

@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Color.White,
        style = MaterialTheme.typography.labelSmall,
        modifier = modifier.background(color, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** Where an AI check ran: shown on every AI result (judges should see hybrid inference happen). */
@Composable
fun SourceBadge(source: InferenceSource?, modifier: Modifier = Modifier) {
    when (source) {
        InferenceSource.ON_DEVICE -> Pill("ON-DEVICE · Gemini Nano", Brand, modifier.semantics { contentDescription = "Ran on device with Gemini Nano" })
        InferenceSource.IN_CLOUD -> Pill("CLOUD · Gemini", Color(0xFF1D4ED8), modifier.semantics { contentDescription = "Ran in the cloud with Gemini" })
        null -> {}
    }
}

fun sourceOf(wire: String?): InferenceSource? = when (wire) {
    "ON_DEVICE" -> InferenceSource.ON_DEVICE
    "IN_CLOUD" -> InferenceSource.IN_CLOUD
    else -> null
}

/** Gemini Nano availability (available / downloading with progress / unavailable → cloud). */
@Composable
fun ModelChip(state: DeviceModelState, onClick: () -> Unit) {
    val (text, color) = when (state) {
        DeviceModelState.Checking -> "Nano: checking" to Color.Gray
        DeviceModelState.Available -> "Nano ready" to Brand
        DeviceModelState.Downloadable -> "Nano: tap to download" to Warn
        is DeviceModelState.Downloading -> (state.fraction?.let { "Nano ${(it * 100).toInt()} %" } ?: "Nano downloading") to Warn
        DeviceModelState.Unavailable -> "Using cloud" to Color(0xFF1D4ED8)
        is DeviceModelState.Failed -> "Nano failed · cloud" to Bad
    }
    TextButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = "On-device model status: $text" }) {
        Pill(text, color)
    }
}

fun rupees(amount: Long) = "₹$amount"

@Composable
fun Section(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.secondary)
        content()
    }
}

@Composable
fun KeyValue(key: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(key, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun SmallSpinner() = CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)

const val TERMS_PATH = "/terms"
const val PRIVACY_PATH = "/privacy"

val webPlaceholder: Boolean get() = BuildConfig.WEB_BASE_URL.contains("placeholder")

/** /terms and /privacy on the Vercel deployment, in a Custom Tab. */
fun openWeb(context: Context, path: String): Boolean = try {
    CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(BuildConfig.WEB_BASE_URL + path))
    true
} catch (e: ActivityNotFoundException) {
    false
}
