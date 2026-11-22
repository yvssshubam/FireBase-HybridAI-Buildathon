import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

// The shared vectors live in the TS workspace; both engines read the same files.
val vectorsDir = rootDir.resolve("../../packages/schemas/test-vectors")
val policyFile = rootDir.resolve("../../packages/schemas/policy/policy.v1.json")

tasks.test {
    inputs.dir(vectorsDir)
    inputs.file(policyFile)
    systemProperty("fairclaim.vectors", vectorsDir.absolutePath)
    systemProperty("fairclaim.policy", policyFile.absolutePath)
}
