package com.fairclaim.customer

import com.fairclaim.engine.Policy
import com.fairclaim.engine.policyFrom
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File

/** Shared files from packages/schemas, passed in by app/build.gradle.kts (tasks.withType<Test>). */
object TestFiles {
    private fun file(prop: String): File = File(requireNotNull(System.getProperty(prop)) { "system property $prop not set" })

    val policyJson: JsonObject by lazy { Json.parseToJsonElement(file("fairclaim.policy").readText()).jsonObject }
    val policy: Policy by lazy { policyFrom(policyJson) }
    val reasonCodesJson: String by lazy { file("fairclaim.reasonCodes").readText() }

    fun vectors(name: String): JsonArray = Json.parseToJsonElement(File(file("fairclaim.vectors"), name).readText()).jsonArray

    fun policyFor(v: JsonObject): Policy {
        val patch = v["policyPatch"]?.jsonObject ?: JsonObject(emptyMap())
        return policyFrom(JsonObject(policyJson + patch))
    }
}
