package id.universe.mobile.domain

import id.universe.mobile.data.IdCard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/* The same readings as the web's scanner (apps/web/components/menus/scan-id-rules.ts). */
class ScanTest {
    @Test
    fun aBareNumberIsTheNik() {
        assertEquals("10234567", nikOfScan("10234567"))
        assertEquals("10234567", nikOfScan(" 0010234567 "))
        /* All zeros keeps its digits, as on the web: a strange NIK, not "no NIK". */
        assertEquals("000", nikOfScan("000"))
    }

    @Test
    fun aJsonPayloadIsAskedForItsNik() {
        assertEquals("10234567", nikOfScan("""{"name":"Rudi","NIK":"10234567","v":2}"""))
        assertEquals("10234567", nikOfScan("""{"nik":10234567}"""))
    }

    @Test
    fun aNikThatIsNotAValueNamesNobody() {
        /* The web reads `String({...})` as "[object Object]": no digits, no card,
           never the digits of the rest of the payload. */
        assertNull(nikOfScan("""{"nik":{"a":1},"v":2}"""))
        assertNull(nikOfScan("""{"nik":[1,2],"v":3}"""))
        /* A null nik names nothing, so the reading falls through to the digits, as on the web. */
        assertEquals("77", nikOfScan("""{"nik":null,"id":"77"}"""))
    }

    @Test
    fun onlyAsciiDigitsCount() {
        assertNull(nikOfScan("١٢٣"))
    }

    @Test
    fun aLinkIsReadByItsParameterOrItsLastSegment() {
        assertEquals("10234567", nikOfScan("https://card.example.id:8443/v2/scan?nik=10234567&t=20261019"))
        assertEquals("10234567", nikOfScan("http://card.example.id/people/10234567"))
    }

    @Test
    fun aCodeWithNoNumberIsNotACard() {
        assertNull(nikOfScan("https://example.id/promo"))
        assertNull(nikOfScan("halo"))
        assertNull(nikOfScan(""))
    }

    @Test
    fun onlyADifferentCardAsksAgain() {
        assertTrue(shouldLookUp("10234567", null))
        assertFalse(shouldLookUp("10234567", "10234567"))
    }

    @Test
    fun theCardSaysWhatTheMusterGaveThem() {
        val card = IdCard(
            nik = "10234567",
            name = "Rudi Hartono",
            photoFile = null,
            department = "MINING OPERATION",
            position = "Operator DT",
            simper = listOf("A2B"),
            shift = "day",
            roster = "D",
            unit = "DT5102",
            area = "PIT 1 UTARA",
            bus = "BUS 03",
            checkInAt = "05:03:41",
        )
        assertEquals(
            listOf(
                "Roster" to "D · Shift siang",
                "Unit" to "DT5102",
                "Area" to "PIT 1 UTARA",
                "Bus" to "BUS 03",
                "Check-in" to "05:03:41",
            ),
            cardFacts(card),
        )
        assertEquals(
            listOf("Roster" to "—", "Unit" to "Tidak termasuk alokasi", "Area" to "—", "Bus" to "—", "Check-in" to "Belum tap"),
            cardFacts(card.copy(roster = null, shift = null, unit = null, area = null, bus = null, checkInAt = null)),
        )
    }
}
