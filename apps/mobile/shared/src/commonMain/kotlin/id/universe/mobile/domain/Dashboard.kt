package id.universe.mobile.domain

import id.universe.mobile.data.Dashboard
import kotlin.math.roundToInt

/*
 * The phone's Dashboard (docs/prd.md, Mobile app; DESIGN.md → Dashboard and
 * Laporan): fact cards, what needs attention and the per-category counts, no
 * charts. The API sends a section only for the grants the caller holds, so a
 * section it withheld is left out here, never shown as a zero. A figure links
 * only to a screen that lists exactly it.
 */

/** Where a figure opens. */
enum class DashLink { BOARD, UNITS, EMPTY_UNITS_REPORT }

data class DashCard(
    val figure: String,
    val title: String,
    val note: String,
    /** The bar under the figure; null when the figure is not a part of a whole. */
    val percent: Int?,
    val link: DashLink?,
)

/** What a "Perlu perhatian" line is about, for its icon. */
enum class Topic { UNITS, FTW, SIMPER }

data class AttentionLine(val topic: Topic, val title: String, val note: String, val badge: Pill, val link: DashLink?)

data class CategoryLine(val title: String, val note: String)

data class DashboardView(
    val heading: String,
    val cards: List<DashCard>,
    val attention: List<AttentionLine>,
    val categories: List<CategoryLine>,
) {
    val empty: Boolean get() = cards.isEmpty() && attention.isEmpty() && categories.isEmpty()
}

/** The API's SIMPER window (`SIMPER_SOON_DAYS`, routes/dashboard.ts). */
private const val SIMPER_SOON_DAYS = 30

private fun percentOf(part: Int, whole: Int): Int? =
    if (whole > 0) (part * 100.0 / whole).roundToInt() else null

fun dashboardView(data: Dashboard): DashboardView {
    /* The API sends both of today's boards; the cards are about the shift it counted. */
    val board = data.allocation?.firstOrNull { it.shift == data.shift }
    val cards = buildList {
        data.attendance?.let { a ->
            add(DashCard("${a.tapped}/${a.scheduled}", "Sudah finger", "${a.scheduled - a.tapped} belum finger", percentOf(a.tapped, a.scheduled), null))
        }
        data.ftw?.let { f ->
            /* Everyone who owes a filing either passed on time, filed and needs following up, or has not filed. */
            val passed = f.scheduled - f.followUp - f.missing
            add(DashCard("$passed/${f.scheduled}", "FTW lolos", "${f.missing} belum lapor · ${f.followUp} perlu tindak lanjut", percentOf(passed, f.scheduled), null))
        }
        if (data.allocation != null) {
            add(
                if (board == null) {
                    DashCard("—", "Unit terisi", "Papan shift ${shiftWord(data.shift).lowercase()} belum dibuat", null, DashLink.BOARD)
                } else {
                    DashCard("${board.filled}/${board.slots}", "Unit terisi", "Papan dibuat ${siteClockOf(board.generatedAt)}", percentOf(board.filled, board.slots), DashLink.BOARD)
                },
            )
        }
        data.units?.let { u ->
            add(DashCard("${u.active}", "Unit aktif", "${u.breakdown} breakdown · ${u.standby} standby", null, DashLink.UNITS))
        }
    }
    val attention = buildList {
        board?.let { b ->
            val empty = b.slots - b.filled
            if (empty > 0) add(AttentionLine(Topic.UNITS, "$empty unit belum ada operator", "Equipment No Operator", Pill("Kosong", Tone.BAD), DashLink.EMPTY_UNITS_REPORT))
        }
        data.ftw?.takeIf { it.missing > 0 }?.let { f ->
            add(AttentionLine(Topic.FTW, "${f.missing} operator belum lapor FTW", "Dari ${f.scheduled} yang wajib FTW", Pill("FTW", Tone.WARN), null))
        }
        data.simper?.let { s ->
            when {
                s.expired > 0 -> add(AttentionLine(Topic.SIMPER, "${s.expired} SIMPER kedaluwarsa", "${s.soon} lagi habis dalam $SIMPER_SOON_DAYS hari", Pill("SIMPER", Tone.BAD), null))
                s.soon > 0 -> add(AttentionLine(Topic.SIMPER, "${s.soon} SIMPER habis dalam $SIMPER_SOON_DAYS hari", "Belum ada yang kedaluwarsa", Pill("SIMPER", Tone.WARN), null))
            }
        }
    }
    val categories = data.analytics?.operators.orEmpty().map { o ->
        CategoryLine(o.category, "${o.ready} siap · ${o.noFinger} belum finger · ${o.noFtw} belum FTW")
    }
    return DashboardView("${dayLabel(data.date)} · Shift ${shiftWord(data.shift)}", cards, attention, categories)
}
