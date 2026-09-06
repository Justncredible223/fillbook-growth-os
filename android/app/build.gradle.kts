import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

/**
 * Release signing: the keystore and its passwords are owner-controlled and
 * NEVER live in this repo. Two ways to supply them, checked in this order:
 *
 * 1. `android/keystore.properties` (gitignored, see .gitignore) -- a local
 *    file with `storeFile`/`storePassword`/`keyAlias`/`keyPassword` keys.
 *    Simplest for a developer machine building releases by hand.
 * 2. Environment variables `GROWTH_OS_KEYSTORE_PATH` /
 *    `GROWTH_OS_KEYSTORE_PASSWORD` / `GROWTH_OS_KEY_ALIAS` /
 *    `GROWTH_OS_KEY_PASSWORD` -- for CI or any environment where dropping a
 *    properties file isn't convenient.
 *
 * If neither source provides all four values, the `release` signingConfig
 * below is left incomplete on purpose. That is NOT a silent no-op: AGP's own
 * `validateSigningRelease` task refuses to assemble/bundle a release build
 * with an incomplete signing config and fails with a clear error naming the
 * missing field -- there is deliberately no fallback that would let an
 * unsigned or debug-signed APK pass as "release" output. `assembleDebug` is
 * completely unaffected either way; the debug build type keeps using AGP's
 * own auto-managed debug keystore, which never touches any of this.
 */
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}

fun signingValue(propertyKey: String, envVarName: String): String? =
    keystoreProperties.getProperty(propertyKey) ?: System.getenv(envVarName)

val releaseStoreFilePath = signingValue("storeFile", "GROWTH_OS_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "GROWTH_OS_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "GROWTH_OS_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "GROWTH_OS_KEY_PASSWORD")

android {
    namespace = "com.fillbook.growthos"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.fillbook.growthos"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "0.2.1"
    }

    signingConfigs {
        create("release") {
            // Deliberately assigned even when values are null/missing --
            // see the kdoc above for why an incomplete config here is the
            // point, not a bug.
            releaseStoreFilePath?.let { storeFile = file(it) }
            releaseStorePassword?.let { storePassword = it }
            releaseKeyAlias?.let { keyAlias = it }
            releaseKeyPassword?.let { keyPassword = it }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")

    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.biometric:biometric:1.1.0")
    // Forces a modern androidx.fragment resolution (transitively pulled in
    // at 1.2.5 by biometric:1.1.0/activity-compose otherwise) -- 1.2.5
    // predates the 1.3.6 fix that made FragmentActivity's own permission-
    // request-code validation tolerate the larger codes the Activity Result
    // API's rememberLauncherForActivityResult generates. Without this,
    // FragmentActivity.validateRequestPermissionsRequestCode throws
    // "Can only use lower 16 bits for requestCode" the first time any
    // ActivityResultContracts.RequestPermission() launcher is used on this
    // FragmentActivity (required here for BiometricPrompt) -- confirmed via
    // a real on-device crash log, not a hypothetical.
    implementation("androidx.fragment:fragment-ktx:1.8.5")

    val firebaseBom = platform("com.google.firebase:firebase-bom:34.17.0")
    implementation(firebaseBom)
    implementation("com.google.firebase:firebase-messaging")
    // Gives Task<T>.await() -- used once, to register this device's FCM
    // token from a plain suspend function (MainActivity's startup
    // registration) instead of a callback listener.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // Plain JVM unit tests (app/src/test) for the pure-Kotlin logic the
    // screens render from -- platform wording, filter reconciliation,
    // experiment list merging. No emulator or instrumentation needed:
    // `./gradlew :app:testDebugUnitTest`.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
