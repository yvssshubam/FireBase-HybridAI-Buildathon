plugins {
    // All plugins on one classloader. AGP 9's built-in Kotlin uses the KGP on this classpath (2.4.20),
    // which is newer than the KGP AGP 9.2 depends on (2.3.10), as the built-in-Kotlin guide allows.
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.google.services) apply false
}
