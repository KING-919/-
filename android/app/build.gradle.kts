plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nova.agent.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.nova.agent.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 22
        versionName = "2.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sign with debug key by default when no custom release keystore env is provided
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
