package id.universe.mobile.ui.screens

import androidx.compose.runtime.Composable
import id.universe.mobile.app.AppState
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.HomeKind
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.initialsOf
import id.universe.mobile.ui.components.Avatar
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme

/**
 * The Pengawas Lapangan and Superadmin home until their screens ship (stage
 * 3, S5 and S6): who is signed in, what is coming, and the way to the
 * profile, which their bottom bar may not carry.
 */
@Composable
fun StaffHome(signedIn: AppState.SignedIn, onProfile: () -> Unit) {
    val principal = signedIn.principal
    val screens = if (signedIn.access.home == HomeKind.ADMIN) {
        "papan dengan pengisian manual, akun, dan monitor timeline"
    } else {
        "papan ACTUAL, status unit, dan scan ID"
    }
    InnerScreen("Beranda", onBack = null) {
        ListGroup {
            ListRow(
                principal.name,
                titleStyle = Theme.type.name,
                notes = listOfNotNull(principal.nik?.let { "NIK $it" }, principal.roleName),
                leading = { Avatar(initialsOf(principal.name), onHero = false) },
            )
        }
        Callout(
            Callout(
                "Layar untuk peran ini ($screens) menyusul di versi berikutnya. Sampai saat itu, pakai console web.",
                Tone.INFO,
            ),
        )
        ListGroup { ListRow("Profil & akun", glyph = Glyph.USER, onClick = onProfile) }
    }
}
