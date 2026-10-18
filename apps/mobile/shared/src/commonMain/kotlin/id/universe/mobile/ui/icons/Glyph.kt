package id.universe.mobile.ui.icons

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The prototype's stroke glyphs (apps/mobile/prototype/index.html, `I`), on a
 * 24-unit grid. Circles and rectangles are written as the paths they draw, so
 * every glyph is one path string. No icon library (docs/prd.md, Mobile app).
 */
private const val RECT_5_TO_21 = "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
private const val RING_9 = "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"

enum class Glyph(val path: String) {
    HOME("M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"),
    CALENDAR("${RECT_5_TO_21}M3 10h18M8 3v4M16 3v4"),
    RECEIPT("M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"),
    USER("M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0"),
    QR(
        "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" +
            "M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
    ),
    SCAN(
        "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
    ),
    TRUCK("M3 16V8h10v8M13 11h4l3 3v2h-7M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0"),
    BOARD("M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 10v10"),
    BELL("M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"),
    HELP("${RING_9}M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"),
    HEART("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"),
    FINGER("M8 11a4 4 0 0 1 8 0v2M6 13a6 6 0 0 1 12 0v1M10 21v-9a2 2 0 0 1 4 0v4M12 7a6 6 0 0 0-6 6"),
    CARD("M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 10h8M8 14h5"),
    CHEVRON("m9 18 6-6-6-6"),
    BACK("m15 18-6-6 6-6"),
    LOCK("M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4"),
    INFO("${RING_9}M12 11v5M12 8h.01"),
    WARN("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"),
    CHECK("M20 6 9 17l-5-5"),
    CHART("M3 3v18h18M7 15l4-4 3 3 5-6"),
    DOC("M6 3h9l4 4v14H6zM9 13h7M9 17h5"),
    TIMELINE(
        "M6 4v16M6 8h8M6 14h12M4.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M4.5 14a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
    ),
    PEOPLE("M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2"),
    PLAN("M4 6h16M4 12h16M4 18h10"),
    SEARCH("M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0m16 9-3.5-3.5"),
    ARROW("M5 12h14M13 6l6 6-6 6"),
    CLOSE("M6 6l12 12M18 6 6 18"),
}

/** A glyph drawn in [tint]; decorative, so it says nothing to a screen reader. */
@Composable
fun GlyphIcon(glyph: Glyph, tint: Color, modifier: Modifier = Modifier, size: Dp = 22.dp, stroke: Float = 2f) {
    val vector = remember(glyph, stroke) {
        ImageVector.Builder(
            name = glyph.name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).addPath(
            pathData = addPathNodes(glyph.path),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = stroke,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        ).build()
    }
    Image(
        painter = rememberVectorPainter(vector),
        contentDescription = null,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}
