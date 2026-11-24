package com.fairclaim.customer.firebase

import com.fairclaim.customer.BuildConfig
import com.fairclaim.engine.Policy
import com.fairclaim.engine.policyFromJsonString
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import kotlinx.coroutines.tasks.await

/** Refund policy and where it came from (shown in Settings and on the result screen). */
data class LoadedPolicy(val policy: Policy, val source: Source, val note: String?) {
    enum class Source { REMOTE, BUNDLED }
}

/**
 * Remote Config `policy_json` (generated from packages/schemas/policy, see remoteconfig.template.json),
 * validated by the engine's policyFromJsonString; the bundled copy of the same file is the fallback.
 * Firestore config/policy (seeded from the same file) is what the rules check the decision against.
 */
class PolicyLoader(private val rc: FirebaseRemoteConfig, private val bundledJson: String) {
    val bundled: Policy = policyFromJsonString(bundledJson)

    suspend fun load(): LoadedPolicy {
        try {
            rc.setConfigSettingsAsync(
                remoteConfigSettings {
                    fetchTimeoutInSeconds = 8
                    minimumFetchIntervalInSeconds = if (BuildConfig.DEBUG) 60 else 3600
                },
            ).await()
            rc.setDefaultsAsync(mapOf(KEY to bundledJson)).await()
            rc.fetchAndActivate().await()
        } catch (e: Exception) {
            return LoadedPolicy(bundled, LoadedPolicy.Source.BUNDLED, "Remote Config fetch failed: ${e.message ?: e::class.simpleName}")
        }
        val value = rc.getValue(KEY)
        if (value.source != FirebaseRemoteConfig.VALUE_SOURCE_REMOTE) {
            return LoadedPolicy(bundled, LoadedPolicy.Source.BUNDLED, "Remote Config has no policy_json yet")
        }
        return try {
            LoadedPolicy(policyFromJsonString(value.asString()), LoadedPolicy.Source.REMOTE, null)
        } catch (e: Exception) { // bad JSON, missing key (NoSuchElementException) or out-of-range value
            LoadedPolicy(bundled, LoadedPolicy.Source.BUNDLED, "Remote policy_json is invalid: ${e.message}")
        }
    }

    private companion object {
        const val KEY = "policy_json"
    }
}
