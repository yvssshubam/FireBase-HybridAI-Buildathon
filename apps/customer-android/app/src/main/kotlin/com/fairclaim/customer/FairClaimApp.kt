package com.fairclaim.customer

import android.app.Application
import android.util.Log
import com.fairclaim.customer.ai.DeviceModel
import com.fairclaim.customer.ai.FairClaimAi
import com.fairclaim.customer.claim.ReasonTexts
import com.fairclaim.customer.data.LocalStore
import com.fairclaim.customer.data.Repository
import com.fairclaim.customer.firebase.AppCheckSetup
import com.fairclaim.customer.firebase.PolicyLoader
import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.auth
import com.google.firebase.firestore.firestore
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.storage.storage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/** Everything the screens share. Created once in [FairClaimApp.onCreate]. */
class AppGraph(app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val local = LocalStore(app)
    // Fail fast instead of the SDK's 10-minute upload retry: without a Storage bucket (Spark plan) a crop
    // upload would otherwise leave the claim spinning for minutes before showing the error.
    val repo = Repository(Firebase.auth, Firebase.firestore, Firebase.storage.apply {
        maxUploadRetryTimeMillis = 15_000
        maxOperationRetryTimeMillis = 15_000
    })
    val ai = FairClaimAi()
    val deviceModel = DeviceModel(ai.hybrid, scope)
    val policyLoader = PolicyLoader(Firebase.remoteConfig, app.assets.open("policy.v1.json").bufferedReader().use { it.readText() })
    val reasons = ReasonTexts.parse(app.assets.open("reason-codes.json").bufferedReader().use { it.readText() })
    val appCheckProvider: String = AppCheckSetup.PROVIDER
}

class FairClaimApp : Application() {
    /** null when the build has no google-services.json (setup screen explains what to do). */
    var graph: AppGraph? = null
        private set

    var setupError: String? = null
        private set

    override fun onCreate() {
        super.onCreate()
        try {
            if (FirebaseApp.getApps(this).isEmpty() && FirebaseApp.initializeApp(this) == null) {
                setupError = "This build has no Firebase configuration. Put google-services.json in apps/customer-android/app/ and rebuild (README → Android app)."
                return
            }
            // App Check first, so every Firebase request (AI Logic, Firestore, Storage, Remote Config) carries a token.
            AppCheckSetup.install()
            graph = AppGraph(this)
        } catch (e: Exception) {
            Log.e("FairClaim", "startup failed", e)
            setupError = "Startup failed: ${e.message}"
        }
    }
}
