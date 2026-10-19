package id.universe.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import id.universe.mobile.domain.StepState
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme

data class StepRow(val time: String, val name: String, val note: String?, val state: StepState)

/** A vertical rail: done knots green, the current one in action with a halo, the rest hollow. */
@Composable
fun Steps(steps: List<StepRow>, modifier: Modifier = Modifier) {
    val palette = Theme.palette
    val type = Theme.type
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
        steps.forEachIndexed { index, step ->
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min).semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(Modifier.width(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    val knot = Modifier.padding(top = 3.dp).size(14.dp)
                    when (step.state) {
                        StepState.DONE -> Box(knot.background(palette.ok, Corners.pill))
                        StepState.FAILED -> Box(knot.background(palette.bad, Corners.pill))
                        StepState.NOW -> Box(
                            knot
                                .drawBehind {
                                    drawCircle(palette.actionSoft, radius = size.minDimension / 2 + 5.dp.toPx())
                                }
                                .background(palette.action, Corners.pill),
                        )
                        StepState.WAIT -> Box(
                            knot.background(palette.surface, Corners.pill).border(3.dp, palette.line, Corners.pill),
                        )
                    }
                    if (index < steps.lastIndex) {
                        Box(Modifier.padding(vertical = 4.dp).width(2.dp).weight(1f).background(palette.line))
                    }
                }
                Row(
                    Modifier.weight(1f).padding(bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Txt(step.name, type.bodyStrong)
                        step.note?.let { Txt(it, type.body, color = palette.inkMuted) }
                    }
                    Txt(step.time, type.clock, color = palette.action)
                }
            }
        }
    }
}
