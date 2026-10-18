package id.universe.mobile.domain

import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.number
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/**
 * The site's own clock. Dates the API sends are site calendar dates and its
 * tap and upload stamps are site wall time (WITA), whatever zone the phone
 * itself is set to.
 */
val SITE_ZONE: TimeZone = TimeZone.of("Asia/Makassar")

private val WEEKDAYS = listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")
private val MONTHS_SHORT =
    listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
private val MONTHS = listOf(
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
)

@OptIn(ExperimentalTime::class)
fun siteNow(): LocalDateTime = Clock.System.now().toLocalDateTime(SITE_ZONE)

fun siteToday(): String = siteNow().date.toString()

/** "2026-10-18" → "Min 18 Okt". */
fun dayLabel(date: String): String {
    val d = LocalDate.parse(date)
    return "${WEEKDAYS[d.dayOfWeek.isoDayNumber - 1]} ${d.day} ${MONTHS_SHORT[d.month.number - 1]}"
}

/** "2026-10-18" → "18 Okt", as the API's pushes word it. */
fun dayMonth(date: String): String {
    val d = LocalDate.parse(date)
    return "${d.day} ${MONTHS_SHORT[d.month.number - 1]}"
}

private fun firstOf(month: String): LocalDate = LocalDate.parse("$month-01")

/** "2027-03-12" → "12 Mar 2027". */
fun dayMonthYear(date: String): String = "${dayMonth(date)} ${LocalDate.parse(date).year}"

/** "2026-10" → "Oktober 2026". */
fun monthTitle(month: String): String {
    val d = firstOf(month)
    return "${MONTHS[d.month.number - 1]} ${d.year}"
}

/** "2026-10" moved by whole months. */
fun shiftMonth(month: String, by: Int): String =
    firstOf(month).plus(by, DateTimeUnit.MONTH).toString().take(7)

/** The first and last date of a month, for a `from`/`to` range. */
fun monthRange(month: String): Pair<String, String> {
    val first = firstOf(month)
    return first.toString() to first.plus(1, DateTimeUnit.MONTH).minus(1, DateTimeUnit.DAY).toString()
}

/** A date moved by whole days. */
fun shiftDay(date: String, by: Int): String = LocalDate.parse(date).plus(by, DateTimeUnit.DAY).toString()

enum class DayKind { DAY, NIGHT, OFF, NONE }

data class DayCell(
    val day: Int,
    val date: String,
    val code: String?,
    val kind: DayKind,
    val today: Boolean,
)

/** `D` works the day, `N` the night; any other code is a day off (contracts `rosterShift`). */
fun dayKind(code: String?): DayKind = when (code) {
    null -> DayKind.NONE
    "D" -> DayKind.DAY
    "N" -> DayKind.NIGHT
    else -> DayKind.OFF
}

/** A month as a Monday-first grid: null for the blanks before the 1st. */
fun monthCells(month: String, codes: Map<String, String>, today: String): List<DayCell?> {
    val first = firstOf(month)
    val leading = first.dayOfWeek.isoDayNumber - 1
    val days = buildList {
        var d = first
        while (d.month == first.month) {
            val date = d.toString()
            val code = codes[date]
            add(DayCell(d.day, date, code, dayKind(code), today = date == today))
            d = d.plus(1, DateTimeUnit.DAY)
        }
    }
    return List(leading) { null } + days
}

fun monthSummary(codes: List<String>): String {
    val kinds = codes.map(::dayKind)
    val day = kinds.count { it == DayKind.DAY }
    val night = kinds.count { it == DayKind.NIGHT }
    val off = kinds.count { it == DayKind.OFF }
    return "$day hari siang · $night hari malam · $off hari libur"
}

/** "HH:MM" out of "HH:MM:SS" or a site-local "YYYY-MM-DD HH:MM:SS". */
fun clockOf(stamp: String?): String? =
    stamp?.let { Regex("""\d{2}:\d{2}""").find(it)?.value }

/** "HH:MM" on the site's clock for an ISO instant (`…Z`). */
@OptIn(ExperimentalTime::class)
fun siteClockOf(instant: String): String =
    Instant.parse(instant).toLocalDateTime(SITE_ZONE).time.toString().take(5)

/** The site date of an ISO instant. */
@OptIn(ExperimentalTime::class)
fun siteDateOf(instant: String): String =
    Instant.parse(instant).toLocalDateTime(SITE_ZONE).date.toString()

fun sleepLabel(minutes: Int): String =
    "${minutes / 60} j ${(minutes % 60).toString().padStart(2, '0')} m"

fun shiftWord(shift: String): String = when (shift) {
    "day" -> "Siang"
    "night" -> "Malam"
    else -> shift
}
