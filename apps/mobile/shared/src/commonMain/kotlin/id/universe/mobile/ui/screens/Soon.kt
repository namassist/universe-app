package id.universe.mobile.ui.screens

import androidx.compose.runtime.Composable
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.InnerScreen

/**
 * Every tap goes somewhere (DESIGN.md, Don't leave a dead tap). [pending] is a
 * screen designed but not in this build yet; otherwise it is not designed.
 */
@Composable
fun SoonScreen(title: String, pending: Boolean, onBack: () -> Unit, onHome: () -> Unit) {
    InnerScreen(title, onBack) {
        Callout(
            Callout(
                if (pending) {
                    "**$title** belum ada di versi aplikasi ini. Sampai saat itu, buka dari console web."
                } else {
                    "Layar ini belum dirancang. Isinya menyusul setelah arah desainnya disetujui."
                },
                Tone.INFO,
            ),
        )
        ActionButton("Kembali ke beranda", onHome, kind = ButtonKind.GHOST)
    }
}
