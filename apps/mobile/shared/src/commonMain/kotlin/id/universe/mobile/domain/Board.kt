package id.universe.mobile.domain

import id.universe.mobile.data.Board
import id.universe.mobile.data.BoardFleet
import id.universe.mobile.data.BoardUnit

/*
 * Papan ACTUAL on the phone is the fleet wall's own board (apps/api/docs/
 * design.md D14), so it cannot disagree with the TV. This words it: who sits
 * where, what is empty, what came from the spare pool or by hand. Every count
 * is the board's; the pool of spares is people, not seats, and is never added
 * to a unit count.
 */

data class EmptySeat(val unit: String, val where: String)

data class BoardSummary(
    val chip: String,
    val code: String,
    val codeIsWord: Boolean,
    val line: String,
    val tone: Tone,
    /** "Final 05:26" or "Sementara"; null when there is no board to stand behind. */
    val badge: Pill?,
    val empty: List<EmptySeat>,
    val fromSpare: Int,
    val manual: Int,
)

enum class BoardFilter(val label: String) { ALL("Semua"), EMPTY("Kosong"), SPARE("Spare"), MANUAL("Manual") }

data class BoardRow(val unit: String, val name: String?, val badge: Pill)

data class BoardGroup(val title: String, val area: String?, val rows: List<BoardRow>)

data class BoardHit(val unit: String, val name: String?, val where: String, val badge: Pill)

private const val POOL = "spare"
private const val NO_CODE = "—"

private fun BoardFleet.isSeats() = kind != POOL

private fun BoardFleet.title() = when (kind) {
    "support" -> "Support"
    POOL -> "Pool spare"
    else -> leaderCode ?: "Formasi"
}

private fun BoardFleet.where() = listOfNotNull(title(), area).joinToString(" · ")

/** How a seat was filled, or that it was not: the wall's own source. */
fun sourcePill(unit: BoardUnit): Pill = when {
    unit.employeeName == null -> Pill("Kosong", Tone.BAD)
    unit.source == "plan" -> Pill("Plan", Tone.INFO)
    unit.source == "spare" -> Pill("Spare", Tone.WARN)
    unit.source == "manual" -> Pill("Manual", Tone.WARN)
    else -> Pill("Terisi", Tone.NEUTRAL)
}

fun boardSummary(board: Board): BoardSummary {
    val seats = board.fleets.filter { it.isSeats() }
    val units = seats.flatMap { it.units }
    val empty = seats.flatMap { fleet ->
        fleet.units.filter { it.employeeName == null }.map { EmptySeat(it.unitCode, fleet.where()) }
    }
    val chip = board.shift?.let { "Shift ${shiftWord(it)}" } ?: "Shift belum diketahui"
    val counted = "${units.count { it.employeeName != null }}/${units.size}"
    val (code, line, tone, badge) = when {
        board.date == null -> Quad(NO_CODE, "Timeline belum bisa menentukan shift", Tone.NEUTRAL, null)
        board.generatedAt != null -> {
            val at = siteClockOf(board.generatedAt)
            Quad(counted, "unit terisi · papan final $at", Tone.OK, Pill("Final $at", Tone.OK))
        }
        board.provisional && units.isNotEmpty() ->
            Quad(counted, "unit terisi · line-up sementara", Tone.WARN, Pill("Sementara", Tone.WARN))
        else -> Quad(NO_CODE, "Papan shift ini belum dibuat", Tone.NEUTRAL, null)
    }
    return BoardSummary(
        chip = chip,
        code = code,
        codeIsWord = code == NO_CODE,
        line = line,
        tone = tone,
        badge = badge,
        empty = empty,
        fromSpare = units.count { it.employeeName != null && it.source == "spare" },
        manual = units.count { it.employeeName != null && it.source == "manual" },
    )
}

private data class Quad(val code: String, val line: String, val tone: Tone, val badge: Pill?)

private fun BoardUnit.passes(filter: BoardFilter, inPool: Boolean) = when (filter) {
    BoardFilter.ALL -> true
    BoardFilter.EMPTY -> !inPool && employeeName == null
    BoardFilter.SPARE -> !inPool && employeeName != null && source == "spare"
    BoardFilter.MANUAL -> employeeName != null && source == "manual"
}

/** The formations, Support and the pool, each cut to [filter]; a group left empty is dropped. */
fun boardGroups(board: Board, filter: BoardFilter): List<BoardGroup> = board.fleets.mapNotNull { fleet ->
    val rows = fleet.units
        .filter { it.passes(filter, inPool = !fleet.isSeats()) }
        .map { BoardRow(it.unitCode, it.employeeName, sourcePill(it)) }
    rows.takeIf { it.isNotEmpty() }?.let { BoardGroup(fleet.title(), fleet.area, it) }
}

/** A unit code or part of a name, anywhere on the board. A blank query finds nothing. */
fun searchBoard(board: Board, query: String): List<BoardHit> {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return emptyList()
    return board.fleets.flatMap { fleet ->
        fleet.units
            .filter { it.unitCode.lowercase().contains(needle) || it.employeeName?.lowercase()?.contains(needle) == true }
            .map { BoardHit(it.unitCode, it.employeeName, fleet.where(), sourcePill(it)) }
    }
}
