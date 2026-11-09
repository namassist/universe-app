package id.universe.mobile.domain

import id.universe.mobile.api.models.GetV1RosterByIdDays200ResponseRowsInner
import id.universe.mobile.data.RosterDays
import kotlin.test.Test
import kotlin.test.assertEquals

/*
 * "Jadwal roster saya" is the month's codes from the document in force
 * (docs/prd.md, Mobile app → User), the person's own line of each document
 * that carries a day for them.
 */
class RosterTest {
    private fun row(nik: String, codes: List<String>) = GetV1RosterByIdDays200ResponseRowsInner(
        employeeId = "e-$nik",
        nik = nik,
        name = "Rudi Hartono",
        codes = codes,
        corrections = emptyList(),
    )

    private fun document(days: List<String>, vararg rows: GetV1RosterByIdDays200ResponseRowsInner) =
        RosterDays(days = days, rows = rows.toList(), total = rows.size, page = 1, pageSize = 50, summary = emptyList())

    @Test
    fun eachDayTakesThePersonsOwnCode() {
        val doc = document(
            listOf("2026-10-01", "2026-10-02", "2026-10-03"),
            row("10234567", listOf("D", "D", "OFF")),
            row("10239911", listOf("N", "N", "N")),
        )
        assertEquals(
            mapOf("2026-10-01" to "D", "2026-10-02" to "D", "2026-10-03" to "OFF"),
            codesFor("10234567", listOf(doc)),
        )
    }

    @Test
    fun aDayTheDocumentLeavesBlankIsNotADayOff() {
        val doc = document(listOf("2026-10-01", "2026-10-02"), row("10234567", listOf("D", "")))
        assertEquals(mapOf("2026-10-01" to "D"), codesFor("10234567", listOf(doc)))
        assertEquals(emptyMap(), codesFor("10234567", emptyList()))
    }
}
