package id.universe.mobile.ui.operator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import id.universe.mobile.app.AppState
import id.universe.mobile.data.Employee
import id.universe.mobile.domain.VersionVerdict
import id.universe.mobile.domain.initialsOf
import id.universe.mobile.domain.readinessOf
import id.universe.mobile.domain.shiftWord
import id.universe.mobile.ui.KartuRoute
import id.universe.mobile.ui.LocalAppInfo
import id.universe.mobile.ui.LocalToast
import id.universe.mobile.ui.PasswordRoute
import id.universe.mobile.ui.UnitRoute
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Avatar
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Card
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Progress
import id.universe.mobile.ui.components.Strip
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.bolded
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme

/**
 * Who is signed in, today's readiness for an operator, the account's own
 * settings, and Keluar. [employee] and [shift] are null for an account that
 * is not an operator's.
 */
@Composable
fun ProfilScreen(
    signedIn: AppState.SignedIn,
    employee: LoadHandle<Employee>?,
    shift: LoadHandle<MyShiftAnswer>?,
    version: VersionVerdict,
    onBack: (() -> Unit)?,
    go: (Any) -> Unit,
    onLogout: () -> Unit,
) {
    val principal = signedIn.principal
    val person = (employee?.value as? Load.Ready)?.value
    val operator = employee != null
    val toast = LocalToast.current
    val uri = LocalUriHandler.current
    val info = LocalAppInfo.current
    InnerScreen("Profil & akun", onBack) {
        ListGroup {
            val name = person?.name ?: principal.name
            ListRow(
                name,
                Modifier.heightIn(min = 88.dp),
                titleStyle = Theme.type.name,
                notes = listOfNotNull(
                    principal.nik?.let { "NIK $it" },
                    person?.let { "${it.departmentName} · ${it.positionName}" } ?: principal.roleName,
                ),
                leading = { Avatar(initialsOf(name), onHero = false) },
            )
            person?.let(::simperLine)?.let { Strip(it, { go(KartuRoute) }) }
        }
        val current = (shift?.value as? Load.Ready)?.value?.shift
        readinessOf(current)?.let { readiness ->
            Card {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt("Kesiapan hari ini", Theme.type.emphasis)
                    current?.let { Note("Shift ${shiftWord(it.shift)}") }
                }
                Txt(bolded("**${readiness.met} dari ${readiness.of}** syarat terpenuhi"), Theme.type.callout)
                Progress(readiness.met.toFloat() / readiness.of)
                Note(readiness.note)
                ActionButton(
                    "Lihat syarat masuk unit",
                    { go(UnitRoute) },
                    kind = ButtonKind.GHOST,
                    trailing = Glyph.ARROW,
                )
            }
        }
        ListGroup {
            ListRow(
                "Ganti password",
                notes = listOf("Ubah password akun kamu"),
                glyph = Glyph.LOCK,
                onClick = { go(PasswordRoute) },
            )
            Hairline()
            ListRow(
                "Notifikasi HP",
                notes = listOf("Belum aktif di versi ini · buka menu Notifikasi"),
                glyph = Glyph.BELL,
                onClick = { toast("Notifikasi HP menyusul. Untuk sekarang, kabar unit ada di menu Notifikasi.") },
            )
            if (operator) {
                Hairline()
                ListRow(
                    "Bantuan",
                    notes = listOf("Hubungi admin departemen"),
                    glyph = Glyph.HELP,
                    onClick = { toast("Untuk akun dan data, hubungi admin departemen kamu.") },
                )
            }
            Hairline()
            val update = version as? VersionVerdict.UpdateAvailable
            ListRow(
                "Versi aplikasi",
                notes = listOf("${info.versionName} · build ${info.build} · " + if (update != null) "versi baru tersedia" else "terbaru"),
                glyph = Glyph.INFO,
                onClick = {
                    val url = update?.downloadUrl
                    if (url != null) uri.openUri(url) else toast("Ini versi terbaru.")
                },
            )
        }
        ActionButton("Keluar", onLogout, kind = ButtonKind.DANGER)
    }
}
