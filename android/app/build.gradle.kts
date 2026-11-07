import org.jetbrains.kotlin.gradle.dsl.JvmTarget
plugins { id("com.android.application"); id("org.jetbrains.kotlin.plugin.compose") }
val prepareForge = tasks.register<Exec>("prepareForge") {
    workingDir(rootProject.projectDir)
    commandLine("python3", "tools/prepare_engine.py")
    inputs.dir(rootProject.file("engine/src")); inputs.file(rootProject.file("engine/release.json")); inputs.file(rootProject.file("engine/patches.json")); inputs.file(rootProject.file("tools/prepare_engine.py"))
    outputs.file(rootProject.file("engine/build/forge-engine.jar")); outputs.file(file("src/main/assets/forge-data.zip"))
}
android {
    namespace = "com.acocalypso.magictester"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.acocalypso.magictester"; minSdk = 26; targetSdk = 36
        versionCode = providers.gradleProperty("versionCode").orElse("1").get().toInt()
        versionName = providers.gradleProperty("versionName").orElse("0.1.0").get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "FORGE_VERSION", "\"2.0.15\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17; isCoreLibraryDesugaringEnabled = true }
    buildTypes { release { isMinifyEnabled = false } }
    androidResources { noCompress += "zip" }
    packaging { resources { excludes += setOf("META-INF/INDEX.LIST", "META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/versions/**"); merges += setOf("META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/DEPENDENCIES") } }
    testOptions { animationsDisabled = true; unitTests.isReturnDefaultValues = true }
}
kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
tasks.named("preBuild") { dependsOn(prepareForge) }
dependencies {
    implementation(files(rootProject.file("engine/build/forge-engine.jar")).builtBy(prepareForge))
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
}
// Forge already contains the Android Guava implementation, including this API.
configurations.configureEach { exclude(group = "com.google.guava", module = "listenablefuture") }
