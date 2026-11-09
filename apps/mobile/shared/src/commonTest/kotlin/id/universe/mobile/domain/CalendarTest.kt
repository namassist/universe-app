package id.universe.mobile.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CalendarTest {
    @Test
    fun aMonthStartsOnItsWeekdayWithMondayFirst() {
        // 1 October 2026 is a Thursday: Monday to Wednesday stay empty.
        val cells = monthCells("2026-10", mapOf("2026-10-01" to "D"), today = "2026-10-17")
        assertEquals(listOf(null, null, null), cells.take(3))
        assertEquals(DayCell(1, "2026-10-01", "D", DayKind.DAY, today = false), cells[3])
        assertEquals(3 + 31, cells.size)
        assertEquals(true, cells[3 + 16]!!.today)
    }

    @Test
    fun codesSortIntoDayNightAndOff() {
        val cells = monthCells(
            "2026-10",
            mapOf("2026-10-01" to "D", "2026-10-02" to "N", "2026-10-03" to "CR"),
            today = "2026-10-17",
        ).filterNotNull()
        assertEquals(DayKind.DAY, cells[0].kind)
        assertEquals(DayKind.NIGHT, cells[1].kind)
        assertEquals(DayKind.OFF, cells[2].kind)
        assertEquals(DayKind.NONE, cells[3].kind)
        assertNull(cells[3].code)
    }

    @Test
    fun aMonthIsSummarisedByItsCodes() {
        assertEquals(
            "2 hari siang · 1 hari malam · 1 hari libur",
            monthSummary(listOf("D", "D", "N", "OFF")),
        )
    }

    @Test
    fun datesAreWordedAsTheSiteReadsThem() {
        assertEquals("Oktober 2026", monthTitle("2026-10"))
        assertEquals("Min 18 Okt", dayLabel("2026-10-18"))
        assertEquals("18 Okt", dayMonth("2026-10-18"))
        assertEquals("2026-11", shiftMonth("2026-10", 1))
        assertEquals("2025-12", shiftMonth("2026-01", -1))
    }

    @Test
    fun clocksAreReadFromWhicheverStampTheyCameIn() {
        assertEquals("05:03", clockOf("05:03:41"))
        assertEquals("04:18", clockOf("2026-10-18 04:18:00"))
        assertNull(clockOf(null))
    }

    @Test
    fun sleepIsHoursAndMinutes() {
        assertEquals("6 j 12 m", sleepLabel(372))
        assertEquals("0 j 45 m", sleepLabel(45))
    }
}
