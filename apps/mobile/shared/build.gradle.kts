import groovy.json.JsonSlurper
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.openapi.generator)
}

/*
 * The API client is generated from the API's own OpenAPI document (docs/prd.md,
 * Mobile app → Client stack), committed beside this project by
 * `bun run openapi:mobile` in apps/api. Nothing here reaches a running API.
 */
val openApiSpec = rootProject.layout.projectDirectory.file("openapi.json")
val generatedApi = layout.buildDirectory.dir("generated/openapi")

/** `not-allocated` → `NOT_ALLOCATED`, not the generator's `NOT_MINUS_ALLOCATED`. */
fun hyphenatedEnumNames(spec: File): Map<String, String> {
    val names = sortedMapOf<String, String>()
    fun walk(node: Any?) {
        when (node) {
            is Map<*, *> -> {
                (node["enum"] as? List<*>)?.filterIsInstance<String>()
                    ?.filter { '-' in it }
                    ?.forEach { names[it] = it.uppercase().replace('-', '_') }
                node.values.forEach(::walk)
            }
            is List<*> -> node.forEach(::walk)
        }
    }
    walk(JsonSlurper().parse(spec))
    return names
}

val generateApi by tasks.registering(GenerateTask::class) {
    generatorName.set("kotlin")
    library.set("multiplatform")
    inputSpec.set(openApiSpec.asFile.path)
    outputDir.set(generatedApi.get().asFile.path)
    packageName.set("id.universe.mobile.api")
    configOptions.set(
        mapOf(
            "dateLibrary" to "string",
            "enumPropertyNaming" to "UPPERCASE",
        ),
    )
    enumNameMappings.set(hyphenatedEnumNames(openApiSpec.asFile))
    /* A notice's `params` is a free-form record; `Any` has no serializer. */
    typeMappings.set(mapOf("AnyType" to "JsonElement"))
    importMappings.set(mapOf("JsonElement" to "kotlinx.serialization.json.JsonElement"))
    cleanupOutput.set(true)
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
}

kotlin {
    androidLibrary {
        namespace = "id.universe.mobile.shared"
        compileSdk = 37
        minSdk = 26
        androidResources { enable = true }
        withHostTestBuilder {}
    }

    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain {
            kotlin.srcDir(
                files(generatedApi.map { it.dir("src/commonMain/kotlin") })
                    .builtBy(generateApi),
            )
            dependencies {
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.ui)
                implementation(compose.components.resources)
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.content.negotiation)
                implementation(libs.ktor.serialization.kotlinx.json)
                implementation(libs.androidx.datastore.preferences)
                implementation(libs.jetbrains.lifecycle.runtime.compose)
                implementation(libs.jetbrains.navigation.compose)
                implementation(libs.qrose)
            }
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        androidMain.dependencies {
            implementation(libs.kotlinx.coroutines.android)
            implementation(libs.ktor.client.okhttp)
            /* Scan ID: the camera and an on-device QR reader, so a gate with no
               signal still reads a card. */
            implementation(libs.androidx.activity.compose)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.view)
            implementation(libs.androidx.camera.mlkit.vision)
            implementation(libs.mlkit.barcode.scanning)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
    }
}

compose.resources {
    packageOfResClass = "id.universe.mobile.resources"
}
