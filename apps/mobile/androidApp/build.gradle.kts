plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

/*
 * The installation's own origin (`PUBLIC_ORIGIN`), set when the APK is built
 * for it: `./gradlew :androidApp:assembleRelease -Puniverse.apiOrigin=https://…`.
 * A debug build defaults to the API on the developer's machine, as an
 * emulator sees it.
 */
val apiOrigin = providers.gradleProperty("universe.apiOrigin").getOrElse("http://10.0.2.2:3001")

android {
    namespace = "id.universe.mobile.android"
    /* Compose Multiplatform 1.12 and AndroidX lifecycle 2.11 compile against 37. */
    compileSdk = 37

    defaultConfig {
        applicationId = "id.universe.mobile"
        minSdk = 26
        targetSdk = 36
        /* The build number `/v1/mobile/version` compares against. */
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "API_ORIGIN", "\"$apiOrigin\"")
    }

    buildTypes {
        debug {
            manifestPlaceholders["cleartext"] = "true"
        }
        release {
            /* A release talks to the installation's domain over HTTPS only. */
            manifestPlaceholders["cleartext"] = "false"
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(projects.shared)
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.coroutines.android)
}
