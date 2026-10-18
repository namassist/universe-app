package id.universe.mobile.ui.operator

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.Employee
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.dayMonthYear
import id.universe.mobile.domain.initialsOf
import id.universe.mobile.ui.LocalPlatform
import id.universe.mobile.ui.ProfilRoute
import id.universe.mobile.ui.components.Avatar
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Strip
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift
import io.github.alexzhirkevich.qrose.rememberQrCodePainter

/** "SIMPER berlaku s.d. 12 Mar 2027", or null when the register has no expiry. */
fun simperLine(employee: Employee): String? =
    employee.simperExp?.takeIf { it.length >= 10 }?.let { "SIMPER berlaku s.d. ${dayMonthYear(it.take(10))}" }

/**
 * The ID card on the phone: the QR holds the NIK, drawn by the app, which the
 * gate's scanner reads as it reads a printed card (`nikOfScan`). The screen
 * goes to full brightness while it is open.
 */
@Composable
fun KartuScreen(employee: LoadHandle<Employee>, onBack: () -> Unit, go: (Any) -> Unit) {
    val platform = LocalPlatform.current
    DisposableEffect(Unit) {
        platform.keepScreenBright(true)
        onDispose { platform.keepScreenBright(false) }
    }
    val palette = Theme.palette
    val type = Theme.type
    InnerScreen("Kartu ID saya", onBack) {
        Loaded(employee) { person ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .lift(Corners.idCard, palette)
                    .background(palette.surface, Corners.idCard)
                    .clip(Corners.idCard),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(palette.hero, palette.heroLow)))
                        .padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(initialsOf(person.name), onHero = true)
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Txt(person.name, type.sheetTitle.copy(fontWeight = type.bodyStrong.fontWeight), color = palette.heroText)
                        Txt("NIK ${person.nik}", type.bodyStrong.copy(fontFeatureSettings = "tnum"), color = palette.heroTextMuted)
                        Txt("${person.departmentName} · ${person.positionName}", type.chip, color = palette.heroTextMuted)
                    }
                }
                Box(
                    Modifier
                        .align(Alignment.CenterHorizontally)
                        .padding(top = 22.dp, bottom = 10.dp)
                        .size(216.dp)
                        .background(Color.White, Corners.card)
                        .padding(14.dp),
                ) {
                    Image(
                        rememberQrCodePainter(person.nik) {},
                        contentDescription = "Kode QR berisi NIK ${person.nik}",
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Note(
                    "Tunjukkan ke petugas di gerbang. Layar otomatis paling terang saat halaman ini dibuka.",
                    Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, bottom = 16.dp),
                    align = TextAlign.Center,
                )
                if (person.skills.isNotEmpty()) {
                    Hairline()
                    FlowRow(
                        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) { person.skills.forEach { Badge(Pill(it.name, Tone.INFO)) } }
                }
            }
            simperLine(person)?.let { Strip(it, { go(ProfilRoute) }, Modifier.clip(Corners.callout)) }
        }
    }
}
