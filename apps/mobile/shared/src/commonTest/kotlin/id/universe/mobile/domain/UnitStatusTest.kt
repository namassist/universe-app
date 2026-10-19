package id.universe.mobile.domain

import id.universe.mobile.data.UnitStatusChange
import id.universe.mobile.data.UnitStatusRow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class UnitStatusTest {
    private fun row(code: String, status: String, updatedAt: String?, location: String? = null) = UnitStatusRow(
        id = "u-$code",
        code = code,
        modelName = "HD785",
        brandName = "Komatsu",
        status = status,
        location = location,
        updatedAt = updatedAt,
    )

    private val rows = listOf(
        row("DT4084", "breakdown", "2026-10-18T19:40:00.000Z", "PIT 3 SELATAN"),
        row("DT3317", "breakdown", "2026-10-18T14:15:00.000Z"),
        row("DT4120", "standby", null),
        row("DT5102", "ready", "2026-10-15T00:00:00.000Z"),
    )

    @Test
    fun eachTabCountsItsOwnStatus() {
        assertEquals(2, countIn(rows, UnitTab.BREAKDOWN))
        assertEquals(1, countIn(rows, UnitTab.STANDBY))
        assertEquals(1, countIn(rows, UnitTab.READY))
        assertEquals("Aktif", UnitTab.READY.label)
    }

    @Test
    fun aRowSaysWhatTheUnitIsWhereAndSinceWhen() {
        val shown = unitsIn(rows, UnitTab.BREAKDOWN, query = "", today = "2026-10-19")
        assertEquals(listOf("DT4084", "DT3317"), shown.map { it.code })
        /* 19:40Z is 03:40 WITA on the 19th; 14:15Z is 22:15 WITA on the 18th. */
        assertEquals("Komatsu HD785 · PIT 3 SELATAN · sejak 03:40 hari ini", shown[0].note)
        assertEquals("Komatsu HD785 · sejak kemarin 22:15", shown[1].note)
        assertEquals(Pill("Breakdown", Tone.BAD), shown[0].badge)
    }

    @Test
    fun theSearchNarrowsByCode() {
        assertEquals(listOf("DT3317"), unitsIn(rows, UnitTab.BREAKDOWN, query = "3317", today = "2026-10-19").map { it.code })
    }

    @Test
    fun sinceIsATimeTodayYesterdayOrADate() {
        assertEquals("sejak 16 Okt", sinceLabel("2026-10-15T23:00:00.000Z", today = "2026-10-19"))
        assertNull(sinceLabel(null, today = "2026-10-19"))
    }

    @Test
    fun aChangeReadsAsItsStatusAndReason() {
        val change = UnitStatusChange(
            id = "h1",
            status = "breakdown",
            reason = "Hidrolik bocor",
            createdAt = "2026-10-18T19:40:00.000Z",
        )
        assertEquals(
            HistoryRow("Breakdown", "Hidrolik bocor", "03:40", Pill("Breakdown", Tone.BAD)),
            changeRow(change, today = "2026-10-19"),
        )
    }
}
