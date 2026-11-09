package id.universe.mobile.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.universe.mobile.domain.Tone
import id.universe.mobile.resources.Res
import id.universe.mobile.resources.logo
import id.universe.mobile.ui.LocalNavReserve
import id.universe.mobile.ui.LocalPlatform
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.HeroTint
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift
import org.jetbrains.compose.resources.painterResource

data class QuickLink(val label: String, val glyph: Glyph, val onClick: () -> Unit)

data class HeroPill(val text: String, val tone: Tone, val onClick: () -> Unit)

data class MenuEntry(val label: String, val glyph: Glyph, val onClick: () -> Unit)

/** cubic-bezier(0.16, 1, 0.3, 1), the one ease (DESIGN.md → Motion). */
val Ease = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

@Composable
fun BrandMark(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Image(painterResource(Res.drawable.logo), contentDescription = null, modifier = Modifier.size(26.dp))
        Txt("UNIVERSE", Theme.type.brand, color = Theme.palette.heroText)
    }
}

/**
 * The navy band on every home screen: the one fact that matters today at
 * display size, its status line, and pills that each go somewhere.
 */
@Composable
fun HeroBand(
    chip: String,
    code: String,
    codeIsWord: Boolean,
    line: String,
    tone: Tone,
    link: String?,
    onLink: () -> Unit,
    quick: List<QuickLink>,
    pills: List<HeroPill>,
    topGlyph: Glyph,
    topLabel: String,
    onTop: () -> Unit,
) {
    val palette = Theme.palette
    val type = Theme.type
    Column(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(palette.hero, palette.heroLow)))
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(top = 20.dp, bottom = 56.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()
            Box(
                Modifier
                    .background(HeroTint.chipFill, Corners.pill)
                    .border(1.dp, HeroTint.chipStroke, Corners.pill)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            ) { Txt(chip, type.chip, color = palette.heroText, maxLines = 1) }
            Box(
                Modifier
                    .size(44.dp)
                    .clip(Corners.pill)
                    .background(HeroTint.buttonFill)
                    .border(1.dp, HeroTint.stroke, Corners.pill)
                    .clickable(role = Role.Button, onClickLabel = topLabel, onClick = onTop)
                    .semantics { contentDescription = topLabel },
                contentAlignment = Alignment.Center,
            ) { GlyphIcon(topGlyph, palette.heroText, size = 20.dp) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp).height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Reveal(code) {
                    Txt(
                        code,
                        if (codeIsWord) type.displayWord else type.display,
                        Modifier.semantics { heading() },
                        color = palette.heroText,
                        maxLines = 1,
                    )
                }
                Txt(
                    line,
                    type.statusLine,
                    color = when (tone) {
                        Tone.OK -> HeroTint.okLine
                        Tone.WARN -> HeroTint.warnLine
                        else -> palette.heroTextMuted
                    },
                )
                if (link != null) {
                    Row(
                        Modifier
                            .padding(top = 4.dp)
                            .heightIn(min = 44.dp)
                            .clip(Corners.tile)
                            .clickable(role = Role.Button, onClick = onLink),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Txt(link, type.linkLine, Modifier.weight(1f, fill = false), color = palette.heroText)
                        GlyphIcon(Glyph.CHEVRON, palette.heroText, size = 15.dp, stroke = 2.4f)
                    }
                }
            }
            if (quick.isNotEmpty()) {
                Column(Modifier.width(104.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    quick.forEach { QuickButton(it, Modifier.weight(1f)) }
                }
            }
        }
        if (pills.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) { pills.forEach { StatusPill(it) } }
        }
    }
}

/** The hero fact rises into place once (520ms), unless the phone has animations off. */
@Composable
private fun Reveal(key: Any, content: @Composable () -> Unit) {
    val shown = remember { Animatable(0f) }
    LaunchedEffect(key) {
        shown.snapTo(0f)
        shown.animateTo(1f, tween(520, easing = Ease))
    }
    Box(
        Modifier.graphicsLayer {
            alpha = shown.value
            translationY = (1f - shown.value) * 10.dp.toPx()
        },
    ) { content() }
}

@Composable
private fun QuickButton(link: QuickLink, modifier: Modifier) {
    val palette = Theme.palette
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = 74.dp)
            .clip(Corners.card)
            .background(HeroTint.quickFill)
            .border(1.dp, HeroTint.quickEdge, Corners.card)
            .clickable(role = Role.Button, onClick = link.onClick)
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        GlyphIcon(link.glyph, palette.heroText)
        Txt(link.label, Theme.type.chip, color = palette.heroText, align = TextAlign.Center)
    }
}

@Composable
private fun StatusPill(pill: HeroPill) {
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .clip(Corners.pill)
            .background(HeroTint.pillFill)
            .border(1.dp, HeroTint.stroke, Corners.pill)
            .clickable(role = Role.Button, onClick = pill.onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val dot = when (pill.tone) {
            Tone.OK -> HeroTint.okDot
            Tone.WARN -> HeroTint.warnDot
            Tone.BAD -> HeroTint.badDot
            else -> HeroTint.neutralDot
        }
        Box(Modifier.size(9.dp).background(dot, Corners.pill))
        Txt(pill.text, Theme.type.linkLine, color = Theme.palette.heroText, maxLines = 1)
    }
}

/** Four columns of 54px tiles on a lifted panel. */
@Composable
fun MenuGrid(items: List<MenuEntry>, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Column(
        modifier
            .fillMaxWidth()
            .lift(Corners.sheet, palette)
            .background(palette.surface, Corners.sheet)
            .padding(start = 6.dp, end = 6.dp, top = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        items.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                row.forEach { item ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(Corners.tile)
                            .clickable(role = Role.Button, onClick = item.onClick)
                            .padding(2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            Modifier.size(54.dp).background(palette.actionSoft, Corners.tile),
                            contentAlignment = Alignment.Center,
                        ) { GlyphIcon(item.glyph, palette.action, size = 24.dp, stroke = 1.9f) }
                        Txt(item.label, Theme.type.label, align = TextAlign.Center)
                    }
                }
                repeat(4 - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * A home screen: the hero band, then the neutral sheet pulled up 34px over
 * it. The navy band sits under the status bar, so its icons are light.
 */
@Composable
fun HomeScaffold(hero: @Composable () -> Unit, sheet: @Composable ColumnScope.() -> Unit) {
    val palette = Theme.palette
    val platform = LocalPlatform.current
    DisposableEffect(Unit) {
        platform.statusBarOnDark(true)
        onDispose { }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(palette.ground)
            .verticalScroll(rememberScrollState())
            .padding(bottom = LocalNavReserve.current),
    ) {
        hero()
        Column(
            Modifier
                .offset(y = (-34).dp)
                .fillMaxWidth()
                .background(palette.ground, RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            content = sheet,
        )
    }
}
