import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    // @Generable model-output classes are @Serializable (Firebase AI Logic structured output).
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// google-services.json is never committed (README → "Android app"). Without it the build still works
// (unit tests, CI); the app then shows a setup error at start instead of crashing.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
} else {
    logger.warn("FairClaim: app/google-services.json not found, building without Firebase config.")
}

// Release signing comes from local.properties or environment variables, never from the repo.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun secret(prop: String, env: String): String? =
    (localProps.getProperty(prop) ?: System.getenv(env))?.takeIf { it.isNotBlank() }

val keystorePath = secret("fairclaim.keystore", "FAIRCLAIM_KEYSTORE")
val keystorePassword = secret("fairclaim.keystorePassword", "FAIRCLAIM_KEYSTORE_PASSWORD")
val keyAliasName = secret("fairclaim.keyAlias", "FAIRCLAIM_KEY_ALIAS")
val keyPasswordValue = secret("fairclaim.keyPassword", "FAIRCLAIM_KEY_PASSWORD")
val canSign = listOf(keystorePath, keystorePassword, keyAliasName, keyPasswordValue).all { it != null }

// Where /terms and /privacy live (the Vercel deployment). Placeholder until Phase 3 deploys it.
val webBaseUrl = (localProps.getProperty("fairclaim.webBaseUrl") ?: System.getenv("FAIRCLAIM_WEB_BASE_URL"))
    ?.trim()?.trimEnd('/')?.takeIf { it.startsWith("https://") }
    ?: "https://fairclaim-placeholder.invalid"

android {
    namespace = "com.fairclaim.customer"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.fairclaim.customer"
        minSdk = 26 // firebase-ai-ondevice
        targetSdk = 36
        versionCode = 1
        versionName = "0.2.0"
        buildConfigField("String", "WEB_BASE_URL", "\"$webBaseUrl\"")
    }

    signingConfigs {
        if (canSign) {
            create("release") {
                storeFile = file(requireNotNull(keystorePath))
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (canSign) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin")
    }
}

// TODO(verify): with AGP 9 built-in Kotlin, jvmTarget may already follow compileOptions; setting it explicitly is harmless.
tasks.withType<KotlinJvmCompile>().configureEach {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// The bundled policy and reason texts come from the single source in packages/schemas (no copies in git).
abstract class CopyFairClaimAssets : DefaultTask() {
    @get:InputFiles
    abstract val sources: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        sources.files.forEach { it.copyTo(File(out, it.name), overwrite = true) }
    }
}

val schemasDir = rootDir.resolve("../../packages/schemas")
val policyFile = schemasDir.resolve("policy/policy.v1.json")
val reasonCodesFile = schemasDir.resolve("reason-codes.json")

val copyFairClaimAssets = tasks.register<CopyFairClaimAssets>("copyFairClaimAssets") {
    sources.from(policyFile, reasonCodesFile)
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyFairClaimAssets, CopyFairClaimAssets::outputDir)
    }
}

tasks.withType<Test>().configureEach {
    val vectorsDir = schemasDir.resolve("test-vectors")
    inputs.file(policyFile)
    inputs.file(reasonCodesFile)
    inputs.dir(vectorsDir)
    systemProperty("fairclaim.policy", policyFile.absolutePath)
    systemProperty("fairclaim.reasonCodes", reasonCodesFile.absolutePath)
    systemProperty("fairclaim.vectors", vectorsDir.absolutePath)
}

dependencies {
    implementation(project(":engine"))
    implementation(project(":fft"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.androidx.browser)

    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.zxing.core)

    implementation(libs.coroutines.android)
    implementation(libs.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.storage)
    implementation(libs.firebase.config)
    implementation(libs.firebase.appcheck)
    implementation(libs.firebase.ai)
    implementation(libs.firebase.ai.ondevice)
    ksp(libs.firebase.ai.ksp)
    // App Check providers: the debug provider exists only in debug builds (src/debug), Play Integrity only in release.
    debugImplementation(libs.firebase.appcheck.debug)
    releaseImplementation(libs.firebase.appcheck.playintegrity)

    testImplementation(libs.junit)
}
