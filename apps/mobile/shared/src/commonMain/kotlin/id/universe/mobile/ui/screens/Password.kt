package id.universe.mobile.ui.screens

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
import id.universe.mobile.api.models.PostV1AuthChangePasswordRequest
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.data.failureWords
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.ui.LocalToast
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Field
import id.universe.mobile.ui.components.InnerScreen
import kotlinx.coroutines.launch

/**
 * A new password. [forced] when the account still has the issued one: then
 * there is no way past this screen but changing it, or logging out.
 */
@Composable
fun PasswordScreen(
    forced: Boolean,
    api: UniverseApi,
    onSaved: suspend () -> Unit,
    onBack: (() -> Unit)?,
    onLogout: () -> Unit,
) {
    /* Not saveable: passwords do not go into the saved-state bundle. */
    var current by remember { mutableStateOf("") }
    var fresh by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    /* Not saveable: a recreated screen has no request in flight to wait for. */
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val toast = LocalToast.current
    val ready = current.isNotEmpty() && fresh.isNotEmpty() && again.isNotEmpty() && !busy
    val submit: () -> Unit = submit@{
        if (!ready) return@submit
        if (fresh != again) {
            error = "Konfirmasi password baru tidak sama."
            return@submit
        }
        busy = true
        error = null
        scope.launch {
            /* A wrong current password is a 401 `invalid_credentials`, which keeps the
               session; any other 401 here means it is gone, and the app says so. */
            val answer = api.call {
                auth.postV1AuthChangePassword(PostV1AuthChangePasswordRequest(current, fresh))
            }
            if (answer is Outcome.Ok) {
                toast("Password sudah diganti")
                onSaved()
            } else {
                error = answer.failureWords()
            }
            busy = false
        }
    }
    InnerScreen("Ganti password", if (forced) null else onBack) {
        if (forced) {
            Callout(
                Callout("Akun ini masih memakai password awal. **Ganti dulu** sebelum melanjutkan.", Tone.WARN),
            )
        }
        Field("Password saat ini", current, { current = it }, keyboard = KeyboardType.Password, secret = true)
        Field("Password baru", fresh, { fresh = it }, keyboard = KeyboardType.Password, secret = true)
        Field(
            "Ulangi password baru",
            again,
            { again = it },
            keyboard = KeyboardType.Password,
            secret = true,
            imeAction = ImeAction.Done,
            onDone = submit,
        )
        ActionButton(if (busy) "Menyimpan…" else "Simpan password", submit, enabled = ready)
        error?.let { Callout(Callout(it, Tone.BAD), Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
        if (forced) ActionButton("Keluar", onLogout, kind = ButtonKind.DANGER)
    }
}
