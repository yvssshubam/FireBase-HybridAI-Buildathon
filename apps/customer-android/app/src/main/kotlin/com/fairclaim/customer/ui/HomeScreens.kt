package com.fairclaim.customer.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fairclaim.customer.data.DecisionDoc
import com.fairclaim.customer.data.MAX_ORDER_LINES
import com.fairclaim.customer.data.OrderDoc
import com.fairclaim.customer.data.OrderStatus

@Composable
fun HomeScreen(vm: AppViewModel, restaurantName: String) {
    val g = vm.graph ?: return
    val model by g.deviceModel.state.collectAsState()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Scaffold(topBar = {
        Bar(restaurantName) {
            ModelChip(model) { g.deviceModel.startDownloadIfNeeded() }
            TextButton(onClick = { vm.open(Screen.Settings) }) { Text("Settings") }
        }
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Menu") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("My orders") })
            }
            if (tab == 0) MenuTab(vm) { tab = 1 } else OrdersTab(vm)
        }
    }
}

@Composable
private fun MenuTab(vm: AppViewModel, onPlaced: () -> Unit) {
    val menu by vm.menu.collectAsState()
    val error by vm.orderError.collectAsState()
    var chosen by remember { mutableStateOf(listOf<String>()) }
    var placing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.loadMenu() }
    when (val m = menu) {
        Loadable.Loading -> LoadingBox("Loading the menu…")
        is Loadable.Error -> MessageBox("Menu unavailable", m.message, "Retry", { vm.loadMenu() })
        is Loadable.Ok -> {
            val r = m.value
            if (r.menu.isEmpty()) {
                MessageBox("No dishes yet", "The restaurant's menu is empty.", "Reload", { vm.loadMenu() })
                return
            }
            val total = r.menu.filter { it.id in chosen }.sumOf { it.price }
            Column(Modifier.fillMaxSize()) {
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    items(r.menu, key = { it.id }) { item ->
                        val on = item.id in chosen
                        val canAdd = on || chosen.size < MAX_ORDER_LINES
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable(enabled = canAdd, role = Role.Checkbox) { chosen = if (on) chosen - item.id else chosen + item.id }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = on, onCheckedChange = null, enabled = canAdd)
                            Text(item.name, Modifier.weight(1f).padding(start = 8.dp))
                            Text(rupees(item.price), fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Up to $MAX_ORDER_LINES dishes, one of each (a demo order; nothing is charged).", style = MaterialTheme.typography.bodySmall)
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Button(
                        onClick = {
                            placing = true
                            vm.placeOrder(chosen) { chosen = emptyList(); placing = false; onPlaced() }
                        },
                        enabled = chosen.isNotEmpty() && !placing,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (placing) "Placing…" else "Place order · ${rupees(total)}") }
                }
                LaunchedEffect(error) { if (error != null) placing = false }
            }
        }
    }
}

@Composable
private fun OrdersTab(vm: AppViewModel) {
    val orders by vm.orders.collectAsState()
    val handoffs by vm.handoffs.collectAsState()
    val decisions by vm.decisions.collectAsState()
    val byOrder = (decisions as? Loadable.Ok)?.value.orEmpty().associateBy { it.orderId }
    when (val o = orders) {
        Loadable.Loading -> LoadingBox("Loading your orders…")
        is Loadable.Error -> MessageBox("Couldn't load your orders", o.message)
        is Loadable.Ok -> if (o.value.isEmpty()) {
            MessageBox("No orders yet", "Pick dishes on the Menu tab and place a demo order. It appears in the restaurant app right away.")
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(o.value, key = { it.id }) { order ->
                    OrderCard(order, handoffs.containsKey(order.id), byOrder[order.id]) { vm.open(Screen.Order(order.id)) }
                }
            }
        }
    }
}

fun statusText(s: OrderStatus) = when (s) {
    OrderStatus.PLACED -> "Placed · waiting for the restaurant"
    OrderStatus.DISPATCHED -> "Dispatched · on its way"
    OrderStatus.DELIVERED -> "Delivered"
}

fun verdictText(v: String) = when (v) {
    "auto_refund" -> "Refunded"
    "hold" -> "Refund on hold"
    "review" -> "Under review"
    else -> v
}

@Composable
private fun OrderCard(order: OrderDoc, verified: Boolean, decision: DecisionDoc?, onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen).semantics { contentDescription = "Order ${order.items.joinToString { it.name }}, ${statusText(order.status)}" }) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(order.items.joinToString(", ") { it.name }, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(statusText(order.status), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(rupees(order.total), style = MaterialTheme.typography.bodyMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (verified) Pill("Verified unboxing ✓", Brand)
                decision?.let { Pill(verdictText(it.verdict) + if (it.refundAmount > 0) " · ${rupees(it.refundAmount)}" else "", if (it.verdict == "review") Warn else Brand) }
            }
        }
    }
}

@Composable
fun OrderScreen(vm: AppViewModel, orderId: String) {
    val orders by vm.orders.collectAsState()
    val handoffs by vm.handoffs.collectAsState()
    val claims by vm.claims.collectAsState()
    val decisions by vm.decisions.collectAsState()
    val finishing by vm.finishing.collectAsState()
    val g = vm.graph
    LaunchedEffect(Unit) { g?.deviceModel?.warmUp() }
    Scaffold(topBar = { Bar("Order", onBack = { vm.back() }) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            val list = orders
            if (list !is Loadable.Ok) {
                if (list is Loadable.Error) MessageBox("Couldn't load the order", list.message) else LoadingBox()
                return@Column
            }
            val order = list.value.firstOrNull { it.id == orderId }
            if (order == null) {
                MessageBox("Order not found")
                return@Column
            }
            val handoff = handoffs[orderId]
            val claim = (claims as? Loadable.Ok)?.value?.firstOrNull { it.orderId == orderId }
            val decision = (decisions as? Loadable.Ok)?.value?.firstOrNull { it.orderId == orderId }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Section("Items") {
                    order.items.forEach { KeyValue(it.name, rupees(it.price)) }
                    KeyValue("Total", rupees(order.total))
                }
                Section("Status") { Text(statusText(order.status)) }
                Section("Sealed-bag snap") {
                    when {
                        handoff != null -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Pill("Verified unboxing ✓", Brand)
                            SourceBadge(sourceOf(handoff.inferenceSource))
                        }
                        claim != null -> Text("Not taken before the claim.")
                        order.claimable -> {
                            Text("Before you open the bag, snap the sealed bag (3 seconds). It's what lets a missing-item claim be refunded instantly.", style = MaterialTheme.typography.bodyMedium)
                            Button(onClick = { vm.open(Screen.Handoff(orderId)) }, modifier = Modifier.fillMaxWidth()) { Text("Snap the sealed bag") }
                        }
                        else -> Text("Available once the restaurant dispatches the order.")
                    }
                }
                Section("Problem with this order?") {
                    when {
                        claim != null && decision != null -> Button(onClick = { vm.open(Screen.Result(claim.claimId)) }, modifier = Modifier.fillMaxWidth()) {
                            Text("${verdictText(decision.verdict)} · see the decision")
                        }
                        claim != null -> {
                            val state = finishing[claim.claimId]
                            val running = finishing.containsKey(claim.claimId) && state == null
                            Text("Your claim is saved but its decision hasn't been written yet.")
                            if (state != null) Text(state, color = MaterialTheme.colorScheme.error)
                            Button(onClick = { vm.finishDecision(claim.claimId) }, enabled = !running, modifier = Modifier.fillMaxWidth()) {
                                Text(if (running) "Deciding…" else "Finish the decision")
                            }
                        }
                        order.claimable -> OutlinedButton(onClick = { vm.open(Screen.Claim(orderId)) }, modifier = Modifier.fillMaxWidth()) { Text("Report a problem") }
                        else -> Text("You can report a problem once the order is dispatched.")
                    }
                }
            }
        }
    }
}
