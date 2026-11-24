package com.fairclaim.customer.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleLink(intent)
        setContent {
            FairClaimTheme {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) { Root(vm) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** fairclaim://pair?code=XXXXXX, the same payload as the web app's QR (validated by parsePairPayload). */
    private fun handleLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (intent.action == Intent.ACTION_VIEW) vm.pairFromLink(data.toString())
    }
}

@Composable
fun Root(vm: AppViewModel) {
    val session by vm.session.collectAsState()
    val stack by vm.stack.collectAsState()
    val policy by vm.policy.collectAsState()
    val g = vm.graph
    when (val s = session) {
        is Session.SetupError -> MessageBox("FairClaim isn't set up", s.message)
        Session.Starting -> LoadingBox("Connecting securely…")
        is Session.StartFailed -> MessageBox("Can't connect", s.message, "Try again", { vm.start() })
        is Session.NeedsTerms -> TermsScreen(onAccept = vm::acceptTerms)
        is Session.NeedsPairing -> PairScreen(vm, onBack = null)
        is Session.Ready -> {
            if (g == null) return
            val top = stack.last()
            BackHandler(enabled = stack.size > 1) { vm.back() }
            when (top) {
                Screen.Home -> HomeScreen(vm, s.restaurant.name)
                is Screen.Order -> OrderScreen(vm, top.orderId)
                is Screen.Handoff -> HandoffScreen(vm, g, top.orderId)
                is Screen.Claim -> {
                    val p = policy
                    if (p == null) LoadingBox("Loading the refund policy…") else ClaimScreen(vm, g, s.uid, top.orderId, p)
                }
                is Screen.Result -> ResultScreen(vm, g, top.claimId)
                Screen.Settings -> SettingsScreen(vm, g, s.restaurant.name, policy)
                Screen.Pair -> PairScreen(vm, onBack = { vm.back() })
            }
        }
    }
}
