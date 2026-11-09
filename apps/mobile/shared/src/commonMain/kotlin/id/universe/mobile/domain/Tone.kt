package id.universe.mobile.domain

/** A status hue. It is never shown without a word (DESIGN.md, The Word Beside the Colour Rule). */
enum class Tone { OK, WARN, BAD, INFO, NEUTRAL }

/** A word and its hue: a badge, a status pill. */
data class Pill(val text: String, val tone: Tone)

/** A sentence in a callout. `**…**` marks the words set in bold. */
data class Callout(val text: String, val tone: Tone)
