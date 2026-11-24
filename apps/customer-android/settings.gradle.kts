pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "fairclaim-customer"

// Pure-JVM modules (unit-testable without an emulator) + the Compose customer app (Phase 2).
// Configuring :app needs an Android SDK (local.properties sdk.dir or ANDROID_HOME), also for :engine:test.
include(":engine", ":fft", ":app")
