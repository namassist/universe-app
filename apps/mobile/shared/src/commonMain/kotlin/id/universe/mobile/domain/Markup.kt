package id.universe.mobile.domain

/** A stretch of a sentence, bold or not. */
data class Run(val text: String, val bold: Boolean)

/**
 * A callout's sentence split on its `**…**` marks. A mark left open is
 * printed as written rather than swallowing the rest of the sentence.
 */
fun boldRuns(text: String): List<Run> {
    val runs = mutableListOf<Run>()
    var at = 0
    while (at < text.length) {
        val open = text.indexOf("**", at)
        val close = if (open < 0) -1 else text.indexOf("**", open + 2)
        if (open < 0 || close < 0) {
            runs += Run(text.substring(at), false)
            break
        }
        if (open > at) runs += Run(text.substring(at, open), false)
        runs += Run(text.substring(open + 2, close), true)
        at = close + 2
    }
    return runs
}
