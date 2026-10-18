package id.universe.mobile.ui.operator

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.universe.mobile.api.apis.RosterApi.StatusGetV1Roster
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.RosterDays
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.DayCell
import id.universe.mobile.domain.DayKind
import id.universe.mobile.domain.codesFor
import id.universe.mobile.domain.monthCells
import id.universe.mobile.domain.monthRange
import id.universe.mobile.domain.monthSummary
import id.universe.mobile.domain.monthTitle
import id.universe.mobile.domain.shiftMonth
import id.universe.mobile.domain.siteToday
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.RoundButton
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme

private val WEEKDAYS = listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")

/** The month's codes from the documents in force that carry a day for this person. */
private suspend fun monthCodes(api: UniverseApi, nik: String?, month: String): Outcome<Map<String, String>> {
    if (nik == null) return Outcome.Ok(emptyMap())
    val (from, to) = monthRange(month)
    val documents = when (val answer = api.call { roster.getV1Roster(month = month, status = StatusGetV1Roster.AKTIF) }) {
        is Outcome.Ok -> answer.value
        is Outcome.Refused -> return answer
        Outcome.Offline -> return Outcome.Offline
    }
    val lines = mutableListOf<RosterDays>()
    for (document in documents) {
        when (val answer = api.call { roster.getV1RosterByIdDays(document.id, from = from, to = to) }) {
            is Outcome.Ok -> lines += answer.value
            is Outcome.Refused -> return answer
            Outcome.Offline -> return Outcome.Offline
        }
    }
    return Outcome.Ok(codesFor(nik, lines))
}

@Composable
fun JadwalScreen(api: UniverseApi, nik: String?, onBack: () -> Unit) {
    var month by rememberSaveable { mutableStateOf(siteToday().take(7)) }
    val codes = rememberLoad(month, nik) { monthCodes(api, nik, month) }
    InnerScreen("Jadwal roster", onBack) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundButton(Glyph.BACK, "Bulan sebelumnya", { month = shiftMonth(month, -1) })
            Txt(monthTitle(month), Theme.type.emphasis)
            RoundButton(Glyph.CHEVRON, "Bulan berikutnya", { month = shiftMonth(month, 1) })
        }
        Loaded(codes) { byDate ->
            MonthGrid(monthCells(month, byDate, siteToday()))
            Legend()
            ListGroup {
                ListRow(
                    "Bulan ini",
                    notes = listOf(
                        if (byDate.isEmpty()) "Belum ada roster aktif untuk bulan ini" else monthSummary(byDate.values.toList()),
                    ),
                    glyph = Glyph.CALENDAR,
                )
            }
        }
    }
}

@Composable
private fun MonthGrid(cells: List<DayCell?>) {
    val palette = Theme.palette
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            WEEKDAYS.forEach {
                Txt(it, Theme.type.badge, Modifier.weight(1f), color = palette.inkFaint, align = TextAlign.Center)
            }
        }
        cells.chunked(7).forEach { week ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                week.forEach { cell ->
                    if (cell == null) Box(Modifier.weight(1f)) else DayBox(cell, Modifier.weight(1f))
                }
                repeat(7 - week.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DayBox(cell: DayCell, modifier: Modifier) {
    val palette = Theme.palette
    val (fill, dayInk, codeInk) = when (cell.kind) {
        DayKind.DAY -> Triple(palette.actionSoft, palette.inkMuted, palette.ink)
        DayKind.NIGHT -> Triple(palette.hero, palette.heroTextMuted, Color.White)
        else -> Triple(palette.surface, palette.inkMuted, palette.ink)
    }
    Column(
        modifier
            .heightIn(min = 56.dp)
            .background(fill, Corners.cell)
            .then(if (cell.today) Modifier.border(2.dp, palette.action, Corners.cell) else Modifier)
            .semantics(mergeDescendants = true) {
                contentDescription = "${cell.day}: ${cell.code ?: "tanpa roster"}" + if (cell.today) ", hari ini" else ""
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Txt("${cell.day}", Theme.type.label.copy(fontFeatureSettings = "tnum"), color = dayInk)
        Txt(cell.code ?: "–", Theme.type.buttonSmall.copy(fontSize = Theme.type.chip.fontSize), color = codeInk)
    }
}

@Composable
private fun Legend() {
    val palette = Theme.palette
    FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            Triple(palette.actionSoft, null, "D · siang"),
            Triple(palette.hero, null, "N · malam"),
            Triple(palette.surface, palette.line, "OFF / CR · libur"),
        ).forEach { (fill, edge, label) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier
                        .size(12.dp)
                        .background(fill, Corners.cell)
                        .then(if (edge != null) Modifier.border(1.dp, edge, Corners.cell) else Modifier),
                )
                Txt(label, Theme.type.label.copy(fontWeight = Theme.type.body.fontWeight), color = palette.inkMuted)
            }
        }
    }
}
