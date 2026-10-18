package id.universe.mobile.domain

import id.universe.mobile.data.RosterDays

/**
 * The person's code for each day, from their own line of every document in
 * force that carries one. A blank cell is a day the document does not set,
 * which is not a day off.
 */
fun codesFor(nik: String, documents: List<RosterDays>): Map<String, String> = buildMap {
    for (document in documents) {
        val row = document.rows.firstOrNull { it.nik == nik } ?: continue
        document.days.zip(row.codes).forEach { (date, code) -> if (code.isNotBlank()) put(date, code) }
    }
}
