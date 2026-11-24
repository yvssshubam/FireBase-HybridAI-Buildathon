package com.fairclaim.customer.ui

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.FairClaimApp
import com.fairclaim.customer.claim.DecisionRunner
import com.fairclaim.customer.data.ClaimDoc
import com.fairclaim.customer.data.DecisionDoc
import com.fairclaim.customer.data.EvidenceDoc
import com.fairclaim.customer.data.HoldDoc
import com.fairclaim.customer.data.LocalStore
import com.fairclaim.customer.data.OrderDoc
import com.fairclaim.customer.data.Repository
import com.fairclaim.customer.data.Restaurant
import com.fairclaim.customer.data.normalizeTypedCode
import com.fairclaim.customer.data.parsePairPayload
import com.fairclaim.customer.firebase.LoadedPolicy
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Where the app is, as a back stack (no navigation library needed for nine screens). */
sealed interface Screen {
    data object Home : Screen
    data class Order(val orderId: String) : Screen
    data class Handoff(val orderId: String) : Screen
    data class Claim(val orderId: String) : Screen
    data class Result(val claimId: String) : Screen
    data object Settings : Screen
    data object Pair : Screen
}

sealed interface Session {
    data class SetupError(val message: String) : Session
    data object Starting : Session
    data class StartFailed(val message: String) : Session
    data class NeedsTerms(val uid: String) : Session
    data class NeedsPairing(val uid: String) : Session
    data class Ready(val uid: String, val restaurant: LocalStore.Paired) : Session
}

/** Load state for a list: lets every screen show loading / empty / error, not just data. */
sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>
    data class Ok<T>(val value: T) : Loadable<T>
    data class Error(val message: String) : Loadable<Nothing>
}

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val fairClaim = app as FairClaimApp
    val graph: AppGraph? = fairClaim.graph

    private val _session = MutableStateFlow<Session>(fairClaim.setupError?.let(Session::SetupError) ?: Session.Starting)
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _policy = MutableStateFlow<LoadedPolicy?>(null)
    val policy: StateFlow<LoadedPolicy?> = _policy.asStateFlow()

    private val _stack = MutableStateFlow<List<Screen>>(listOf(Screen.Home))
    val stack: StateFlow<List<Screen>> = _stack.asStateFlow()

    /** A pairing code that arrived through a fairclaim:// link before the session was ready. */
    private var pendingPairCode: String? = null

    init {
        start()
    }

    fun start() {
        val g = graph ?: return
        viewModelScope.launch {
            _session.value = Session.Starting
            try {
                val uid = g.repo.signIn()
                _policy.value = g.policyLoader.load()
                if (!g.repo.termsAccepted(uid)) {
                    _session.value = Session.NeedsTerms(uid)
                    return@launch
                }
                g.deviceModel.refresh()
                g.deviceModel.startDownloadIfNeeded()
                afterTerms(uid)
            } catch (e: Exception) {
                Log.w("FairClaim", "start failed", e)
                _session.value = Session.StartFailed(startError(e))
            }
        }
    }

    private fun startError(e: Exception): String {
        val m = e.message.orEmpty()
        return when {
            m.contains("App Check", true) || m.contains("attestation", true) ->
                "App Check rejected this app. For a debug build, register the debug token from logcat in the Firebase console."
            m.contains("network", true) || m.contains("UNAVAILABLE") -> "No connection to Firebase. Check the internet and try again."
            m.contains("CONFIGURATION_NOT_FOUND") || m.contains("ADMIN_ONLY_OPERATION") -> "Anonymous sign-in is not enabled in Firebase Authentication."
            else -> "Couldn't start: $m"
        }
    }

    private suspend fun afterTerms(uid: String) {
        val g = graph ?: return
        val paired = g.local.paired()
        _session.value = if (paired == null) Session.NeedsPairing(uid) else Session.Ready(uid, paired)
        pendingPairCode?.let { code ->
            pendingPairCode = null
            pair(code)
        }
    }

    fun acceptTerms() {
        val g = graph ?: return
        val s = _session.value as? Session.NeedsTerms ?: return
        viewModelScope.launch {
            try {
                g.repo.acceptTerms(s.uid)
                // The on-device model download is not automatic: kick it off now (PLAN §6.3).
                g.deviceModel.startDownloadIfNeeded()
                afterTerms(s.uid)
            } catch (e: Exception) {
                _session.value = Session.StartFailed("Couldn't save your acceptance: ${e.message}")
            }
        }
    }

    // ---- pairing ----
    private val _pairing = MutableStateFlow<PairState>(PairState.Idle)
    val pairing: StateFlow<PairState> = _pairing.asStateFlow()

    sealed interface PairState {
        data object Idle : PairState
        data object Looking : PairState
        data class Error(val message: String) : PairState
        data class Done(val restaurant: Restaurant) : PairState
    }

    /** From the QR scanner (full payload) or a deep link. */
    fun pairFromScan(text: String) {
        val code = parsePairPayload(text)
        if (code == null) {
            _pairing.value = PairState.Error("That QR code isn't a FairClaim restaurant code.")
            return
        }
        pair(code)
    }

    fun pairFromTyped(text: String) {
        val code = normalizeTypedCode(text)
        if (code == null) {
            _pairing.value = PairState.Error("Codes are 6 characters: letters A–Z (no I or O) and digits 2–9.")
            return
        }
        pair(code)
    }

    fun pairFromLink(link: String) {
        val code = parsePairPayload(link) ?: return
        val s = _session.value
        if (s is Session.NeedsPairing || s is Session.Ready) pair(code) else pendingPairCode = code
    }

    private fun pair(code: String) {
        val g = graph ?: return
        val uid = when (val s = _session.value) {
            is Session.NeedsPairing -> s.uid
            is Session.Ready -> s.uid
            else -> return
        }
        if (_pairing.value == PairState.Looking) return
        viewModelScope.launch {
            _pairing.value = PairState.Looking
            try {
                val r = g.repo.restaurantForPairCode(code)
                if (r == null) {
                    _pairing.value = PairState.Error("No restaurant uses the code $code. Check the code under the QR in the restaurant app.")
                    return@launch
                }
                g.local.setPaired(r.id, r.name)
                _pairing.value = PairState.Done(r)
                _session.value = Session.Ready(uid, LocalStore.Paired(r.id, r.name))
                _stack.value = listOf(Screen.Home)
            } catch (e: Exception) {
                _pairing.value = PairState.Error("Couldn't look up the code: ${e.message}")
            }
        }
    }

    fun resetPairingState() {
        _pairing.value = PairState.Idle
    }

    // ---- navigation ----
    fun open(screen: Screen) {
        _stack.value = _stack.value + screen
    }

    /** Replace the top screen (e.g. claim flow → its result). */
    fun replace(screen: Screen) {
        _stack.value = _stack.value.dropLast(1) + screen
    }

    fun back(): Boolean {
        if (_stack.value.size <= 1) return false
        _stack.value = _stack.value.dropLast(1)
        return true
    }

    // ---- data (customer-filtered queries the rules can prove) ----
    private val uidFlow: Flow<String?> = session.map { (it as? Session.Ready)?.uid }

    private fun <T> live(source: (Repository, String) -> Flow<List<T>>): StateFlow<Loadable<List<T>>> =
        uidFlow.flatMapLatest { uid ->
            val g = graph
            if (uid == null || g == null) {
                flowOf(Loadable.Loading)
            } else {
                source(g.repo, uid)
                    .map<List<T>, Loadable<List<T>>> { Loadable.Ok(it) }
                    .catch { emit(Loadable.Error(it.message ?: "couldn't load")) }
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Loadable.Loading)

    val orders: StateFlow<Loadable<List<OrderDoc>>> = live { r, uid -> r.myOrders(uid) }
    val claims: StateFlow<Loadable<List<ClaimDoc>>> = live { r, uid -> r.myClaims(uid) }
    val decisions: StateFlow<Loadable<List<DecisionDoc>>> = live { r, uid -> r.myDecisions(uid) }
    val holds: StateFlow<Loadable<List<HoldDoc>>> = live { r, uid -> r.myHolds(uid) }

    /** Handoff snap per order (doc listeners; handoff docs carry no customerId to query on). */
    val handoffs: StateFlow<Map<String, EvidenceDoc>> = orders.flatMapLatest { l ->
        val g = graph
        val list = (l as? Loadable.Ok)?.value.orEmpty()
        if (g == null || list.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(list.map { o -> g.repo.handoff(o.id).catch { emit(null) } }) { arr ->
                arr.filterNotNull().associateBy { it.orderId }
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    // ---- restaurant menu (re-read when the screen opens) ----
    private val _menu = MutableStateFlow<Loadable<Restaurant>>(Loadable.Loading)
    val menu: StateFlow<Loadable<Restaurant>> = _menu.asStateFlow()

    fun loadMenu() {
        val g = graph ?: return
        val s = _session.value as? Session.Ready ?: return
        viewModelScope.launch {
            _menu.value = Loadable.Loading
            _menu.value = try {
                g.repo.restaurant(s.restaurant.restaurantId)?.let { Loadable.Ok(it) }
                    ?: Loadable.Error("The paired restaurant no longer exists. Pair again from Settings.")
            } catch (e: Exception) {
                Loadable.Error("Couldn't load the menu: ${e.message}")
            }
        }
    }

    private val _ordering = MutableStateFlow<String?>(null)
    /** Error text of the last order attempt, if any. */
    val orderError: StateFlow<String?> = _ordering.asStateFlow()

    fun placeOrder(itemIds: List<String>, onPlaced: (String) -> Unit) {
        val g = graph ?: return
        val s = _session.value as? Session.Ready ?: return
        val r = (_menu.value as? Loadable.Ok)?.value ?: return
        viewModelScope.launch {
            _ordering.value = null
            try {
                onPlaced(g.repo.placeOrder(r, s.uid, itemIds))
            } catch (e: Exception) {
                _ordering.value = if (Repository.isPermissionDenied(e)) "The restaurant's menu changed. Reload the menu and try again." else "Couldn't place the order: ${e.message}"
            }
        }
    }

    // ---- decisions finished later (app closed between claim and decision) ----
    private val _finishing = MutableStateFlow<Map<String, String?>>(emptyMap())
    /** claimId → null while running, or the error text. */
    val finishing: StateFlow<Map<String, String?>> = _finishing.asStateFlow()

    fun finishDecision(claimId: String) {
        val g = graph ?: return
        val s = _session.value as? Session.Ready ?: return
        val p = _policy.value ?: return
        viewModelScope.launch {
            _finishing.value = _finishing.value + (claimId to null)
            try {
                DecisionRunner(g.repo, g.ai, g.reasons).run(claimId, s.uid, p)
                _finishing.value = _finishing.value - claimId
            } catch (e: Exception) {
                _finishing.value = _finishing.value + (claimId to (e.message ?: "failed"))
            }
        }
    }

    /** The hold window is over and nobody answered: settle it (either party may, rules). */
    fun settleHold(claimId: String) {
        val g = graph ?: return
        viewModelScope.launch {
            try {
                g.repo.settleHold(claimId)
            } catch (e: Exception) {
                Log.w("FairClaim", "settle failed", e) // the restaurant's app can settle it too
            }
        }
    }

    // ---- settings ----
    fun unpair() {
        val g = graph ?: return
        val s = _session.value as? Session.Ready ?: return
        g.local.clear()
        _session.value = Session.NeedsPairing(s.uid)
        _stack.value = listOf(Screen.Home)
    }

    private val _deleting = MutableStateFlow<DeleteState>(DeleteState.Idle)
    val deleting: StateFlow<DeleteState> = _deleting.asStateFlow()

    sealed interface DeleteState {
        data object Idle : DeleteState
        data object Running : DeleteState
        data class Done(val report: Repository.DeleteReport) : DeleteState
        data class Failed(val message: String) : DeleteState
    }

    fun deleteMyData() {
        val g = graph ?: return
        val uid = when (val s = _session.value) {
            is Session.Ready -> s.uid
            is Session.NeedsPairing -> s.uid
            else -> return
        }
        viewModelScope.launch {
            _deleting.value = DeleteState.Running
            try {
                val report = g.repo.deleteMyData(uid)
                g.local.clear()
                _deleting.value = DeleteState.Done(report)
                _stack.value = listOf(Screen.Home)
                _session.value = Session.NeedsTerms(uid) // users/{uid} is gone, so the Terms gate returns
            } catch (e: Exception) {
                _deleting.value = DeleteState.Failed(e.message ?: "failed")
            }
        }
    }

    fun clearDeleteState() {
        _deleting.value = DeleteState.Idle
    }
}
