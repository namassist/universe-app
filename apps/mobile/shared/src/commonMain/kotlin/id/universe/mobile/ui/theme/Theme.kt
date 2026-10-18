package id.universe.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import id.universe.mobile.resources.Res
import id.universe.mobile.resources.figtree
import org.jetbrains.compose.resources.Font

/*
 * apps/mobile/DESIGN.md, token for token. One action colour per theme; navy
 * belongs to the hero band in both; status hues only ever beside a word.
 */

@Immutable
class Palette(
    val ground: Color,
    val surface: Color,
    val sunken: Color,
    val line: Color,
    val ink: Color,
    val inkMuted: Color,
    val inkFaint: Color,
    val action: Color,
    val actionInk: Color,
    val actionSoft: Color,
    val hero: Color,
    val heroLow: Color,
    val heroText: Color,
    val heroTextMuted: Color,
    val brand: Color,
    val ok: Color,
    val okSoft: Color,
    val warn: Color,
    val warnSoft: Color,
    val bad: Color,
    val badSoft: Color,
    /** The ambient lift: one shadow shared by every content surface. */
    val lift: List<Shadow>,
    val dark: Boolean,
)

val LightPalette = Palette(
    ground = Color(0xFFF2F4F7),
    surface = Color(0xFFFFFFFF),
    sunken = Color(0xFFEDF0F4),
    line = Color(0xFFDCE2EA),
    ink = Color(0xFF0B1220),
    inkMuted = Color(0xFF46536A),
    inkFaint = Color(0xFF5F6B80),
    action = Color(0xFF0057D9),
    actionInk = Color(0xFFFFFFFF),
    actionSoft = Color(0xFFE3EDFF),
    hero = Color(0xFF0A2A63),
    heroLow = Color(0xFF0F3A86),
    heroText = Color(0xFFFFFFFF),
    heroTextMuted = Color(0xFFC9D6F0),
    brand = Color(0xFF00C0FF),
    ok = Color(0xFF157A3E),
    okSoft = Color(0xFFE1F4E8),
    warn = Color(0xFF9A5B00),
    warnSoft = Color(0xFFFDF0D9),
    bad = Color(0xFFB42323),
    badSoft = Color(0xFFFBE4E4),
    lift = listOf(
        Shadow(radius = 18.dp, color = Color(0x140B1220), offset = DpOffset(0.dp, 6.dp)),
        Shadow(radius = 3.dp, color = Color(0x0F0B1220), offset = DpOffset(0.dp, 1.dp)),
    ),
    dark = false,
)

val DarkPalette = Palette(
    ground = Color(0xFF111214),
    surface = Color(0xFF1B1C1F),
    sunken = Color(0xFF26282C),
    line = Color(0xFF34373C),
    ink = Color(0xFFEEF2F8),
    inkMuted = Color(0xFFA9B4C8),
    inkFaint = Color(0xFF8E9AB0),
    action = Color(0xFF00C8FF),
    actionInk = Color(0xFF031020),
    actionSoft = Color(0xFF0D2A45),
    hero = Color(0xFF0A2257),
    heroLow = Color(0xFF0E2F72),
    heroText = Color(0xFFFFFFFF),
    heroTextMuted = Color(0xFFB7C6E6),
    brand = Color(0xFF00C0FF),
    ok = Color(0xFF4ADE80),
    okSoft = Color(0xFF0E2A1B),
    warn = Color(0xFFFBBF24),
    warnSoft = Color(0xFF2E2208),
    bad = Color(0xFFF87171),
    badSoft = Color(0xFF321212),
    lift = listOf(
        Shadow(radius = 22.dp, color = Color(0x73000000), offset = DpOffset(0.dp, 8.dp)),
        Shadow(radius = 3.dp, color = Color(0x66000000), offset = DpOffset(0.dp, 1.dp)),
    ),
    dark = true,
)

/** Fixed tints on the navy band, which is navy in both themes. */
object HeroTint {
    val okDot = Color(0xFF34D17A)
    val warnDot = Color(0xFFF5B33C)
    val badDot = Color(0xFFFF6A6A)
    val neutralDot = Color(0xFF9FB0CC)
    val okLine = Color(0xFF8CF0B4)
    val warnLine = Color(0xFFFFD38A)
    /** rgba(3, 10, 30, 0.32), behind a status pill. */
    val pillFill = Color(0x52030A1E)
    /** rgba(3, 10, 30, 0.28), behind a quick action. */
    val quickFill = Color(0x47030A1E)
    val quickEdge = Color(0x8000C0FF)
    val stroke = Color(0x38FFFFFF)
    val chipStroke = Color(0x2EFFFFFF)
    val chipFill = Color(0x1FFFFFFF)
    val buttonFill = Color(0x1AFFFFFF)
    val avatarFill = Color(0x24FFFFFF)
}

/** The raised centre disc's own, heavier drop. */
val RaisedDisc = Shadow(radius = 14.dp, color = Color(0x4703060E), offset = DpOffset(0.dp, 6.dp))

object Corners {
    val sheet = RoundedCornerShape(22.dp)
    val idCard = RoundedCornerShape(24.dp)
    val card = RoundedCornerShape(18.dp)
    val callout = RoundedCornerShape(16.dp)
    val tile = RoundedCornerShape(14.dp)
    val cell = RoundedCornerShape(12.dp)
    val tab = RoundedCornerShape(11.dp)
    val pill = CircleShape
}

@Immutable
class Type(private val family: FontFamily) {
    private fun style(size: Int, weight: Int, line: Float? = null, tabular: Boolean = false, track: Float = 0f) =
        TextStyle(
            fontFamily = family,
            fontSize = size.sp,
            fontWeight = FontWeight(weight),
            lineHeight = line?.let { (size * it).sp } ?: TextStyle.Default.lineHeight,
            letterSpacing = if (track != 0f) track.em else TextStyle.Default.letterSpacing,
            fontFeatureSettings = if (tabular) "tnum" else null,
        )

    /** The hero fact: a unit code, a count, a time. */
    val display = style(48, 800, line = 1f, tabular = true, track = -0.02f)
    /** A word in the hero's place (SPARE): a size down. */
    val displayWord = style(40, 800, line = 1f, tabular = true, track = -0.02f)
    /** The unit on "Unit saya". */
    val displayCard = style(52, 800, line = 1f, tabular = true, track = -0.02f)
    val headline = style(21, 800)
    val sheetTitle = style(20, 800)
    val title = style(18, 800)
    val name = style(19, 700)
    val emphasis = style(17, 700)
    val code = style(16, 800, tabular = true, track = 0.01f)
    val bodyStrong = style(15, 700)
    val statusLine = style(15, 600, line = 1.35f)
    val field = style(17, 400)
    val callout = style(14, 400, line = 1.45f)
    val linkLine = style(14, 600)
    val chip = style(13, 600)
    val body = style(13, 400, line = 1.5f)
    val label = style(12, 600, line = 1.25f)
    val badge = style(12, 700)
    val button = style(16, 800)
    val buttonSmall = style(14, 700)
    val brand = style(17, 800, track = 0.08f)
    val factTime = style(20, 800, tabular = true, track = 0.01f)
    val clock = style(15, 800, tabular = true, track = 0.01f)
    val avatar = style(22, 800)
}

private val LocalPalette = staticCompositionLocalOf { LightPalette }
private val LocalType = staticCompositionLocalOf { Type(FontFamily.Default) }

object Theme {
    val palette: Palette
        @Composable get() = LocalPalette.current
    val type: Type
        @Composable get() = LocalType.current
}

/** Figtree, the one family (DESIGN.md → Typography). The TTF is the variable font, set per weight. */
@OptIn(ExperimentalTextApi::class)
@Composable
private fun figtree(): FontFamily {
    val fonts = listOf(400, 600, 700, 800).map { weight ->
        Font(
            Res.font.figtree,
            FontWeight(weight),
            FontStyle.Normal,
            FontVariation.Settings(FontVariation.weight(weight)),
        )
    }
    return remember(fonts) { FontFamily(fonts) }
}

@Composable
fun UniverseTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) DarkPalette else LightPalette
    val family = figtree()
    val type = remember(family) { Type(family) }
    CompositionLocalProvider(
        LocalPalette provides palette,
        LocalType provides type,
        LocalTextSelectionColors provides TextSelectionColors(palette.action, palette.action.copy(alpha = 0.35f)),
        content = content,
    )
}

/** The One Lift Rule: content surfaces share one ambient shadow. */
fun Modifier.lift(shape: Shape, palette: Palette): Modifier =
    palette.lift.fold(this) { modifier, shadow -> modifier.dropShadow(shape, shadow) }
