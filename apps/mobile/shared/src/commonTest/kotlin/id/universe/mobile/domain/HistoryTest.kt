package id.universe.mobile.domain

import id.universe.mobile.data.AttendanceRow
import id.universe.mobile.data.FtwRow
import id.universe.mobile.data.PastSeat
import kotlin.test.Test
import kotlin.test.assertEquals

class HistoryTest {
    private fun ftw(decision: String?, late: Boolean) = FtwRow(
        nik = "10234567",
        date = "2026-10-15",
        name = "Rudi Hartono",
        company = null,
        department = null,
        position = null,
        mess = null,
        shift = null,
        sleepMinutes = 390,
        sleepCategory = "Dapat Bekerja",
        ftwDecision = decision,
        sentAt = "2026-10-15 05:24:00",
        late = late,
        rosterShift = "day",
        rosterCode = "D",
        employeeStatus = "aktif",
        inductionHold = false,
    )

    @Test
    fun aLateUploadReadsLateWhateverItsDecision() {
        val row = ftwHistoryRow(ftw("FTW aman", late = true))
        assertEquals(Pill("Terlambat", Tone.WARN), row.badge)
        assertEquals("Diunggah 05:24", row.note)
        assertEquals("6 j 30 m", row.figure)
    }

    @Test
    fun theDecisionIsSaveraOwnWordColouredAsTheWebColoursIt() {
        assertEquals(Pill("FTW aman", Tone.OK), ftwHistoryRow(ftw("FTW aman", false)).badge)
        assertEquals(
            Pill("FTW perlu tindak lanjut", Tone.BAD),
            ftwHistoryRow(ftw("FTW perlu tindak lanjut", false)).badge,
        )
        assertEquals(
            Pill("Belum mengisi FTW", Tone.BAD),
            ftwHistoryRow(ftw("Belum mengisi FTW", false)).badge,
        )
        assertEquals(Pill("Belum ada", Tone.NEUTRAL), ftwHistoryRow(ftw(null, false)).badge)
    }

    @Test
    fun aPastSeatSaysHowItWasTaken() {
        val seat = PastSeat(
            date = "2026-10-15",
            shift = "day",
            unit = "DT5110",
            area = null,
            bus = null,
            fleet = null,
            source = "spare",
        )
        val row = seatHistoryRow(seat)
        assertEquals("Kam 15 Okt", row.title)
        assertEquals("Siang", row.note)
        assertEquals("DT5110", row.figure)
        assertEquals(Pill("Spare", Tone.WARN), row.badge)
        assertEquals(Pill("Pegangan", Tone.INFO), seatHistoryRow(seat.copy(source = "plan")).badge)
        assertEquals(Pill("Manual", Tone.WARN), seatHistoryRow(seat.copy(source = "manual")).badge)
    }

    @Test
    fun aFirstTapIsOnTimeOrLateAsTheApiSays() {
        val tap = AttendanceRow(
            nik = "10234567",
            date = "2026-10-17",
            name = null,
            department = null,
            position = null,
            company = null,
            rosterCode = "N",
            firstInAt = "2026-10-17 17:26:00",
            firstInIp = null,
            firstInMachine = null,
            late = true,
        )
        val row = attendanceHistoryRow(tap)
        assertEquals("Malam", row.note)
        assertEquals("17:26", row.figure)
        assertEquals(Pill("Terlambat", Tone.WARN), row.badge)
        assertEquals(Pill("Tepat waktu", Tone.OK), attendanceHistoryRow(tap.copy(late = false)).badge)
        assertEquals(null, attendanceHistoryRow(tap.copy(late = null)).badge)
    }
}
