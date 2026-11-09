package id.universe.mobile.ui.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.universe.mobile.api.models.PatchV1UsersByIdRequest
import id.universe.mobile.data.Account
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.data.failureWords
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.accountBadge
import id.universe.mobile.domain.accountNote
import id.universe.mobile.domain.accountsMatching
import id.universe.mobile.domain.initialsOf
import id.universe.mobile.ui.LocalToast
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.BottomSheet
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Failure
import id.universe.mobile.ui.components.InnerList
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.block
import id.universe.mobile.ui.components.groupRows
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import kotlinx.coroutines.launch

/**
 * "Akun": find an account, reset its password or deactivate it (docs/prd.md,
 * Mobile app → Superadmin). Everything else about an account stays on the web.
 */
@Composable
fun AkunScreen(api: UniverseApi, selfId: String, onBack: () -> Unit) {
    val accounts = rememberLoad("accounts") { api.call { users.getV1Users() } }
    var query by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf<Account?>(null) }
    val load = accounts.value
    val all = (load as? Load.Ready)?.value
    /* Every account that ever signed in: a lazy list. */
    val shown = remember(all, query) { all?.let { accountsMatching(it, query) }.orEmpty() }
    InnerList("Akun", onBack) {
        block("search") { SearchField(query, { query = it }, "Cari nama atau NIK") }
        when {
            load is Load.Failed -> block("failed") { Failure(load.words, accounts.reload) }
            all == null -> block("loading") { Note("Memuat…") }
            shown.isEmpty() -> block("none") { Note("Tidak ada akun yang cocok.") }
            else -> groupRows(shown, key = { it.id }) { account ->
                ListRow(
                    account.name,
                    notes = listOf(accountNote(account)),
                    leading = { Initials(account.name) },
                    onClick = { picked = account },
                ) { accountBadge(account)?.let { Badge(it) } }
            }
        }
    }
    picked?.let { account ->
        AccountSheet(api, account, own = account.id == selfId, onChanged = accounts.reload, onDismiss = { picked = null })
    }
}

@Composable
private fun Initials(name: String) {
    val palette = Theme.palette
    Box(Modifier.size(42.dp).background(palette.actionSoft, Corners.pill), contentAlignment = Alignment.Center) {
        Txt(initialsOf(name), Theme.type.bodyStrong.copy(fontSize = 15.sp), color = palette.action)
    }
}

@Composable
private fun AccountSheet(api: UniverseApi, account: Account, own: Boolean, onChanged: () -> Unit, onDismiss: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    /* Reset opens the account to whoever knows the issued password: a second tap. */
    var confirmReset by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val toast = LocalToast.current
    fun act(done: String, request: suspend UniverseApi.() -> Outcome<*>) {
        busy = true
        error = null
        scope.launch {
            val answer = api.request()
            if (answer is Outcome.Ok) {
                toast(done)
                onChanged()
                onDismiss()
            } else {
                busy = false
                error = answer.failureWords()
            }
        }
    }
    BottomSheet(account.name, onDismiss, dismissible = !busy) {
        Note(accountNote(account))
        if (own) {
            Note("Ini akun kamu sendiri. Ganti password dari Profil; akun ini tidak bisa direset atau dinonaktifkan dari sini.")
            return@BottomSheet
        }
        ActionButton(
            if (confirmReset) "Ya, reset password ${account.name}" else "Reset password",
            {
                if (!confirmReset) {
                    confirmReset = true
                } else {
                    act("Password ${account.name} direset. Login berikutnya harus dari jaringan site.") {
                        call { users.postV1UsersByIdResetPassword(account.id) }
                    }
                }
            },
            kind = if (confirmReset) ButtonKind.DANGER else ButtonKind.GHOST,
            enabled = !busy,
        )
        Note("Password kembali ke password awal. Login berikutnya harus dari jaringan site.")
        if (account.active) {
            ActionButton(
                "Nonaktifkan akun",
                {
                    act("Akun ${account.name} dinonaktifkan") {
                        call { users.patchV1UsersById(account.id, PatchV1UsersByIdRequest(active = false)) }
                    }
                },
                kind = ButtonKind.DANGER,
                enabled = !busy,
            )
        } else {
            Note("Akun ini sudah nonaktif. Mengaktifkannya lagi dari console web.")
        }
        error?.let { Callout(Callout(it, Tone.BAD)) }
    }
}
