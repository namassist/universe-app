package id.universe.mobile.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.universe.mobile.ui.theme.Theme

private val SheetTop = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)

/**
 * The bottom sheet (DESIGN.md → Bottom sheet and toast): it rises over a dimmed
 * screen, ground-coloured, 26px top corners, a grab handle and a 20px title.
 * A tap outside or the back button closes it.
 */
@Composable
fun BottomSheet(
    title: String,
    onDismiss: () -> Unit,
    /** False while a request is out: closing the sheet then would drop its answer. */
    dismissible: Boolean = true,
    /** Pinned under the body, always in reach: the confirmation and the button. */
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    /** At most what fits; a long list in it brings its own (lazy) scrolling. */
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = Theme.palette
    val shown = remember { MutableTransitionState(false).apply { targetState = true } }
    val close = { if (dismissible) onDismiss() }
    Dialog(
        onDismissRequest = close,
        properties = DialogProperties(
            dismissOnBackPress = dismissible,
            dismissOnClickOutside = dismissible,
            usePlatformDefaultWidth = false,
        ),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = close),
            contentAlignment = Alignment.BottomCenter,
        ) {
            val tallest = maxHeight * 0.86f
            AnimatedVisibility(
                visibleState = shown,
                enter = slideInVertically(tween(360, easing = Ease)) { it } + fadeIn(tween(220)),
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = tallest)
                        .background(palette.ground, SheetTop)
                        /* Taps inside the sheet stay inside it. */
                        .clickable(remember { MutableInteractionSource() }, indication = null) {}
                        .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 24.dp),
                ) {
                    Box(
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(bottom = 18.dp)
                            .size(width = 40.dp, height = 5.dp)
                            .background(palette.line, RoundedCornerShape(3.dp)),
                    )
                    Txt(title, Theme.type.sheetTitle, Modifier.padding(bottom = 14.dp).semantics { heading() })
                    Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
                    footer?.let {
                        Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = it)
                    }
                }
            }
        }
    }
}
