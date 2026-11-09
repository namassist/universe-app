package id.universe.mobile.ui.staff

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import id.universe.mobile.data.UnitStatusRow
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.UnitTab
import id.universe.mobile.domain.changeRow
import id.universe.mobile.domain.countIn
import id.universe.mobile.domain.siteToday
import id.universe.mobile.domain.unitsIn
import id.universe.mobile.ui.UnitHistoryRoute
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Failure
import id.universe.mobile.ui.components.InnerList
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.block
import id.universe.mobile.ui.components.groupRows
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Tabs
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.theme.Theme

/** Active, breakdown and standby units, read only: a status is changed on the web console. */
@Composable
fun UnitStatusScreen(units: LoadHandle<List<UnitStatusRow>>, onBack: () -> Unit, go: (Any) -> Unit) {
    var tab by rememberSaveable { mutableStateOf(UnitTab.BREAKDOWN) }
    var query by rememberSaveable { mutableStateOf("") }
    val today = remember { siteToday() }
    /* Hundreds of active units: a lazy list, so only the rows on screen are drawn. */
    val load = units.value
    val rows = (load as? Load.Ready)?.value
    val lines = remember(rows, tab, query, today) { rows?.let { unitsIn(it, tab, query, today) }.orEmpty() }
    InnerList("Status unit", onBack) {
        block("search") { SearchField(query, { query = it }, "Cari kode unit, mis. DT4084") }
        when {
            load is Load.Failed -> block("failed") { Failure(load.words, units.reload) }
            rows == null -> block("loading") { Note("Memuat…") }
            else -> {
                block("tabs") {
                    Tabs(UnitTab.entries.map { it to "${it.label} ${countIn(rows, it)}" }, tab, { tab = it })
                }
                if (lines.isEmpty()) {
                    block("none") {
                        Note(if (query.isBlank()) "Tidak ada unit ${tab.label.lowercase()}." else "Tidak ada unit yang cocok.")
                    }
                } else {
                    groupRows(lines, key = { it.code }) { line ->
                        ListRow(
                            line.code,
                            titleStyle = Theme.type.code,
                            notes = listOf(line.note),
                            onClick = { go(UnitHistoryRoute(line.code)) },
                        ) { Badge(line.badge) }
                    }
                }
                block("note") { Note("Hanya lihat. Status unit diubah admin dari console web.") }
            }
        }
    }
}

/** A unit's status changes, newest first, with the reason given for each. */
@Composable
fun UnitHistoryScreen(api: UniverseApi, code: String, onBack: () -> Unit) {
    val changes = rememberLoad(code) { api.call { unitStatus.getV1UnitStatusByCodeHistory(code) } }
    val today = remember { siteToday() }
    InnerScreen("Riwayat $code", onBack) {
        Loaded(changes) { list ->
            if (list.isEmpty()) {
                Note("Belum ada perubahan status yang tercatat untuk $code.")
                return@Loaded
            }
            ListGroup {
                list.map { changeRow(it, today) }.forEachIndexed { index, row ->
                    if (index > 0) Hairline()
                    ListRow(row.note, notes = listOfNotNull(row.figure)) { row.badge?.let { Badge(it) } }
                }
            }
        }
    }
}
