package id.universe.mobile.domain

import id.universe.mobile.data.ReportRow

/*
 * Laporan on the phone (docs/prd.md, Mobile app; DESIGN.md → Dashboard and
 * Laporan): the web's five reports for one date and shift, view only. Each row
 * is worded from the cells the API fills for that report, its status in the
 * workbook's own words; the workbook download stays on the web.
 */

/** [needsBoard]: made from the board, so empty until it is generated rather than a count of zero. */
enum class ReportKind(val value: String, val title: String, val blurb: String, val needsBoard: Boolean) {
    EQUIPMENT_NO_OPERATOR("equipment-no-operator", "Equipment No Operator", "Unit di papan tanpa operator", needsBoard = true),
    OPERATOR_NO_EQUIPMENT("operator-no-equipment", "Operator No Equipment", "Dijadwalkan, tidak dapat unit", needsBoard = true),
    OPERATOR_NO_FTW("operator-no-ftw", "Operator No FTW", "Sudah finger, FTW belum lolos", needsBoard = false),
    OPERATOR_NO_FINGER("operator-no-finger", "Operator No Finger", "Belum finger, atau terlambat", needsBoard = false),
    FINAL_VALIDATION("final-validation", "Final Validation", "Setiap operator dan unit akhirnya", needsBoard = true),
}

fun reportKindOf(value: String): ReportKind? = ReportKind.entries.firstOrNull { it.value == value }

data class ReportLine(val title: String, val note: String, val badge: Pill?)

/** The API's own words (contracts `NO_FINGER_LABEL`, `SPARE_UNIT_LABEL`). */
private const val NO_FINGER = "No Finger"
private const val SPARE = "SPARE"

private fun notes(vararg cells: String?): String =
    cells.filterNot { it.isNullOrBlank() }.joinToString(" · ")

private fun nikOf(row: ReportRow): String? = row.nik?.takeIf { it.isNotBlank() }?.let { "NIK $it" }

fun reportLine(kind: ReportKind, row: ReportRow): ReportLine = when (kind) {
    ReportKind.EQUIPMENT_NO_OPERATOR ->
        ReportLine(row.unit.orEmpty(), notes(row.fleet, row.location), Pill("Kosong", Tone.BAD))
    ReportKind.OPERATOR_NO_EQUIPMENT ->
        ReportLine(row.name.orEmpty(), notes(nikOf(row), row.position, row.simperMatrix), Pill("Tanpa unit", Tone.WARN))
    ReportKind.OPERATOR_NO_FTW ->
        ReportLine(row.name.orEmpty(), notes(nikOf(row), row.position), row.saveraStatus?.let { Pill(it, Tone.WARN) })
    ReportKind.OPERATOR_NO_FINGER -> ReportLine(
        row.name.orEmpty(),
        notes(nikOf(row), row.position),
        when (val jam = row.jamIn) {
            null -> null
            NO_FINGER -> Pill(NO_FINGER, Tone.BAD)
            else -> Pill("Tap $jam", Tone.WARN)
        },
    )
    ReportKind.FINAL_VALIDATION -> {
        val spare = row.unit == SPARE
        ReportLine(
            row.name.orEmpty(),
            /* A spare stood nowhere: say when they came instead. */
            if (spare) {
                notes(nikOf(row), row.jamIn?.let { if (it == NO_FINGER) it else "tap $it" })
            } else {
                notes(nikOf(row), row.fleet, row.location)
            },
            row.unit?.let { Pill(it, if (spare) Tone.WARN else Tone.INFO) },
        )
    }
}

/** The rows a search finds, by name, NIK or unit, in the API's order. */
fun reportLines(kind: ReportKind, rows: List<ReportRow>, query: String): List<ReportLine> {
    val needle = query.trim().lowercase()
    return rows
        .filter { row -> needle.isEmpty() || listOf(row.name, row.nik, row.unit).any { it?.lowercase()?.contains(needle) == true } }
        .map { reportLine(kind, it) }
}

/** A report's row count beside its name: a shortfall wants attention, the final board is everyone. */
fun countPill(kind: ReportKind, count: Int): Pill = Pill(
    "$count",
    when {
        kind == ReportKind.FINAL_VALIDATION -> Tone.INFO
        count == 0 -> Tone.OK
        kind == ReportKind.EQUIPMENT_NO_OPERATOR -> Tone.BAD
        else -> Tone.WARN
    },
)
