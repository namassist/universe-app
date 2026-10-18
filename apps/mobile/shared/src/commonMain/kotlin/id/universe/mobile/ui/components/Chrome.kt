package id.universe.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import id.universe.mobile.ui.LocalNavReserve
import id.universe.mobile.ui.LocalPlatform
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.RaisedDisc
import id.universe.mobile.ui.theme.Theme

/** A round back button and the screen's title, above a scrolling body. */
@Composable
fun TopBar(title: String, onBack: (() -> Unit)?) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Theme.palette.ground)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (onBack != null) RoundButton(Glyph.BACK, "Kembali", onBack)
        Txt(title, Theme.type.headline, Modifier.weight(1f).semantics { heading() })
    }
}

/** An inner screen: the bar stays put, the body scrolls under it. */
@Composable
fun InnerScreen(title: String, onBack: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    val palette = Theme.palette
    val platform = LocalPlatform.current
    DisposableEffect(palette.dark) {
        platform.statusBarOnDark(palette.dark)
        onDispose { }
    }
    Column(Modifier.fillMaxSize().background(palette.ground)) {
        TopBar(title, onBack)
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp + LocalNavReserve.current),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

data class NavEntry(
    val label: String,
    val glyph: Glyph,
    val center: Boolean,
    val active: Boolean,
    val onClick: () -> Unit,
)

/** Five columns; the centre one a raised 62px disc (DESIGN.md → Navigation). */
@Composable
fun NavBar(entries: List<NavEntry>, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    val type = Theme.type
    Column(modifier.fillMaxWidth().background(palette.surface).windowInsetsPadding(WindowInsets.navigationBars)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(palette.line))
        Row(Modifier.fillMaxWidth().height(87.dp).padding(start = 4.dp, end = 4.dp, top = 8.dp)) {
            entries.forEach { entry ->
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 56.dp)
                        .clip(Corners.tile)
                        .clickable(role = Role.Tab, onClick = entry.onClick)
                        .semantics { selected = entry.active },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (entry.center) {
                        Box(
                            Modifier
                                .layout { measurable, constraints ->
                                    /* Raised 34px over the bar, taking no room for it. */
                                    val lift = 34.dp.roundToPx()
                                    val placeable = measurable.measure(constraints)
                                    layout(placeable.width, placeable.height - lift) { placeable.place(0, -lift) }
                                }
                                .size(62.dp)
                                .dropShadow(Corners.pill, RaisedDisc)
                                .background(palette.surface, Corners.pill)
                                .padding(5.dp)
                                .background(palette.action, Corners.pill),
                            contentAlignment = Alignment.Center,
                        ) { GlyphIcon(entry.glyph, palette.actionInk, size = 26.dp, stroke = 2.2f) }
                    } else {
                        Box(
                            Modifier
                                .size(width = 56.dp, height = 32.dp)
                                .background(if (entry.active) palette.actionSoft else palette.surface, Corners.pill),
                            contentAlignment = Alignment.Center,
                        ) { GlyphIcon(entry.glyph, if (entry.active) palette.action else palette.inkFaint, size = 21.dp) }
                    }
                    Txt(
                        entry.label,
                        if (entry.active) type.label.copy(fontWeight = type.code.fontWeight) else type.label,
                        color = if (entry.active) palette.ink else palette.inkFaint,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** Inverted, above the bar (DESIGN.md → Bottom sheet and toast). */
@Composable
fun Toast(text: String, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .background(palette.ink, Corners.tile)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) { Txt(text, Theme.type.linkLine, color = palette.ground) }
}

/** A plain button-like strip in the action colour: "SIMPER berlaku s.d. …". */
@Composable
fun Strip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(palette.action)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(text, Theme.type.buttonSmall, color = palette.actionInk)
        GlyphIcon(Glyph.CHEVRON, palette.actionInk, size = 16.dp, stroke = 2.4f)
    }
}

/** A labelled pair on a card: Lokasi / Bus. */
@Composable
fun Labelled(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Note(label)
        Txt(value, Theme.type.bodyStrong.copy(fontFeatureSettings = "tnum"))
    }
}

/** Content with a 44px close button in its top corner: the update notice. */
@Composable
fun Dismissable(content: @Composable () -> Unit, onDismiss: () -> Unit) {
    val palette = Theme.palette
    Box {
        content()
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .size(44.dp)
                .clip(Corners.pill)
                .clickable(role = Role.Button, onClickLabel = "Tutup", onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) { GlyphIcon(Glyph.CLOSE, palette.inkMuted, size = 16.dp) }
    }
}

/** Two equal columns, 10px apart. */
@Composable
fun Duo(first: @Composable (Modifier) -> Unit, second: @Composable (Modifier) -> Unit, gap: Int = 10) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap.dp)) {
        first(Modifier.weight(1f))
        second(Modifier.weight(1f))
    }
}

/** A white card with padding, for content that is not a list. */
@Composable
fun Card(modifier: Modifier = Modifier, padding: Int = 16, content: @Composable ColumnScope.() -> Unit) {
    ListGroup(modifier) {
        Column(Modifier.fillMaxWidth().padding(padding.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}
