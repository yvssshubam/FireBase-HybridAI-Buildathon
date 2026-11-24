package com.fairclaim.customer.firebase

import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

// DEBUG BUILDS ONLY (src/debug). The debug provider prints a debug secret to logcat on first run
// ("Enter this debug secret into the allow list in the Firebase Console…"); register it under
// App Check → Apps → Manage debug tokens. The release source set uses Play Integrity instead, so
// this class and the debug provider never ship in the judge APK (grepped by scripts in the README).
object AppCheckSetup {
    const val PROVIDER = "debug"

    fun install() {
        Firebase.appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
    }
}
