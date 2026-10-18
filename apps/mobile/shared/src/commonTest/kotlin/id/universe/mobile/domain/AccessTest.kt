package id.universe.mobile.domain

import id.universe.mobile.data.Permissions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/*
 * The app shows a screen when the session holds its menu, never by role name
 * (docs/prd.md, Mobile app): another role given a slug gets the screen
 * without a release.
 */
class AccessTest {
    @Test
    fun anOperatorReadsTheirOwnMuster() {
        val access = accessOf(Permissions(rosterData = "view", attendance = "view"))
        assertEquals(HomeKind.OPERATOR, access.home)
        assertEquals(
            listOf(NavItem.HOME, NavItem.JADWAL, NavItem.KARTU, NavItem.RIWAYAT, NavItem.PROFIL),
            access.nav,
        )
        assertFalse(access.canPlace)
    }

    @Test
    fun theAllocationMenuMakesASupervisorWhoChangesNothing() {
        val access = accessOf(
            Permissions(fleetAllocation = "view", scanId = "view", unitStatus = "view"),
        )
        assertEquals(HomeKind.SUPERVISOR, access.home)
        assertEquals(
            listOf(NavItem.HOME, NavItem.PAPAN, NavItem.SCAN, NavItem.UNIT, NavItem.PROFIL),
            access.nav,
        )
        assertFalse(access.canPlace)
    }

    @Test
    fun managingTheAllocationPlacesByHand() {
        val access = accessOf(
            Permissions(
                fleetAllocation = "manage",
                scanId = "manage",
                timeline = "manage",
                users = "manage",
                unitStatus = "manage",
            ),
        )
        assertEquals(HomeKind.ADMIN, access.home)
        assertEquals(
            listOf(NavItem.HOME, NavItem.PAPAN, NavItem.SCAN, NavItem.TIMELINE, NavItem.AKUN),
            access.nav,
        )
        assertTrue(access.canPlace)
    }

    @Test
    fun aMenuNotHeldIsNotOffered() {
        val access = accessOf(Permissions(fleetAllocation = "view"))
        assertEquals(listOf(NavItem.HOME, NavItem.PAPAN, NavItem.PROFIL), access.nav)
    }
}
