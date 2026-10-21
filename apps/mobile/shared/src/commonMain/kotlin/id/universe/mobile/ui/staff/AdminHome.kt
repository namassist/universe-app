package id.universe.mobile.ui.staff

import androidx.compose.runtime.Composable
import id.universe.mobile.data.Board
import id.universe.mobile.data.MusterRuns
import id.universe.mobile.domain.Access
import id.universe.mobile.domain.BoardFilter
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.boardSummary
import id.universe.mobile.domain.musterView
import id.universe.mobile.ui.AkunRoute
import id.universe.mobile.ui.DashboardRoute
import id.universe.mobile.ui.LaporanRoute
import id.universe.mobile.ui.PapanRoute
import id.universe.mobile.ui.ProfilRoute
import id.universe.mobile.ui.SoonRoute
import id.universe.mobile.ui.TimelineRoute
import id.universe.mobile.ui.UnitStatusRoute
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

/**
 * The Superadmin's home: the next stage of the muster at display size, the
 * scheduler's heartbeat, and what needs a hand now. The top button is the
 * profile, since the Superadmin's bar has no Profil (logout lives there).
 */
@Composable
fun AdminHome(board: LoadHandle<Board>, runs: LoadHandle<MusterRuns>, access: Access, go: (Any) -> Unit) {
    val toEmpty = { go(PapanRoute(BoardFilter.EMPTY.name)) }
    val quick = listOf(
        QuickLink("Papan", Glyph.BOARD) { go(PapanRoute()) },
        QuickLink("Akun", Glyph.PEOPLE) { go(AkunRoute) },
    )
    val toProfile = { go(ProfilRoute) }
    val summary = (board.value as? Load.Ready)?.value?.let(::boardSummary)
    val load = runs.value
    val view = (load as? Load.Ready)?.value?.let { musterView(it, nowMs()) }
    HomeScaffold(
        hero = {
            when {
                load is Load.Failed -> HeroBand(
                    chip = "Superadmin", code = "—", codeIsWord = true, line = load.words, tone = Tone.NEUTRAL,
                    link = "Coba lagi", onLink = runs.reload, quick = quick, pills = emptyList(),
                    topGlyph = Glyph.USER, topLabel = "Profil", onTop = toProfile,
                )
                view == null -> HeroBand(
                    chip = "Superadmin", code = "—", codeIsWord = true, line = "Mengambil timeline", tone = Tone.NEUTRAL,
                    link = null, onLink = {}, quick = quick, pills = emptyList(),
                    topGlyph = Glyph.USER, topLabel = "Profil", onTop = toProfile,
                )
                else -> HeroBand(
                    chip = "Superadmin" + (summary?.chip?.let { " · $it" } ?: ""),
                    code = view.nextTime,
                    codeIsWord = view.nextTime == "—",
                    line = view.line,
                    tone = view.tone,
                    link = "Lihat timeline",
                    onLink = { go(TimelineRoute) },
                    quick = quick,
                    pills = listOfNotNull(
                        summary?.takeIf { it.badge != null }?.let { HeroPill("${it.code} terisi", Tone.OK) { go(PapanRoute()) } },
                        summary?.takeIf { it.badge != null }?.let {
                            HeroPill("${it.empty.size} unit kosong", if (it.empty.isEmpty()) Tone.OK else Tone.BAD, toEmpty)
                        },
                        HeroPill(view.heartbeat.text, view.heartbeat.tone) { go(TimelineRoute) },
                    ),
                    topGlyph = Glyph.USER,
                    topLabel = "Profil",
                    onTop = toProfile,
                )
            }
        },
    ) {
        StaleNote(board)
        MenuGrid(
            listOfNotNull(
                MenuEntry("Papan", Glyph.BOARD) { go(PapanRoute()) },
                MenuEntry("PLAN", Glyph.PLAN) { go(SoonRoute("PLAN")) },
                MenuEntry("Timeline", Glyph.TIMELINE) { go(TimelineRoute) },
                MenuEntry("Akun", Glyph.PEOPLE) { go(AkunRoute) },
                MenuEntry("Status unit", Glyph.TRUCK) { go(UnitStatusRoute) },
                MenuEntry("Laporan", Glyph.DOC) { go(LaporanRoute()) }.takeIf { access.reports },
                MenuEntry("Dashboard", Glyph.CHART) { go(DashboardRoute) }.takeIf { access.dashboard },
                MenuEntry("Notifikasi", Glyph.BELL) { go(SoonRoute("Notifikasi")) },
            ),
        )
        Section("Perlu tindakan") {
            val empty = summary?.takeIf { it.badge != null }?.empty.orEmpty()
            if (empty.isEmpty()) {
                Note("Tidak ada unit kosong di papan.")
            } else {
                ListGroup {
                    ListRow(
                        "${empty.size} unit belum ada operator",
                        notes = listOf("Isi dari kandidat di papan ACTUAL"),
                        glyph = Glyph.WARN,
                        onClick = toEmpty,
                    )
                }
            }
        }
    }
}
