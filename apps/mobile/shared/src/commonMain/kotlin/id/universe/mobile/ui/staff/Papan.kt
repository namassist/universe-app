package id.universe.mobile.ui.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.Board
import id.universe.mobile.domain.BoardFilter
import id.universe.mobile.domain.BoardGroup
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.boardGroups
import id.universe.mobile.domain.boardSummary
import id.universe.mobile.domain.dayLabel
import id.universe.mobile.domain.searchBoard
import id.universe.mobile.domain.shiftWord
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.Failure
import id.universe.mobile.ui.components.InnerList
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.block
import id.universe.mobile.ui.components.groupRows
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.StaleNote
import id.universe.mobile.ui.components.Tabs
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme

/**
 * Papan ACTUAL: who holds which unit, per formation, Support and the pool of
 * spares, as the fleet wall shows it. Read only here; a hand placement is the
 * Superadmin's (S6).
 */
@Composable
fun PapanScreen(
    board: LoadHandle<Board>,
    initialFilter: String,
    onBack: () -> Unit,
    /** Set for a session that manages the allocation: an empty unit offers "Isi". */
    onPlace: ((unitId: String, unitCode: String) -> Unit)? = null,
) {
    var filter by rememberSaveable {
        mutableStateOf(BoardFilter.entries.firstOrNull { it.name == initialFilter } ?: BoardFilter.ALL)
    }
    InnerScreen("Papan ACTUAL", onBack) {
        Loaded(board) { shown ->
            val summary = boardSummary(shown)
            StaleNote(board)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val date = shown.date
                Note(
                    if (date != null) "${dayLabel(date)} · Shift ${shown.shift?.let(::shiftWord) ?: "-"}" else summary.line,
                )
                summary.badge?.let { Badge(it) }
            }
            Tabs(BoardFilter.entries.map { it to it.label }, filter, { filter = it })
            val groups = boardGroups(shown, filter)
            if (groups.isEmpty()) {
                Note(
                    when {
                        summary.badge == null -> summary.line
                        filter == BoardFilter.EMPTY -> "Tidak ada unit kosong."
                        filter == BoardFilter.SPARE -> "Tidak ada unit yang diisi dari spare."
                        filter == BoardFilter.MANUAL -> "Tidak ada penempatan manual."
                        else -> "Papan belum berisi unit."
                    },
                )
            }
            val emptyUnits = shown.fleets.flatMap { it.units }.filter { it.employeeName == null }
            val place = onPlace?.takeIf { summary.badge != null && shown.generatedAt != null }
            groups.forEach { group ->
                BoardSection(group) { code ->
                    val unit = emptyUnits.firstOrNull { it.unitCode == code } ?: return@BoardSection
                    place?.invoke(unit.unitId, unit.unitCode)
                }
            }
            Note(
                if (place != null) {
                    "Isi menempatkan operator di unit kosong. Papan tidak dibuat ulang dari sini: penempatan manual akan hilang."
                } else {
                    "Hanya lihat. Penempatan manual dilakukan Superadmin."
                },
            )
        }
    }
}

@Composable
private fun BoardSection(group: BoardGroup, onFill: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row {
            Txt(group.title, Theme.type.code)
            group.area?.let {
                Txt(" · $it", Theme.type.code.copy(fontWeight = FontWeight.W600), color = Theme.palette.inkMuted)
            }
        }
        ListGroup {
            group.rows.forEachIndexed { index, row ->
                if (index > 0) Hairline()
                BoardLine(row.unit, row.name, row.badge, onFill = { onFill(row.unit) }.takeIf { row.name == null })
            }
        }
    }
}

/** A unit code, who holds it or that nobody does, and how it was filled. */
@Composable
internal fun BoardLine(
    unit: String,
    name: String?,
    badge: Pill,
    notes: List<String> = emptyList(),
    onFill: (() -> Unit)? = null,
) {
    ListRow(
        name ?: "Belum ada operator",
        titleColor = if (name == null) Theme.palette.bad else Theme.palette.ink,
        notes = notes,
        leading = { Txt(unit, Theme.type.code, Modifier.width(76.dp), maxLines = 1) },
        chevron = false,
    ) {
        if (onFill != null) {
            ActionButton("Isi", onFill, Modifier.width(64.dp), height = 40.dp)
        } else {
            Badge(badge)
        }
    }
}

/** "Cari": a unit or a person on the running shift's board. */
@Composable
fun CariScreen(board: LoadHandle<Board>, onBack: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val load = board.value
    val shown = (load as? Load.Ready)?.value
    /* "DT" matches most of a site: a lazy list, as Status unit. */
    val hits = remember(shown, query) { shown?.let { searchBoard(it, query) }.orEmpty() }
    InnerList("Cari unit atau operator", onBack) {
        block("search") { SearchField(query, { query = it }, "Kode unit atau nama, mis. DT5102") }
        when {
            load is Load.Failed -> block("failed") { Failure(load.words, board.reload) }
            shown == null -> block("loading") { Note("Memuat…") }
            query.isBlank() -> block("hint") {
                Note("Ketik kode unit atau nama operator. Hasilnya dari papan ACTUAL shift ini.")
            }
            hits.isEmpty() -> block("none") {
                Callout(
                    Callout(
                        "Tidak ada unit atau operator yang cocok dengan “${query.trim()}”. " +
                            "Coba kode unit lengkap, mis. DT4084, atau sebagian nama.",
                        Tone.INFO,
                    ),
                )
            }
            else -> groupRows(hits, key = { "${it.where}/${it.unit}/${it.name}" }) { hit ->
                BoardLine(hit.unit, hit.name, hit.badge, listOf(hit.where))
            }
        }
    }
}

/** A 50px search box with the glyph inset (DESIGN.md → Inputs). */
@Composable
internal fun SearchField(value: String, onValueChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    val style = Theme.type.bodyStrong.copy(fontWeight = FontWeight.W400, color = palette.ink)
    Box(
        modifier
            .fillMaxWidth()
            .height(50.dp)
            .background(palette.surface, Corners.tile)
            .border(1.dp, palette.line, Corners.tile),
    ) {
        GlyphIcon(Glyph.SEARCH, palette.inkFaint, Modifier.align(Alignment.CenterStart).padding(start = 14.dp), size = 18.dp)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 44.dp, end = 16.dp)
                .semantics { contentDescription = hint },
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(palette.action),
            decorationBox = { inner ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Txt(hint, style, color = palette.inkFaint, maxLines = 1)
                    inner()
                }
            },
        )
    }
}
