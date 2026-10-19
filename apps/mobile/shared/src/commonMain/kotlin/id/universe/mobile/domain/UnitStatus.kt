package id.universe.mobile.domain

import id.universe.mobile.data.UnitStatusChange
import id.universe.mobile.data.UnitStatusRow

/*
 * "Status unit" for the Pengawas Lapangan: read only (docs/prd.md, Mobile app).
 * The API ranks a unit's status; this words it and says since when.
 */

enum class UnitTab(val status: String, val label: String, val tone: Tone) {
    BREAKDOWN("breakdown", "Breakdown", Tone.BAD),
    STANDBY("standby", "Standby", Tone.WARN),
    READY("ready", "Aktif", Tone.OK),
}

data class UnitLine(val code: String, val note: String, val badge: Pill)

private fun tabOf(status: String) = UnitTab.entries.firstOrNull { it.status == status }

fun countIn(rows: List<UnitStatusRow>, tab: UnitTab): Int = rows.count { it.status == tab.status }

/** "sejak 03:40 hari ini", "sejak kemarin 22:15", "sejak 16 Okt"; null when no change is on record. */
fun sinceLabel(updatedAt: String?, today: String): String? {
    if (updatedAt == null) return null
    val date = siteDateOf(updatedAt)
    val clock = siteClockOf(updatedAt)
    return when (date) {
        today -> "sejak $clock hari ini"
        shiftDay(today, -1) -> "sejak kemarin $clock"
        else -> "sejak ${dayMonth(date)}"
    }
}

fun unitsIn(rows: List<UnitStatusRow>, tab: UnitTab, query: String, today: String): List<UnitLine> {
    val needle = query.trim().lowercase()
    return rows
        .filter { it.status == tab.status && it.code.lowercase().contains(needle) }
        .map { row ->
            val machine = "${row.brandName} ${row.modelName}".trim().ifEmpty { null }
            UnitLine(
                row.code,
                listOfNotNull(machine, row.location, sinceLabel(row.updatedAt, today)).joinToString(" · "),
                Pill(tab.label, tab.tone),
            )
        }
}

/** One change on a unit's trail: what it became, why, and when on the site's clock. */
fun changeRow(change: UnitStatusChange, today: String): HistoryRow {
    val tab = tabOf(change.status)
    val word = tab?.label ?: change.status
    val date = siteDateOf(change.createdAt)
    val clock = siteClockOf(change.createdAt)
    val at = when (date) {
        today -> clock
        shiftDay(today, -1) -> "Kemarin $clock"
        else -> "${dayMonth(date)} $clock"
    }
    return HistoryRow(word, change.reason, at, Pill(word, tab?.tone ?: Tone.NEUTRAL))
}
