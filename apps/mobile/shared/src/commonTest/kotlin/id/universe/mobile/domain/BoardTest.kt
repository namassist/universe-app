package id.universe.mobile.domain

import id.universe.mobile.data.Board
import id.universe.mobile.data.BoardFleet
import id.universe.mobile.data.BoardUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/*
 * The Pengawas Lapangan reads the fleet wall's own board (docs/prd.md, Mobile
 * app → Pengawas Lapangan). These pin how its counts and rows are worded; the
 * board itself is the API's.
 */

private fun unit(code: String, name: String?, source: String?) = BoardUnit(
    unitId = "u-$code",
    unitCode = code,
    modelName = "HD785",
    brandName = "Komatsu",
    busCode = "BUS 07",
    unitArea = null,
    employeeNik = name?.let { "1${code.filter(Char::isDigit)}" },
    employeeName = name,
    employeePhotoFile = null,
    source = source,
    tappedAt = null,
    ftw = null,
)

private fun fleet(id: String, kind: String, leader: String?, area: String?, vararg units: BoardUnit) = BoardFleet(
    id = id,
    kind = kind,
    leaderCode = leader,
    area = area,
    busCode = null,
    total = units.size,
    crewed = units.count { it.employeeName != null },
    idle = units.count { it.employeeName == null },
    substituted = units.count { it.source == "spare" || it.source == "manual" },
    units = units.toList(),
)

private val pit3 = fleet(
    "f1", "fleet", "EX1203", "PIT 3 SELATAN",
    unit("EX1203", "Agus Prasetyo", "plan"),
    unit("DT4084", "Dedi Kurniawan", "spare"),
    unit("DT4102", null, null),
)
private val pit1 = fleet(
    "f2", "fleet", "EX1207", "PIT 1 UTARA",
    unit("DT5110", "Bambang Wijaya", "manual"),
    unit("DT5131", null, null),
)
private val support = fleet("support", "support", null, null, unit("DZ0901", "Wahyu Hidayat", "plan"))
private val pool = fleet("spare", "spare", null, "PARKIRAN SPARE", unit("SPARE", "Rizki Maulana", "spare"))

private fun board(
    generatedAt: String? = "2026-10-18T21:26:00.000Z",
    provisional: Boolean = false,
    date: String? = "2026-10-19",
    fleets: List<BoardFleet> = listOf(pit3, pit1, support, pool),
) = Board(
    servedAt = "2026-10-18T21:40:00.000Z",
    date = date,
    shift = date?.let { "day" },
    generatedAt = generatedAt,
    provisional = provisional,
    ftwClosed = true,
    fingerClosed = true,
    rotateSeconds = 15,
    layout = "slideshow",
    cardLayout = "overlay",
    slideGrid = "auto",
    deviceName = null,
    fleets = fleets,
)

class BoardTest {
    @Test
    fun theHeroCountsSeatsOnUnitsNotThePoolOfSpares() {
        val summary = boardSummary(board())
        assertEquals("4/6", summary.code)
        assertEquals("unit terisi · papan final 05:26", summary.line)
        assertEquals(Tone.OK, summary.tone)
        assertEquals(Pill("Final 05:26", Tone.OK), summary.badge)
        assertEquals("Shift Siang", summary.chip)
        assertEquals(1, summary.fromSpare)
        assertEquals(1, summary.manual)
        assertEquals(
            listOf(EmptySeat("DT4102", "EX1203 · PIT 3 SELATAN"), EmptySeat("DT5131", "EX1207 · PIT 1 UTARA")),
            summary.empty,
        )
    }

    @Test
    fun aLineUpBeforeTheBoardSaysItIsNotFinal() {
        val summary = boardSummary(board(generatedAt = null, provisional = true))
        assertEquals("unit terisi · line-up sementara", summary.line)
        assertEquals(Tone.WARN, summary.tone)
        assertEquals(Pill("Sementara", Tone.WARN), summary.badge)
    }

    @Test
    fun noBoardAndNoShiftAreSaidRatherThanCountedAsZero() {
        val waiting = boardSummary(board(generatedAt = null, fleets = emptyList()))
        assertEquals("—", waiting.code)
        assertEquals("Papan shift ini belum dibuat", waiting.line)
        assertNull(waiting.badge)

        val unknown = boardSummary(board(date = null, generatedAt = null, fleets = emptyList()))
        assertEquals("Timeline belum bisa menentukan shift", unknown.line)
        assertEquals("Shift belum diketahui", unknown.chip)
    }

    @Test
    fun theGroupsReadAsTheWallsDo() {
        val groups = boardGroups(board(), BoardFilter.ALL)
        assertEquals(listOf("EX1203", "EX1207", "Support", "Pool spare"), groups.map { it.title })
        assertEquals("PIT 3 SELATAN", groups[0].area)
        assertEquals(
            listOf(
                BoardRow("EX1203", "Agus Prasetyo", Pill("Plan", Tone.INFO)),
                BoardRow("DT4084", "Dedi Kurniawan", Pill("Spare", Tone.WARN)),
                BoardRow("DT4102", null, Pill("Kosong", Tone.BAD)),
            ),
            groups[0].rows,
        )
    }

    @Test
    fun eachFilterKeepsOnlyItsRowsAndDropsEmptyGroups() {
        assertEquals(
            listOf("DT4102", "DT5131"),
            boardGroups(board(), BoardFilter.EMPTY).flatMap { g -> g.rows.map { it.unit } },
        )
        /* Seats filled from the pool, as the "N dari spare" pill counts them; the
           people still waiting in it are under Semua. */
        assertEquals(
            listOf("EX1203" to "DT4084"),
            boardGroups(board(), BoardFilter.SPARE).flatMap { g -> g.rows.map { g.title to it.unit } },
        )
        assertEquals(listOf("EX1207"), boardGroups(board(), BoardFilter.MANUAL).map { it.title })
    }

    @Test
    fun searchFindsAUnitOrAPersonAnywhereOnTheBoard() {
        assertEquals(
            listOf(BoardHit("DT5110", "Bambang Wijaya", "EX1207 · PIT 1 UTARA", Pill("Manual", Tone.WARN))),
            searchBoard(board(), "bambang"),
        )
        assertEquals(listOf("DT5110", "DT5131"), searchBoard(board(), " dt51 ").map { it.unit })
        assertEquals(emptyList(), searchBoard(board(), "  "))
    }
}
