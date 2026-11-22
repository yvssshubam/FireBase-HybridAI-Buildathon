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

// Pure-JVM modules (unit-testable without an emulator). The Compose `app`
// module is added in Phase 2.
include(":engine", ":fft")
