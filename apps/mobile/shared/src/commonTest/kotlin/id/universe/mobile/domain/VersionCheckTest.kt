package id.universe.mobile.domain

import kotlin.test.Test
import kotlin.test.assertEquals

/*
 * A sideloaded build asks the API each time it opens (docs/prd.md, Mobile
 * app → Client stack): below the minimum it is blocked, below the latest it
 * is told, and with nothing configured it carries on.
 */
class VersionCheckTest {
    private val url = "https://universe.example/universe.apk"

    @Test
    fun belowTheMinimumIsBlocked() {
        assertEquals(VersionVerdict.Unsupported(url), versionVerdict(3, 4.0, 6.0, url))
    }

    @Test
    fun belowTheLatestIsToldOnce() {
        assertEquals(VersionVerdict.UpdateAvailable(url), versionVerdict(5, 4.0, 6.0, url))
    }

    @Test
    fun theLatestCarriesOn() {
        assertEquals(VersionVerdict.Current, versionVerdict(6, 4.0, 6.0, url))
    }

    @Test
    fun nothingConfiguredCarriesOn() {
        assertEquals(VersionVerdict.Current, versionVerdict(1, null, null, null))
    }
}
