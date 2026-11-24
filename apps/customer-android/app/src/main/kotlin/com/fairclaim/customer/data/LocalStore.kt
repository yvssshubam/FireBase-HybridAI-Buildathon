package com.fairclaim.customer.data

import android.content.Context

/** The paired sandbox restaurant (per install; app data is excluded from backups). */
class LocalStore(context: Context) {
    private val prefs = context.getSharedPreferences("fairclaim", Context.MODE_PRIVATE)

    data class Paired(val restaurantId: String, val name: String)

    fun paired(): Paired? {
        val id = prefs.getString(KEY_ID, null) ?: return null
        return Paired(id, prefs.getString(KEY_NAME, null) ?: "Restaurant")
    }

    fun setPaired(restaurantId: String, name: String) {
        prefs.edit().putString(KEY_ID, restaurantId).putString(KEY_NAME, name).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_ID = "restaurantId"
        const val KEY_NAME = "restaurantName"
    }
}
