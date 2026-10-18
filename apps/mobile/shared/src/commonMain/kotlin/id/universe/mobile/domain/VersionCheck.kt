package id.universe.mobile.domain

/*
 * A sideloaded app does not update itself, so it asks the API each time it
 * opens (docs/prd.md, Mobile app → Client stack). The three answers are
 * server configuration, so a release needs no code change.
 */
sealed interface VersionVerdict {
    data object Current : VersionVerdict

    /** Older than the latest: a dismissable "Versi baru tersedia". */
    data class UpdateAvailable(val downloadUrl: String?) : VersionVerdict

    /** Below the minimum: blocked with a download button. */
    data class Unsupported(val downloadUrl: String?) : VersionVerdict
}

fun versionVerdict(build: Int, minimum: Double?, latest: Double?, downloadUrl: String?): VersionVerdict =
    when {
        minimum != null && build < minimum -> VersionVerdict.Unsupported(downloadUrl)
        latest != null && build < latest -> VersionVerdict.UpdateAvailable(downloadUrl)
        else -> VersionVerdict.Current
    }
