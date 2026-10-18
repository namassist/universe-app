package id.universe.mobile.domain

/** "Rudi Hartono" → "RH": the avatar on the card and the profile. */
fun initialsOf(name: String): String =
    name.trim().split(Regex("\\s+"))
        .filter { it.isNotEmpty() }
        .take(2)
        .joinToString("") { it.first().uppercase() }
        .ifEmpty { "?" }
