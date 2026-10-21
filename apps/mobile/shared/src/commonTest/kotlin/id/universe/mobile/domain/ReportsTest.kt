package id.universe.mobile.domain

import id.universe.mobile.data.ReportRow
import kotlin.test.Test
import kotlin.test.assertEquals

/*
 * Laporan on the phone (docs/prd.md, Mobile app; DESIGN.md → Dashboard and
 * Laporan): the five reports, view only, each row worded from the cells the
 * API fills for that report, with its words as the workbook spells them.
 */
class ReportsTest {
    private val eko = ReportRow(nik = "10241276", name = "Eko Wahyudi", position = "Operator DT")

    @Test
    fun theFiveReportsAreListedInTheWebsOrder() {
        assertEquals(
            listOf(
                "equipment-no-operator",
                "operator-no-equipment",
                "operator-no-ftw",
                "operator-no-finger",
                "final-validation",
            ),
            ReportKind.entries.map { it.value },
        )
    }

    @Test
    fun anEmptySeatReadsItsUnitWhereItStands() {
        val line = reportLine(
            ReportKind.EQUIPMENT_NO_OPERATOR,
            ReportRow(unit = "DT4130", fleet = "EX1211", location = "PIT 2 TIMUR", bus = ""),
        )
        assertEquals(ReportLine("DT4130", "EX1211 · PIT 2 TIMUR", Pill("Kosong", Tone.BAD)), line)
    }

    @Test
    fun anOperatorWithNoUnitShowsTheLicencesTheyHold() {
        val line = reportLine(ReportKind.OPERATOR_NO_EQUIPMENT, eko.copy(simperMatrix = "A2B; HD785"))
        assertEquals(ReportLine("Eko Wahyudi", "NIK 10241276 · Operator DT · A2B; HD785", Pill("Tanpa unit", Tone.WARN)), line)
    }

    @Test
    fun anFtwThatDidNotPassReadsSaverasStatus() {
        val line = reportLine(ReportKind.OPERATOR_NO_FTW, eko.copy(saveraStatus = "Terlambat FTW (05:31)"))
        assertEquals(ReportLine("Eko Wahyudi", "NIK 10241276 · Operator DT", Pill("Terlambat FTW (05:31)", Tone.WARN)), line)
    }

    @Test
    fun noTapReadsNoFingerAndALateTapReadsItsTime() {
        assertEquals(Pill("No Finger", Tone.BAD), reportLine(ReportKind.OPERATOR_NO_FINGER, eko.copy(jamIn = "No Finger")).badge)
        assertEquals(Pill("Tap 05:31", Tone.WARN), reportLine(ReportKind.OPERATOR_NO_FINGER, eko.copy(jamIn = "05:31")).badge)
    }

    @Test
    fun theFinalBoardReadsTheUnitOrSpare() {
        val placed = reportLine(
            ReportKind.FINAL_VALIDATION,
            eko.copy(unit = "DT4084", fleet = "EX1203", location = "PIT 3 SELATAN", jamIn = "05:10"),
        )
        assertEquals(ReportLine("Eko Wahyudi", "NIK 10241276 · EX1203 · PIT 3 SELATAN", Pill("DT4084", Tone.INFO)), placed)
        val spare = reportLine(ReportKind.FINAL_VALIDATION, eko.copy(unit = "SPARE", fleet = "", location = "", jamIn = "05:03"))
        assertEquals(ReportLine("Eko Wahyudi", "NIK 10241276 · tap 05:03", Pill("SPARE", Tone.WARN)), spare)
    }

    @Test
    fun aRowIsFoundByNameNikOrUnit() {
        val rows = listOf(
            eko.copy(unit = "DT4084"),
            ReportRow(nik = "10233054", name = "Rizki Maulana", unit = "SPARE"),
        )
        val find = { query: String -> reportLines(ReportKind.FINAL_VALIDATION, rows, query).map { it.title } }
        assertEquals(listOf("Eko Wahyudi", "Rizki Maulana"), find(""))
        assertEquals(listOf("Rizki Maulana"), find(" rizki "))
        assertEquals(listOf("Eko Wahyudi"), find("41276"))
        assertEquals(listOf("Eko Wahyudi"), find("dt4084"))
    }

    @Test
    fun theReportsMadeFromTheBoardWaitForIt() {
        assertEquals(
            listOf(ReportKind.EQUIPMENT_NO_OPERATOR, ReportKind.OPERATOR_NO_EQUIPMENT, ReportKind.FINAL_VALIDATION),
            ReportKind.entries.filter { it.needsBoard },
        )
    }

    @Test
    fun aCountSaysHowManyAndWhetherItWants() {
        assertEquals(Pill("4", Tone.BAD), countPill(ReportKind.EQUIPMENT_NO_OPERATOR, 4))
        assertEquals(Pill("6", Tone.WARN), countPill(ReportKind.OPERATOR_NO_FTW, 6))
        assertEquals(Pill("0", Tone.OK), countPill(ReportKind.OPERATOR_NO_FINGER, 0))
        /* The final board is a list of everyone, not a shortfall. */
        assertEquals(Pill("289", Tone.INFO), countPill(ReportKind.FINAL_VALIDATION, 289))
    }
}
