package id.universe.mobile.domain

import id.universe.mobile.data.Permissions

/*
 * What the session may see, from its menu grants and never from its role's
 * name (docs/prd.md, Mobile app): "User / Pengawas Lapangan / Superadmin" are
 * three sets of grants, so another role given a slug gets its screen without
 * a release.
 */

enum class HomeKind { OPERATOR, SUPERVISOR, ADMIN }

enum class NavItem(val label: String, val center: Boolean = false) {
    HOME("Beranda"),
    JADWAL("Jadwal"),
    KARTU("Kartu", center = true),
    RIWAYAT("Riwayat"),
    PROFIL("Profil"),
    PAPAN("Papan"),
    SCAN("Scan ID", center = true),
    UNIT("Unit"),
    TIMELINE("Timeline"),
    AKUN("Akun"),
}

data class Access(val home: HomeKind, val nav: List<NavItem>, val canPlace: Boolean)

private const val MANAGE = "manage"
private const val NAV_SLOTS = 5

fun accessOf(permissions: Permissions): Access {
    val board = permissions.fleetAllocation
        ?: return Access(
            HomeKind.OPERATOR,
            listOf(NavItem.HOME, NavItem.JADWAL, NavItem.KARTU, NavItem.RIWAYAT, NavItem.PROFIL),
            canPlace = false,
        )
    /* Placing somebody by hand is `manage` on the allocation, the same grant
       the web's Actual tab asks for. */
    val places = board == MANAGE
    val nav = buildList {
        add(NavItem.HOME)
        add(NavItem.PAPAN)
        if (permissions.scanId != null) add(NavItem.SCAN)
        if (places) {
            if (permissions.timeline != null) add(NavItem.TIMELINE)
            if (permissions.users == MANAGE) add(NavItem.AKUN)
        } else if (permissions.unitStatus != null) {
            add(NavItem.UNIT)
        }
        if (size < NAV_SLOTS) add(NavItem.PROFIL)
    }
    return Access(if (places) HomeKind.ADMIN else HomeKind.SUPERVISOR, nav, places)
}
