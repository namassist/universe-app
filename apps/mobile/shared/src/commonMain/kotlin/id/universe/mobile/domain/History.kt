package id.universe.mobile.domain

import id.universe.mobile.data.AttendanceRow
import id.universe.mobile.data.FtwRow
import id.universe.mobile.data.PastSeat

/** One line of "Riwayat": a date, a second line, a figure and its badge. */
data class HistoryRow(val title: String, val note: String, val figure: String?, val badge: Pill?)

fun seatHistoryRow(seat: PastSeat) = HistoryRow(
    title = dayLabel(seat.date),
    note = shiftWord(seat.shift),
    figure = seat.unit,
    badge = when (seat.source) {
        "plan" -> Pill("Pegangan", Tone.INFO)
        "spare" -> Pill("Spare", Tone.WARN)
        "manual" -> Pill("Manual", Tone.WARN)
        else -> Pill(seat.source, Tone.NEUTRAL)
    },
)

/**
 * savera's own decision, hued as the web's FTW list hues it
 * (`ftwDecisionBadge`): "aman" is green, any other word red. A late upload
 * reads late, not fail (docs/prd.md, Mobile app → User).
 */
fun ftwHistoryRow(row: FtwRow) = HistoryRow(
    title = dayLabel(row.date),
    note = clockOf(row.sentAt)?.let { "Diunggah $it" } ?: "Belum diunggah",
    figure = sleepLabel(row.sleepMinutes),
    badge = when {
        row.late -> Pill("Terlambat", Tone.WARN)
        row.ftwDecision == null -> Pill("Belum ada", Tone.NEUTRAL)
        row.ftwDecision.contains("aman", ignoreCase = true) -> Pill(row.ftwDecision, Tone.OK)
        else -> Pill(row.ftwDecision, Tone.BAD)
    },
)

/** The first IN of the shift, and whether it beat `finger-in`, as the API judged it. */
fun attendanceHistoryRow(row: AttendanceRow) = HistoryRow(
    title = dayLabel(row.date),
    note = when (row.rosterCode) {
        "D" -> "Siang"
        "N" -> "Malam"
        null -> "—"
        else -> row.rosterCode
    },
    figure = clockOf(row.firstInAt),
    badge = row.late?.let { if (it) Pill("Terlambat", Tone.WARN) else Pill("Tepat waktu", Tone.OK) },
)
