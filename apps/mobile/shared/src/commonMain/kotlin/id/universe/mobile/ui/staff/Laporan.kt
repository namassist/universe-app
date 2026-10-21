package id.universe.mobile.ui.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import id.universe.mobile.api.apis.ReportApi.KindGetV1ReportsByKind as KindParam
import id.universe.mobile.api.apis.ReportApi.ShiftGetV1ReportsByKind as ShiftParam
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.Report
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.ReportKind
import id.universe.mobile.domain.countPill
import id.universe.mobile.domain.dayLabel
import id.universe.mobile.domain.reportKindOf
import id.universe.mobile.domain.reportLines
import id.universe.mobile.domain.shiftDay
import id.universe.mobile.domain.shiftWord
import id.universe.mobile.ui.LaporanDetailRoute
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Failure
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerList
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.RoundButton
import id.universe.mobile.ui.components.Tabs
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.block
import id.universe.mobile.ui.components.groupRows
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme

/*
 * Laporan (docs/prd.md, Mobile app; DESIGN.md → Dashboard and Laporan): the
 * web's five reports for one date and shift, view only, narrowed by the API to
 * whatever the account's scope allows. The workbook download stays on the web.
 */

private val SHIFTS = listOf("day", "night")

private const val UNKNOWN_REPORT = "Laporan ini tidak dikenali versi aplikasi ini. Perbarui aplikasi."

/** One report, asked for afresh whenever the date or shift changes. */
@Composable
private fun rememberReport(api: UniverseApi, kind: ReportKind, date: String, shift: String): LoadHandle<Report> {
    /* A kind or shift this build does not know is said, never a crash. */
    val kindParam = KindParam.entries.firstOrNull { it.value == kind.value }
    val shiftParam = ShiftParam.entries.firstOrNull { it.value == shift }
    return rememberLoad("report", kind, date, shift) {
        if (kindParam == null || shiftParam == null) {
            Outcome.Refused(0, null, UNKNOWN_REPORT)
        } else {
            api.call { report.getV1ReportsByKind(kindParam, date, shiftParam) }
        }
    }
}

/** The five reports for a date and shift, each with its row count. Opens on the running board's. */
@Composable
fun LaporanScreen(api: UniverseApi, startDate: String, startShift: String, onBack: () -> Unit, go: (Any) -> Unit) {
    var date by rememberSaveable { mutableStateOf(startDate) }
    var shift by rememberSaveable { mutableStateOf(startShift) }
    InnerScreen("Laporan", onBack) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundButton(Glyph.BACK, "Hari sebelumnya", { date = shiftDay(date, -1) })
            Txt(dayLabel(date), Theme.type.emphasis)
            RoundButton(Glyph.CHEVRON, "Hari berikutnya", { date = shiftDay(date, 1) })
        }
        Tabs(SHIFTS.map { it to shiftWord(it) }, shift, { shift = it })
        ListGroup {
            ReportKind.entries.forEachIndexed { index, kind ->
                if (index > 0) Hairline()
                ReportEntry(rememberReport(api, kind, date, shift), kind) {
                    go(LaporanDetailRoute(kind.value, date, shift))
                }
            }
        }
        Note("Hanya lihat, sesuai hak akses akun ini. Unduh workbook dari console web.")
    }
}

@Composable
private fun ReportEntry(report: LoadHandle<Report>, kind: ReportKind, onOpen: () -> Unit) {
    val load = report.value
    val ready = (load as? Load.Ready)?.value
    /* A report made from the board has nothing to count before the board exists: not a zero. */
    val waiting = ready != null && kind.needsBoard && !ready.boardGenerated
    ListRow(
        kind.title,
        notes = listOf(
            when {
                load is Load.Failed -> load.words
                waiting -> "Papan belum dibuat"
                else -> kind.blurb
            },
        ),
        glyph = Glyph.DOC,
        onClick = onOpen,
    ) { if (ready != null && !waiting) Badge(countPill(kind, ready.rows.size)) }
}

/** One report's rows, searchable; a long one (Final Validation) is drawn lazily. */
@Composable
fun LaporanDetailScreen(api: UniverseApi, kindValue: String, date: String, shift: String, onBack: () -> Unit) {
    val kind = reportKindOf(kindValue)
    if (kind == null) {
        InnerScreen("Laporan", onBack) { Note(UNKNOWN_REPORT) }
        return
    }
    val report = rememberReport(api, kind, date, shift)
    var query by rememberSaveable { mutableStateOf("") }
    val load = report.value
    val data = (load as? Load.Ready)?.value
    val lines = remember(data, query) { data?.let { reportLines(kind, it.rows, query) }.orEmpty() }
    InnerList(kind.title, onBack) {
        block("search") { SearchField(query, { query = it }, "Cari nama, NIK atau unit") }
        when {
            load is Load.Failed -> block("failed") { Failure(load.words, report.reload) }
            data == null -> block("loading") { Note("Memuat…") }
            else -> {
                block("count") { Note("${dayLabel(date)} · Shift ${shiftWord(shift)} · ${data.rows.size} baris") }
                when {
                    kind.needsBoard && !data.boardGenerated ->
                        block("no-board") { Note("Papan untuk tanggal dan shift ini belum dibuat.") }
                    lines.isEmpty() ->
                        block("none") { Note(if (query.isBlank()) "Tidak ada baris di laporan ini." else "Tidak ada baris yang cocok.") }
                    /* Rows carry no id of their own, and a name can repeat: keyed by place. */
                    else -> groupRows(lines.withIndex().toList(), key = { it.index }) { (_, line) ->
                        ListRow(
                            line.title,
                            titleStyle = if (kind == ReportKind.EQUIPMENT_NO_OPERATOR) Theme.type.code else Theme.type.bodyStrong,
                            notes = listOf(line.note).filter { it.isNotEmpty() },
                        ) { line.badge?.let { Badge(it) } }
                    }
                }
                block("note") { Note("Hanya lihat. Kolom lengkap ada di workbook console web.") }
            }
        }
    }
}
