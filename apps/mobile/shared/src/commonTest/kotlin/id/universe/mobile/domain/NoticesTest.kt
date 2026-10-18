package id.universe.mobile.domain

import id.universe.mobile.data.Notice
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/*
 * The list words each row from its kind, in the sentences the API pushes
 * (`pushText` in apps/api/src/person-notify.ts), so the lock screen and the
 * list never say two things.
 */
class NoticesTest {
    private fun notice(kind: String, unit: String = "DT5102") = Notice(
        id = "n1",
        kind = kind,
        date = "2026-10-18",
        shift = "day",
        params = mapOf(
            "unit" to JsonPrimitive(unit),
            "area" to JsonPrimitive("PIT 1 UTARA"),
            "bus" to JsonPrimitive("BUS 03"),
            "fleet" to JsonNull,
        ),
        availableAt = "2026-10-17T21:28:00.000Z",
        readAt = null,
    )

    @Test
    fun aSeatNamesTheUnitAreaAndBus() {
        val words = noticeWords(notice("seat-assigned"))
        assertEquals("Unit kamu: DT5102", words.title)
        assertEquals("Shift siang 18 Okt · Area PIT 1 UTARA · Bus BUS 03", words.body)
    }

    @Test
    fun aSeatTakenBackSaysSo() {
        val words = noticeWords(notice("seat-removed", unit = "DT3321"))
        assertEquals("Penempatan berubah", words.title)
        assertEquals("Kamu tidak lagi di DT3321 untuk shift siang 18 Okt.", words.body)
    }

    @Test
    fun aKindThisBuildDoesNotKnowStillShows() {
        val words = noticeWords(notice("board-moved"))
        assertEquals("Pemberitahuan", words.title)
        assertEquals("Perbarui aplikasi untuk membaca pemberitahuan ini.", words.body)
    }

    @Test
    fun aNoticeIsTimedOnTheSiteClock() {
        /* 21:28Z is 05:28 WITA the next day. */
        assertEquals("05:28", noticeWhen("2026-10-17T21:28:00.000Z", today = "2026-10-18"))
        assertEquals("Kemarin", noticeWhen("2026-10-16T21:28:00.000Z", today = "2026-10-18"))
        assertEquals("15 Okt", noticeWhen("2026-10-14T21:28:00.000Z", today = "2026-10-18"))
    }
}
