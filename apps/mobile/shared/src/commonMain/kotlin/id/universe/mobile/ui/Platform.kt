package id.universe.mobile.ui

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** What only the platform can do, handed in by the Android (later iOS) shell. */
interface PlatformHooks {
    /** Full brightness while the ID card is shown, for the scanner at the gate. */
    fun keepScreenBright(on: Boolean)

    /** Light status-bar icons over the navy band or a dark ground; dark ones over a light ground. */
    fun statusBarOnDark(onDark: Boolean)
}

private object NoPlatform : PlatformHooks {
    override fun keepScreenBright(on: Boolean) = Unit

    override fun statusBarOnDark(onDark: Boolean) = Unit
}

/** This build, as `/v1/mobile/version` compares it. */
data class AppInfo(val versionName: String, val build: Int) {
    val label: String get() = "Versi $versionName · build $build"
}

val LocalPlatform = staticCompositionLocalOf<PlatformHooks> { NoPlatform }

val LocalAppInfo = staticCompositionLocalOf { AppInfo("?", 0) }

/** Room a screen leaves at its foot for the bottom bar; none where there is no bar. */
val LocalNavReserve = compositionLocalOf<Dp> { 0.dp }

/** Shows a short sentence above the bar for 2.6 seconds. */
val LocalToast = staticCompositionLocalOf<(String) -> Unit> { {} }
