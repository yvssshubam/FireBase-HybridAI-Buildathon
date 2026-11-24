package com.fairclaim.customer.firebase

import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

// RELEASE BUILDS (src/release): Play Integrity. The judge APK is sideloaded, so the App Check
// console entry for com.fairclaim.customer must be set to "distributed outside Google Play"
// (PLAY_RECOGNIZED not required, LICENSED not required, minimum integrity = device integrity),
// with the release signing certificate's SHA-256 registered (PLAN §5).
object AppCheckSetup {
    const val PROVIDER = "play-integrity"

    fun install() {
        Firebase.appCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
    }
}
