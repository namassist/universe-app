package id.universe.mobile.domain

import id.universe.mobile.data.Notice
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

data class NoticeWords(val title: String, val body: String)

private fun JsonElement?.text(): String? =
    (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

/**
 * A personal notice in the words the API pushes it with (`pushText`,
 * apps/api/src/person-notify.ts), so the lock screen and this list agree. A
 * kind this build does not know still shows, as a request to update.
 */
fun noticeWords(notice: Notice): NoticeWords {
    val unit = notice.params["unit"].text() ?: "-"
    val whenText = "${shiftWord(notice.shift).lowercase()} ${dayMonth(notice.date)}"
    return when (notice.kind) {
        "seat-assigned" -> NoticeWords(
            "Unit kamu: $unit",
            listOfNotNull(
                "Shift $whenText",
                notice.params["area"].text()?.let { "Area $it" },
                notice.params["bus"].text()?.let { "Bus $it" },
            ).joinToString(" · "),
        )
        "seat-removed" -> NoticeWords(
            "Penempatan berubah",
            "Kamu tidak lagi di $unit untuk shift $whenText.",
        )
        else -> NoticeWords("Pemberitahuan", "Perbarui aplikasi untuk membaca pemberitahuan ini.")
    }
}

/** When it came due, on the site's clock: a time today, "Kemarin", else the date. */
fun noticeWhen(availableAt: String, today: String): String {
    val date = siteDateOf(availableAt)
    return when (date) {
        today -> siteClockOf(availableAt)
        shiftDay(today, -1) -> "Kemarin"
        else -> dayMonth(date)
    }
}
