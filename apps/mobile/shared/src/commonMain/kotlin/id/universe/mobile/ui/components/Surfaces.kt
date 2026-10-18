package id.universe.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Fact
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.boldRuns
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Palette
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift

@Composable
fun Txt(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = Theme.palette.ink,
    maxLines: Int = Int.MAX_VALUE,
    align: TextAlign = TextAlign.Unspecified,
) = BasicText(
    text = text,
    modifier = modifier,
    style = style.copy(color = color, textAlign = align),
    maxLines = maxLines,
    overflow = TextOverflow.Ellipsis,
)

@Composable
fun Txt(text: AnnotatedString, style: TextStyle, modifier: Modifier = Modifier, color: Color = Theme.palette.ink) =
    BasicText(text = text, modifier = modifier, style = style.copy(color = color))

/** Muted 13px: a row's second line, a screen's footnote. */
@Composable
fun Note(text: String, modifier: Modifier = Modifier, align: TextAlign = TextAlign.Unspecified) =
    Txt(text, Theme.type.body, modifier, Theme.palette.inkMuted, align = align)

/** A white group of rows on the ground: 22px corners, the ambient lift. */
@Composable
fun ListGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val palette = Theme.palette
    Column(
        modifier
            .fillMaxWidth()
            .lift(Corners.sheet, palette)
            .background(palette.surface, Corners.sheet)
            .clip(Corners.sheet),
        content = content,
    )
}

/** The 1px line between rows. */
@Composable
fun Hairline() = Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.palette.line))

/** A 38px disc holding a row's glyph. */
@Composable
fun IconDisc(glyph: Glyph) {
    val palette = Theme.palette
    Box(Modifier.size(38.dp).background(palette.sunken, CircleShape), contentAlignment = Alignment.Center) {
        GlyphIcon(glyph, palette.action, size = 20.dp)
    }
}

/**
 * A list row: 64px at least, an optional disc, a primary line and muted
 * lines, then whatever trails it. A row that does nothing is still read as
 * one item.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    notes: List<String> = emptyList(),
    glyph: Glyph? = null,
    titleStyle: TextStyle = Theme.type.bodyStrong,
    titleColor: Color = Theme.palette.ink,
    background: Color = Color.Transparent,
    onClick: (() -> Unit)? = null,
    chevron: Boolean = onClick != null,
    leading: (@Composable () -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val palette = Theme.palette
    val action = if (onClick != null) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else {
        Modifier.semantics(mergeDescendants = true) {}
    }
    Row(
        modifier
            .fillMaxWidth()
            .background(background)
            .then(action)
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        leading?.invoke() ?: glyph?.let { IconDisc(it) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Txt(title, titleStyle, color = titleColor)
            notes.forEach { Txt(it, Theme.type.body, color = palette.inkMuted) }
        }
        trailing()
        if (chevron) GlyphIcon(Glyph.CHEVRON, palette.inkFaint, size = 16.dp)
    }
}

fun toneColors(tone: Tone, palette: Palette): Pair<Color, Color> = when (tone) {
    Tone.OK -> palette.okSoft to palette.ok
    Tone.WARN -> palette.warnSoft to palette.warn
    Tone.BAD -> palette.badSoft to palette.bad
    Tone.INFO -> palette.actionSoft to palette.action
    Tone.NEUTRAL -> palette.sunken to palette.inkMuted
}

/** Status as a word on its soft hue (The Word Beside the Colour Rule). */
@Composable
fun Badge(pill: Pill, modifier: Modifier = Modifier) {
    val (fill, ink) = toneColors(pill.tone, Theme.palette)
    Box(modifier.background(fill, Corners.pill).padding(horizontal = 9.dp, vertical = 4.dp)) {
        Txt(pill.text, Theme.type.badge, color = ink, maxLines = 1)
    }
}

/** A sentence with its `**bold**` words set at 700. */
fun bolded(text: String): AnnotatedString = buildAnnotatedString {
    boldRuns(text).forEach { run ->
        if (run.bold) withStyle(SpanStyle(fontWeight = FontWeight.W700)) { append(run.text) } else append(run.text)
    }
}

/** Info on action-soft in ink; warn and bad on their soft fills in their own ink. */
@Composable
fun Callout(callout: Callout, modifier: Modifier = Modifier, glyph: Glyph? = null) {
    val palette = Theme.palette
    val (fill, ink) = when (callout.tone) {
        Tone.WARN -> palette.warnSoft to palette.warn
        Tone.BAD -> palette.badSoft to palette.bad
        else -> palette.actionSoft to palette.ink
    }
    val icon = glyph ?: when (callout.tone) {
        Tone.OK -> Glyph.CHECK
        Tone.WARN, Tone.BAD -> Glyph.WARN
        else -> Glyph.INFO
    }
    Row(
        modifier.fillMaxWidth().background(fill, Corners.callout).padding(14.dp).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        GlyphIcon(icon, ink, Modifier.padding(top = 1.dp), size = 20.dp)
        Txt(bolded(callout.text), Theme.type.callout, Modifier.weight(1f), color = ink)
    }
}

/** A time, what happens then, and a note: "Pagi ini". */
@Composable
fun FactCard(fact: Fact, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val palette = Theme.palette
    val type = Theme.type
    Column(
        modifier
            .lift(Corners.card, palette)
            .background(palette.surface, Corners.card)
            .clip(Corners.card)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Txt(fact.time, type.factTime, color = palette.action)
        Txt(fact.title, type.bodyStrong)
        Txt(fact.note, type.body, color = palette.inkMuted)
    }
}

/** A titled block on the sheet or an inner screen. */
@Composable
fun Section(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Txt(title, Theme.type.title)
        content()
    }
}

/** Initials on a soft tile: a profile, an account. */
@Composable
fun Avatar(initials: String, onHero: Boolean, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    val (fill, ink) = if (onHero) {
        id.universe.mobile.ui.theme.HeroTint.avatarFill to palette.heroText
    } else {
        palette.actionSoft to palette.action
    }
    Box(modifier.size(64.dp).background(fill, Corners.card), contentAlignment = Alignment.Center) {
        Txt(initials, Theme.type.avatar, color = ink)
    }
}
