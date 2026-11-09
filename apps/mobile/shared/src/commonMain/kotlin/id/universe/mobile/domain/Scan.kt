package id.universe.mobile.domain

import id.universe.mobile.data.IdCard
import io.ktor.http.Url
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * What a scanned QR code means, before anything is fetched: the web scanner's
 * rules (apps/web/components/menus/scan-id-rules.ts), so a card reads the same
 * at the gate on the phone as in the browser.
 */

/** ASCII digits only (the web's `\D`), then leading zeros off: the recipe every source is matched by. */
private fun plainNik(value: String): String? {
    val digits = value.filter { it in '0'..'9' }
    if (digits.isEmpty()) return null
    return digits.trimStart('0').ifEmpty { digits }
}

/* Strict, as the web's `JSON.parse`; built once, since the camera asks many times a second. */
private val strict = Json
private val LINK = Regex("^https?://", RegexOption.IGNORE_CASE)

/**
 * The NIK a scanned code carries: a JSON payload naming a `nik`, then a link's
 * parameter or last path segment, then the digits themselves. Asking what the
 * payload calls the NIK first keeps a port, a version or a date out of it.
 * Null when there is no number at all.
 */
fun nikOfScan(raw: String): String? {
    val text = raw.trim()
    if (text.isEmpty()) return null

    if (text.startsWith("{")) {
        val payload = try {
            strict.parseToJsonElement(text) as? JsonObject
        } catch (_: Exception) {
            null
        }
        when (val named = payload?.entries?.firstOrNull { it.key.lowercase() == "nik" }?.value) {
            null, is JsonNull -> Unit
            /* An object or a list is no number: the web reads it as "[object Object]". */
            !is JsonPrimitive -> return null
            else -> return plainNik(named.content)
        }
    }

    if (LINK.containsMatchIn(text)) {
        val url = try {
            Url(text)
        } catch (_: Exception) {
            null
        }
        if (url != null) {
            url.parameters.entries().firstOrNull { it.key.lowercase() == "nik" }?.value?.firstOrNull()
                ?.let { return plainNik(it) }
            return url.segments.lastOrNull { it.isNotEmpty() }?.let(::plainNik)
        }
    }

    return plainNik(text)
}

/** A camera reads the card it is held to many times a second; only a different card asks again. */
fun shouldLookUp(nik: String, showing: String?): Boolean = nik != showing

/** What the muster gave the person on the card, in the order a gate reads it. */
fun cardFacts(card: IdCard): List<Pair<String, String>> {
    val none = "—"
    val roster = card.roster?.let { code ->
        listOfNotNull(code, card.shift?.let { "Shift ${shiftWord(it).lowercase()}" }).joinToString(" · ")
    }
    return listOf(
        "Roster" to (roster ?: none),
        "Unit" to (card.unit ?: "Tidak termasuk alokasi"),
        "Area" to (card.area ?: none),
        "Bus" to (card.bus ?: none),
        "Check-in" to (card.checkInAt ?: "Belum tap"),
    )
}
