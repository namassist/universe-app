package id.universe.mobile.ui.staff

import androidx.compose.runtime.Composable
import id.universe.mobile.data.Board
import id.universe.mobile.data.UnitStatusRow
import id.universe.mobile.domain.BoardFilter
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.UnitTab
import id.universe.mobile.domain.boardSummary
import id.universe.mobile.domain.countIn
import id.universe.mobile.ui.CariRoute
import id.universe.mobile.ui.PapanRoute
import id.universe.mobile.ui.SoonRoute
import id.universe.mobile.ui.UnitStatusRoute
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.HeroBand
import id.universe.mobile.ui.components.HeroPill
import id.universe.mobile.ui.components.HomeScaffold
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.MenuEntry
import id.universe.mobile.ui.components.MenuGrid
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.QuickLink
import id.universe.mobile.ui.components.Section
import id.universe.mobile.ui.components.StaleNote
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme

/**
 * The Pengawas Lapangan's home: how many units the board has crewed, what is
 * still empty, and the way to each (docs/prd.md, Mobile app → Pengawas
 * Lapangan). Every number is the fleet wall's.
 */
@Composable
fun SupervisorHome(board: LoadHandle<Board>, units: LoadHandle<List<UnitStatusRow>>, go: (Any) -> Unit) {
    val toEmpty = { go(PapanRoute(BoardFilter.EMPTY.name)) }
    val quick = listOf(
        QuickLink("Cari", Glyph.SEARCH) { go(CariRoute) },
        QuickLink("Unit kosong", Glyph.TRUCK, toEmpty),
    )
    val toNotices = { go(SoonRoute("Notifikasi")) }
    val load = board.value
    val summary = (load as? Load.Ready)?.value?.let(::boardSummary)
    val breakdowns = (units.value as? Load.Ready)?.value?.let { countIn(it, UnitTab.BREAKDOWN) }
    HomeScaffold(
        hero = {
            when {
                load is Load.Failed -> HeroBand(
                    chip = "Pengawas", code = "—", codeIsWord = true, line = load.words, tone = Tone.NEUTRAL,
                    link = "Coba lagi", onLink = board.reload, quick = quick, pills = emptyList(),
                    topGlyph = Glyph.BELL, topLabel = "Notifikasi", onTop = toNotices,
                )
                summary == null -> HeroBand(
                    chip = "Pengawas", code = "—", codeIsWord = true, line = "Mengambil papan", tone = Tone.NEUTRAL,
                    link = null, onLink = {}, quick = quick, pills = emptyList(),
                    topGlyph = Glyph.BELL, topLabel = "Notifikasi", onTop = toNotices,
                )
                else -> HeroBand(
                    chip = "Pengawas · ${summary.chip}",
                    code = summary.code,
                    codeIsWord = summary.codeIsWord,
                    line = summary.line,
                    tone = summary.tone,
                    link = "Lihat papan ACTUAL",
                    onLink = { go(PapanRoute()) },
                    quick = quick,
                    pills = listOfNotNull(
                        HeroPill(
                            "${summary.empty.size} unit kosong",
                            if (summary.empty.isEmpty()) Tone.OK else Tone.BAD,
                            toEmpty,
                        ),
                        HeroPill("${summary.fromSpare} dari spare", Tone.WARN) { go(PapanRoute(BoardFilter.SPARE.name)) },
                        breakdowns?.let { HeroPill("$it breakdown", Tone.NEUTRAL) { go(UnitStatusRoute) } },
                    ),
                    topGlyph = Glyph.BELL,
                    topLabel = "Notifikasi",
                    onTop = toNotices,
                )
            }
        },
    ) {
        StaleNote(board)
        MenuGrid(
            listOf(
                MenuEntry("Papan", Glyph.BOARD) { go(PapanRoute()) },
                MenuEntry("Status unit", Glyph.TRUCK) { go(UnitStatusRoute) },
                MenuEntry("Dashboard", Glyph.CHART) { go(SoonRoute("Dashboard")) },
                MenuEntry("Laporan", Glyph.DOC) { go(SoonRoute("Laporan")) },
            ),
        )
        /* Only over a board or a line-up: "empty" before either would be a guess. */
        summary?.takeIf { it.badge != null }?.let { shown ->
            Section("Unit kosong") {
                if (shown.empty.isEmpty()) {
                    Note("Semua unit di papan sudah terisi.")
                } else {
                    ListGroup {
                        shown.empty.forEachIndexed { index, seat ->
                            if (index > 0) Hairline()
                            ListRow(
                                seat.unit,
                                titleStyle = Theme.type.code,
                                notes = listOf(seat.where),
                                onClick = toEmpty,
                            ) { Badge(Pill("Kosong", Tone.BAD)) }
                        }
                    }
                }
            }
        }
    }
}
