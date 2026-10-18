package id.universe.mobile.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class PersonTest {
    @Test
    fun initialsAreTheFirstTwoNames() {
        assertEquals("RH", initialsOf("Rudi Hartono"))
        assertEquals("SR", initialsOf("  siti   rahmawati putri "))
        assertEquals("A", initialsOf("Agus"))
        assertEquals("?", initialsOf(" "))
    }

    @Test
    fun aSimperExpiryReadsAsADate() {
        assertEquals("12 Mar 2027", dayMonthYear("2027-03-12"))
    }
}
