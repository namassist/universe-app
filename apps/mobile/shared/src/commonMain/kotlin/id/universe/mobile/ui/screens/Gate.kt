package id.universe.mobile.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.resources.Res
import id.universe.mobile.resources.logo
import id.universe.mobile.ui.LocalAppInfo
import id.universe.mobile.ui.LocalPlatform
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Dismissable
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.theme.Theme
import org.jetbrains.compose.resources.painterResource

/** A plain page on the ground with the logo at its head: login, the gates. */
@Composable
fun PlainPage(content: @Composable () -> Unit) {
    val palette = Theme.palette
    val platform = LocalPlatform.current
    DisposableEffect(palette.dark) {
        platform.statusBarOnDark(palette.dark)
        onDispose { }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(palette.ground)
            .windowInsetsPadding(WindowInsets.systemBars)
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 64.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        Image(painterResource(Res.drawable.logo), contentDescription = null, modifier = Modifier.size(56.dp))
        content()
    }
}

@Composable
fun Splash() {
    Box(Modifier.fillMaxSize().background(Theme.palette.ground), contentAlignment = Alignment.Center) {
        Image(painterResource(Res.drawable.logo), contentDescription = "Universe", modifier = Modifier.size(56.dp))
    }
}

/** Below the minimum build: nothing but the way to the new one (docs/prd.md, Mobile app → Client stack). */
@Composable
fun BlockedScreen(downloadUrl: String?) {
    val uri = LocalUriHandler.current
    PlainPage {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Txt("Versi ini sudah tidak didukung", Theme.type.headline, Modifier.semantics { heading() })
            Note("Pasang versi terbaru untuk melanjutkan. Akun dan data kamu tetap tersimpan di server.")
        }
        if (downloadUrl != null) {
            ActionButton("Unduh versi baru", { uri.openUri(downloadUrl) })
        } else {
            Callout(Callout("Tautan unduhan belum diatur. Minta versi terbaru ke admin departemen.", Tone.INFO))
        }
        Note(LocalAppInfo.current.label, Modifier.fillMaxWidth(), align = TextAlign.Center)
    }
}

/** A saved session that could not be checked: try again rather than log in again. */
@Composable
fun UnreachableScreen(onRetry: () -> Unit) {
    PlainPage {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Txt("Server belum bisa dihubungi", Theme.type.headline, Modifier.semantics { heading() })
            Note("Periksa sinyal atau Wi-Fi, lalu coba lagi. Kamu tidak perlu login ulang.")
        }
        ActionButton("Coba lagi", onRetry)
    }
}

/** Above the minimum, below the latest: a notice that can be put away. */
@Composable
fun UpdateNotice(downloadUrl: String?, onDismiss: () -> Unit) {
    val uri = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Dismissable(
            content = {
                Callout(Callout("**Versi baru tersedia.** Pasang supaya aplikasi tetap sesuai dengan server.", Tone.INFO))
            },
            onDismiss = onDismiss,
        )
        if (downloadUrl != null) ActionButton("Unduh versi baru", { uri.openUri(downloadUrl) }, kind = ButtonKind.GHOST)
    }
}
