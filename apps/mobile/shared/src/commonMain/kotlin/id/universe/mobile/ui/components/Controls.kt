package id.universe.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift

enum class ButtonKind { PRIMARY, GHOST, DANGER }

/**
 * Full-width, tall and plain (DESIGN.md → Buttons). Danger is the outlined
 * red Keluar / Nonaktifkan, the one status hue a button may wear.
 */
@Composable
fun ActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.PRIMARY,
    enabled: Boolean = true,
    trailing: Glyph? = null,
    height: Dp = 52.dp,
) {
    val palette = Theme.palette
    val (fill, ink, edge) = when {
        !enabled -> Triple(palette.sunken, palette.inkFaint, Color.Transparent)
        kind == ButtonKind.PRIMARY -> Triple(palette.action, palette.actionInk, Color.Transparent)
        kind == ButtonKind.GHOST -> Triple(palette.surface, palette.ink, palette.line)
        else -> Triple(Color.Transparent, palette.bad, palette.bad)
    }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = height)
            .then(if (focused) Modifier.border(3.dp, palette.action, Corners.tile) else Modifier)
            .clip(Corners.tile)
            .background(fill)
            .then(if (edge != Color.Transparent) Modifier.border(1.dp, edge, Corners.tile) else Modifier)
            .clickable(interaction, indication = androidx.compose.foundation.LocalIndication.current, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        horizontalArrangement = if (trailing != null) Arrangement.SpaceBetween else Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(text, if (height < 52.dp) Theme.type.buttonSmall else Theme.type.button, color = ink, align = TextAlign.Center)
        trailing?.let { GlyphIcon(it, ink, size = 18.dp) }
    }
}

/** A labelled 54px input. Its label is what a screen reader names it by. */
@Composable
fun Field(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    secret: Boolean = false,
    tabular: Boolean = false,
    imeAction: ImeAction = ImeAction.Next,
    onDone: () -> Unit = {},
) {
    val palette = Theme.palette
    val type = Theme.type
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt(label, type.buttonSmall)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            textStyle = type.field.copy(
                color = palette.ink,
                fontFeatureSettings = if (tabular) "tnum" else null,
            ),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = imeAction, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onDone = { onDone() }, onGo = { onDone() }),
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            interactionSource = interaction,
            cursorBrush = SolidColor(palette.action),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                        .background(palette.surface, Corners.tile)
                        .border(if (focused) 2.dp else 1.dp, if (focused) palette.action else palette.line, Corners.tile)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { inner() }
            },
        )
    }
}

/**
 * A sunken track of equal segments; the chosen one is a lifted surface pill.
 * History types, unit status, board filters.
 */
@Composable
fun <K> Tabs(options: List<Pair<K, String>>, selected: K, onSelect: (K) -> Unit, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Row(
        modifier.fillMaxWidth().background(palette.sunken, Corners.tile).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (key, label) ->
            val on = key == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 42.dp)
                    .then(if (on) Modifier.lift(Corners.tab, palette).background(palette.surface, Corners.tab) else Modifier)
                    .clip(Corners.tab)
                    .selectable(selected = on, role = Role.Tab, onClick = { onSelect(key) }),
                contentAlignment = Alignment.Center,
            ) {
                Txt(label, Theme.type.buttonSmall, color = if (on) palette.ink else palette.inkMuted, maxLines = 1)
            }
        }
    }
}

/** A 44px round button with a glyph and a spoken label: back, month arrows. */
@Composable
fun RoundButton(glyph: Glyph, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Box(
        modifier
            .heightIn(min = 44.dp)
            .clip(Corners.pill)
            .background(palette.surface)
            .border(1.dp, palette.line, Corners.pill)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label }
            .padding(13.dp),
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(glyph, palette.ink, size = 18.dp)
    }
}

/** A 10px track filled to [fraction]. */
@Composable
fun Progress(fraction: Float, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    Box(modifier.fillMaxWidth().height(10.dp).clip(Corners.cell).background(palette.sunken)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(10.dp).clip(Corners.cell).background(palette.action))
    }
}
