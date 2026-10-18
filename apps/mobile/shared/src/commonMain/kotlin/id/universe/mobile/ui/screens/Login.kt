package id.universe.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.ui.LocalAppInfo
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Field
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.theme.Theme
import kotlinx.coroutines.launch

/**
 * NIK and password, nothing else. What the API refuses with (wrong password,
 * first login off site, too many attempts) is shown in its own words.
 */
@Composable
fun LoginScreen(notice: String?, onLogin: suspend (nik: String, password: String) -> String?) {
    var nik by rememberSaveable { mutableStateOf("") }
    /* Not saveable: a password does not go into the saved-state bundle. */
    var password by remember { mutableStateOf("") }
    /* Not saveable: a recreated screen has no request in flight to wait for. */
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ready = nik.isNotBlank() && password.isNotEmpty() && !busy
    val submit: () -> Unit = {
        if (ready) {
            busy = true
            error = null
            scope.launch {
                error = onLogin(nik, password)
                busy = false
            }
        }
    }
    PlainPage {
        Column(Modifier.imePadding(), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Txt("UNIVERSE", Theme.type.brand.copy(fontSize = 30.sp, letterSpacing = 0.06.em))
                Txt(
                    "Unit, jadwal, dan status FTW kamu sebelum berangkat.",
                    Theme.type.body.copy(fontSize = 15.sp),
                    color = Theme.palette.inkMuted,
                )
            }
            notice?.let { Callout(Callout(it, Tone.WARN)) }
            Field("NIK", nik, { nik = it.filter(Char::isDigit) }, keyboard = KeyboardType.Number, tabular = true)
            Field(
                "Password",
                password,
                { password = it },
                keyboard = KeyboardType.Password,
                secret = true,
                imeAction = ImeAction.Go,
                onDone = submit,
            )
            ActionButton(if (busy) "Memeriksa…" else "Masuk", submit, enabled = ready)
            error?.let {
                Callout(Callout(it, Tone.BAD), Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
            }
            Callout(Callout("Login pertama, atau setelah password direset admin, harus dari jaringan site.", Tone.INFO))
            Note(LocalAppInfo.current.label, Modifier.fillMaxWidth(), align = TextAlign.Center)
        }
    }
}
