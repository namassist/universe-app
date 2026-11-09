package id.universe.mobile.ui.operator

import androidx.compose.runtime.Composable
import id.universe.mobile.data.MyShift
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.VersionVerdict
import id.universe.mobile.domain.busPill
import id.universe.mobile.domain.factsOf
import id.universe.mobile.domain.fingerPill
import id.universe.mobile.domain.ftwPill
import id.universe.mobile.domain.heroOf
import id.universe.mobile.ui.JadwalRoute
import id.universe.mobile.ui.KartuRoute
import id.universe.mobile.ui.NotifRoute
import id.universe.mobile.ui.ProfilRoute
import id.universe.mobile.ui.RiwayatRoute
import id.universe.mobile.ui.SoonRoute
import id.universe.mobile.ui.UnitRoute
import id.universe.mobile.ui.components.Duo
import id.universe.mobile.ui.components.FactCard
import id.universe.mobile.ui.components.HeroBand
import id.universe.mobile.ui.components.HeroPill
import id.universe.mobile.ui.components.HomeScaffold
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.MenuEntry
import id.universe.mobile.ui.components.MenuGrid
import id.universe.mobile.ui.components.QuickLink
import id.universe.mobile.ui.components.Section
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.screens.UpdateNotice

/** Shifts the person works; the others have no morning to plan. */
fun MyShift.isWorked() = status != "off" && status != "not-allocated"

fun MyShift.partOfDay() = if (shift == "night") "Malam ini" else "Pagi ini"

/**
 * The operator's home: the unit code (or SPARE, or the roster code) at
 * display size, worded entirely from /v1/me/shift (docs/prd.md, Mobile app →
 * User).
 */
@Composable
fun OperatorHome(
    shift: LoadHandle<MyShiftAnswer>,
    update: VersionVerdict.UpdateAvailable?,
    onDismissUpdate: () -> Unit,
    go: (Any) -> Unit,
) {
    val toUnit = { go(UnitRoute) }
    val quick = listOf(
        QuickLink("Syarat unit", Glyph.CHECK, toUnit),
        QuickLink("Tiket", Glyph.RECEIPT) { go(SoonRoute("Tiket")) },
    )
    val load = shift.value
    val current = (load as? Load.Ready)?.value?.shift
    HomeScaffold(
        hero = {
            when (load) {
                Load.Loading -> HeroBand(
                    chip = "Memuat…", code = "—", codeIsWord = true, line = "Mengambil status shift",
                    tone = Tone.NEUTRAL, link = null, onLink = {}, quick = quick, pills = emptyList(),
                    topGlyph = Glyph.HELP, topLabel = "Bantuan", onTop = { go(ProfilRoute) },
                )
                is Load.Failed -> HeroBand(
                    chip = "Tidak terhubung", code = "—", codeIsWord = true, line = load.words,
                    tone = Tone.NEUTRAL, link = "Coba lagi", onLink = shift.reload, quick = quick,
                    pills = emptyList(), topGlyph = Glyph.HELP, topLabel = "Bantuan", onTop = { go(ProfilRoute) },
                )
                is Load.Ready -> {
                    val hero = heroOf(current)
                    val pills = current?.let { listOfNotNull(ftwPill(it), fingerPill(it), busPill(it)) }.orEmpty()
                    HeroBand(
                        chip = hero.chip,
                        code = hero.code,
                        codeIsWord = hero.codeIsWord,
                        line = hero.line,
                        tone = hero.tone,
                        link = hero.where ?: "Lihat unit saya",
                        onLink = toUnit,
                        quick = quick,
                        pills = pills.map { HeroPill(it.text, it.tone, toUnit) },
                        topGlyph = Glyph.HELP,
                        topLabel = "Bantuan",
                        onTop = { go(ProfilRoute) },
                    )
                }
            }
        },
    ) {
        update?.let { UpdateNotice(it.downloadUrl, onDismissUpdate) }
        MenuGrid(
            listOf(
                MenuEntry("Unit saya", Glyph.TRUCK, toUnit),
                MenuEntry("Jadwal", Glyph.CALENDAR) { go(JadwalRoute) },
                MenuEntry("Riwayat FTW", Glyph.HEART) { go(RiwayatRoute("ftw")) },
                MenuEntry("Kehadiran", Glyph.FINGER) { go(RiwayatRoute("hadir")) },
                MenuEntry("Riwayat unit", Glyph.RECEIPT) { go(RiwayatRoute("unit")) },
                MenuEntry("Notifikasi", Glyph.BELL) { go(NotifRoute) },
                MenuEntry("SIMPER", Glyph.CARD) { go(KartuRoute) },
                MenuEntry("Bantuan", Glyph.HELP) { go(ProfilRoute) },
            ),
        )
        if (current != null && current.isWorked()) {
            val (first, bus) = factsOf(current)
            Section(current.partOfDay()) {
                Duo({ FactCard(first, it, toUnit) }, { FactCard(bus, it, toUnit) })
            }
        }
    }
}
