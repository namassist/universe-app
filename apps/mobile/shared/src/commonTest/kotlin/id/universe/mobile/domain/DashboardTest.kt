package id.universe.mobile.domain

import id.universe.mobile.data.Dashboard
import id.universe.mobile.data.DashboardAllocation
import id.universe.mobile.data.DashboardAnalytics
import id.universe.mobile.data.DashboardAttendance
import id.universe.mobile.data.DashboardFtw
import id.universe.mobile.data.DashboardOperators
import id.universe.mobile.data.DashboardSimper
import id.universe.mobile.data.DashboardUnits
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/*
 * The phone's Dashboard (docs/prd.md, Mobile app; DESIGN.md → Dashboard and
 * Laporan): the API sends only the sections the caller's grants allow, and a
 * figure links only to a screen that lists exactly it.
 */
class DashboardTest {
    private val board = DashboardAllocation(shift = "day", generatedAt = "2026-10-18T21:26:00.000Z", slots = 128, filled = 124)

    /* What the Pengawas Lapangan's grants bring: the units and the board, nothing about people. */
    private val pengawas = Dashboard(
        date = "2026-10-19",
        shift = "day",
        attendance = null,
        ftw = null,
        units = DashboardUnits(active = 394, breakdown = 20, standby = 0, breakdownCodes = listOf("DT4084")),
        ingest = null,
        allocation = listOf(board, board.copy(shift = "night", slots = 120, filled = 0)),
        analytics = null,
        simper = null,
        me = null,
    )

    private val superadmin = pengawas.copy(
        attendance = DashboardAttendance(scheduled = 332, tapped = 289),
        ftw = DashboardFtw(scheduled = 332, followUp = 12, missing = 72),
        simper = DashboardSimper(expired = 3, soon = 8),
        analytics = DashboardAnalytics(
            operators = listOf(DashboardOperators(category = "DUMP TRUCK", ready = 212, noFinger = 6, noFtw = 9)),
            spares = emptyList(),
            resting = emptyList(),
            equipment = emptyList(),
        ),
    )

    @Test
    fun theHeadingNamesTheDayAndTheShiftTheApiCounted() {
        assertEquals("Sen 19 Okt · Shift Siang", dashboardView(pengawas).heading)
    }

    @Test
    fun aSectionTheGrantsWithholdIsAbsentNotZero() {
        val view = dashboardView(pengawas)
        assertEquals(listOf("Unit terisi", "Unit aktif"), view.cards.map { it.title })
        assertTrue(view.categories.isEmpty())
        assertEquals(listOf("4 unit belum ada operator"), view.attention.map { it.title })
    }

    @Test
    fun theBoardCardReadsThisShiftsBoardAndOpensThePapan() {
        val card = dashboardView(pengawas).cards.first()
        assertEquals("124/128", card.figure)
        assertEquals("Papan dibuat 05:26", card.note)
        assertEquals(97, card.percent)
        assertEquals(DashLink.BOARD, card.link)
    }

    @Test
    fun aShiftWithNoBoardYetSaysSoInsteadOfAZero() {
        val view = dashboardView(pengawas.copy(allocation = listOf(board.copy(shift = "night"))))
        val card = view.cards.first()
        assertEquals("—", card.figure)
        assertEquals("Papan shift siang belum dibuat", card.note)
        assertNull(card.percent)
        assertTrue(view.attention.isEmpty())
    }

    @Test
    fun theUnitCardWordsTheRegisterAndOpensStatusUnit() {
        val card = dashboardView(pengawas).cards.last()
        assertEquals("394", card.figure)
        assertEquals("20 breakdown · 0 standby", card.note)
        assertEquals(DashLink.UNITS, card.link)
    }

    @Test
    fun emptySeatsOpenTheReportThatListsExactlyThem() {
        val line = dashboardView(pengawas).attention.single()
        assertEquals("Equipment No Operator", line.note)
        assertEquals(Pill("Kosong", Tone.BAD), line.badge)
        assertEquals(DashLink.EMPTY_UNITS_REPORT, line.link)
    }

    @Test
    fun peopleFiguresAreInformationBecauseNoReportListsExactlyThem() {
        val view = dashboardView(superadmin)
        val finger = view.cards.first { it.title == "Sudah finger" }
        assertEquals("289/332", finger.figure)
        assertEquals("43 belum finger", finger.note)
        assertEquals(87, finger.percent)
        assertNull(finger.link)
        val ftw = view.cards.first { it.title == "FTW lolos" }
        /* 332 owe a filing: 12 filed and need following up, 72 have not filed. */
        assertEquals("248/332", ftw.figure)
        assertEquals("72 belum lapor · 12 perlu tindak lanjut", ftw.note)
        assertNull(ftw.link)
        assertEquals(
            listOf("4 unit belum ada operator", "72 operator belum lapor FTW", "3 SIMPER kedaluwarsa"),
            view.attention.map { it.title },
        )
        assertTrue(view.attention.drop(1).all { it.link == null })
        assertEquals("8 lagi habis dalam 30 hari", view.attention.last().note)
    }

    @Test
    fun simperSoonToExpireIsAWarningOnItsOwn() {
        val view = dashboardView(superadmin.copy(simper = DashboardSimper(expired = 0, soon = 8)))
        assertEquals(
            AttentionLine(Topic.SIMPER, "8 SIMPER habis dalam 30 hari", "Belum ada yang kedaluwarsa", Pill("SIMPER", Tone.WARN), null),
            view.attention.last(),
        )
    }

    @Test
    fun eachCategorySaysWhoIsReadyAndWhatStopsTheRest() {
        assertEquals(
            listOf(CategoryLine("DUMP TRUCK", "212 siap · 6 belum finger · 9 belum FTW")),
            dashboardView(superadmin).categories,
        )
    }

    @Test
    fun nothingToShowIsSaid() {
        assertTrue(dashboardView(pengawas.copy(units = null, allocation = null)).empty)
        assertTrue(!dashboardView(pengawas).empty)
    }
}
