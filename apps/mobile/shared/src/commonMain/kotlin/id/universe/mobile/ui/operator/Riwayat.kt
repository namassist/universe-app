package id.universe.mobile.ui.operator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.HistoryRow
import id.universe.mobile.domain.attendanceHistoryRow
import id.universe.mobile.domain.ftwHistoryRow
import id.universe.mobile.domain.seatHistoryRow
import id.universe.mobile.domain.shiftDay
import id.universe.mobile.domain.siteToday
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Tabs
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.theme.Theme

/** How far back "Riwayat" looks; the API allows two months. */
private const val HISTORY_DAYS = 30

/**
 * Past seats, FTW and taps, newest first. FTW and attendance are the web's
 * own lists, which answer a `self` caller with their own rows.
 */
@Composable
fun RiwayatScreen(api: UniverseApi, initialTab: String, onBack: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    val to = remember { siteToday() }
    val from = remember(to) { shiftDay(to, -(HISTORY_DAYS - 1)) }
    InnerScreen("Riwayat", onBack) {
        Tabs(listOf("unit" to "Unit", "ftw" to "FTW", "hadir" to "Kehadiran"), tab, { tab = it })
        when (tab) {
            "ftw" -> History(rememberLoad("ftw", from) { api.call { fitToWork.getV1FitToWork(from, to) } }) { answer ->
                answer.rows.sortedByDescending { it.date }.map(::ftwHistoryRow)
            }
            "hadir" -> History(rememberLoad("hadir", from) { api.call { attendance.getV1Attendance(from, to) } }) { answer ->
                answer.rows.sortedByDescending { it.date }.map(::attendanceHistoryRow)
            }
            else -> History(rememberLoad("unit", from) { api.call { me.getV1MeSeats(from, to) } }) { answer ->
                answer.seats.sortedWith(compareByDescending<id.universe.mobile.data.PastSeat> { it.date }.thenByDescending { it.shift })
                    .map(::seatHistoryRow)
            }
        }
        Note("$HISTORY_DAYS hari terakhir. Data FTW dari savera, finger dari mesin di site.")
    }
}

@Composable
private fun <T> History(handle: LoadHandle<T>, rows: (T) -> List<HistoryRow>) {
    Loaded(handle) { answer ->
        val list = rows(answer)
        if (list.isEmpty()) {
            Note("Belum ada catatan dalam $HISTORY_DAYS hari terakhir.")
            return@Loaded
        }
        ListGroup {
            list.forEachIndexed { index, row ->
                if (index > 0) Hairline()
                ListRow(row.title, notes = listOf(row.note)) {
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        row.figure?.let { Txt(it, Theme.type.code) }
                        row.badge?.let { Badge(it) }
                    }
                }
            }
        }
    }
}
