package id.universe.mobile.ui.staff

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.cardFacts
import id.universe.mobile.domain.initialsOf
import id.universe.mobile.domain.nikOfScan
import id.universe.mobile.domain.shouldLookUp
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Avatar
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Field
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.QrCamera
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.ViewfinderInk
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift

private val FinderGround = Color(0xFF05080F)

/**
 * Scan ID: who is on this card and what the muster gave them today
 * (`/v1/id-card/:nik`, scoped like every read of the register). Scanning is
 * looking: nothing is recorded.
 */
@Composable
fun ScanScreen(api: UniverseApi, onBack: () -> Unit) {
    var nik by rememberSaveable { mutableStateOf<String?>(null) }
    val showing = nik
    if (showing == null) {
        Finder(onNik = { found -> if (shouldLookUp(found, nik)) nik = found }, onBack = onBack)
    } else {
        CardResult(api, showing, onAgain = { nik = null })
    }
}

@Composable
private fun Finder(onNik: (String) -> Unit, onBack: () -> Unit) {
    var typing by rememberSaveable { mutableStateOf(false) }
    var typed by rememberSaveable { mutableStateOf("") }
    val submit = { nikOfScan(typed)?.let(onNik) }
    InnerScreen("Scan ID card", onBack) {
        Box(
            Modifier.fillMaxWidth().height(330.dp).clip(Corners.idCard).background(FinderGround),
            contentAlignment = Alignment.Center,
        ) {
            QrCamera(
                onCode = { raw -> nikOfScan(raw)?.let(onNik) },
                modifier = Modifier.fillMaxSize(),
            ) { FinderOverlay() }
        }
        if (typing) {
            Field(
                "NIK",
                typed,
                { typed = it.filter(Char::isDigit) },
                keyboard = KeyboardType.Number,
                tabular = true,
                imeAction = ImeAction.Go,
                onDone = { submit() },
            )
            ActionButton("Cari kartu", { submit() }, enabled = typed.isNotBlank())
        } else {
            ActionButton("Ketik NIK manual", { typing = true }, kind = ButtonKind.GHOST)
        }
    }
}

/** The four brand corners, the sweeping line, and the hint. */
@Composable
private fun BoxScope.FinderOverlay() {
    val brand = Theme.palette.brand
    val sweep = rememberInfiniteTransition()
    val at by sweep.animateFloat(
        initialValue = 0.2f,
        targetValue = 0.8f,
        animationSpec = infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse),
    )
    Canvas(Modifier.align(Alignment.Center).size(210.dp)) {
        val stroke = 4.dp.toPx()
        val arm = 36.dp.toPx()
        val radius = 12.dp.toPx()
        val inset = stroke / 2
        val w = size.width - inset
        val h = size.height - inset
        listOf(
            Triple(Offset(inset, inset), 1f, 1f),
            Triple(Offset(w, inset), -1f, 1f),
            Triple(Offset(inset, h), 1f, -1f),
            Triple(Offset(w, h), -1f, -1f),
        ).forEach { (corner, dx, dy) ->
            val path = Path().apply {
                moveTo(corner.x, corner.y + dy * arm)
                lineTo(corner.x, corner.y + dy * radius)
                quadraticTo(corner.x, corner.y, corner.x + dx * radius, corner.y)
                lineTo(corner.x + dx * arm, corner.y)
            }
            drawPath(path, brand, style = Stroke(stroke, cap = StrokeCap.Round))
        }
    }
    Canvas(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        val y = size.height * at
        drawLine(brand, Offset(0f, y), Offset(size.width, y), 2.dp.toPx())
    }
    Txt(
        "Arahkan kamera ke QR di ID card",
        Theme.type.callout,
        Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp),
        color = ViewfinderInk,
    )
}

@Composable
private fun CardResult(api: UniverseApi, nik: String, onAgain: () -> Unit) {
    val card = rememberLoad(nik) { api.call { employees.getV1IdCardByNik(nik) } }
    val palette = Theme.palette
    val type = Theme.type
    InnerScreen("Hasil scan", onAgain) {
        Loaded(card) { person ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .lift(Corners.idCard, palette)
                    .background(palette.surface, Corners.idCard)
                    .clip(Corners.idCard),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(palette.hero, palette.heroLow)))
                        .padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(initialsOf(person.name), onHero = true)
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Txt(person.name, type.sheetTitle.copy(fontWeight = FontWeight.W700), color = palette.heroText)
                        Txt("NIK ${person.nik}", type.bodyStrong.copy(fontFeatureSettings = "tnum"), color = palette.heroTextMuted)
                        listOfNotNull(person.department, person.position).joinToString(" · ").ifEmpty { null }?.let {
                            Txt(it, type.chip, color = palette.heroTextMuted)
                        }
                    }
                }
                cardFacts(person).forEachIndexed { index, (label, value) ->
                    if (index > 0) Hairline()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp)
                            .padding(horizontal = 16.dp, vertical = 14.dp)
                            .semantics(mergeDescendants = true) {},
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Note(label)
                        Txt(value, type.bodyStrong.copy(fontFeatureSettings = "tnum"))
                    }
                }
                if (person.simper.isNotEmpty()) {
                    Hairline()
                    FlowRow(
                        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) { person.simper.forEach { Badge(Pill(it, Tone.INFO)) } }
                }
            }
        }
        ActionButton("Scan lagi", onAgain, kind = ButtonKind.GHOST)
    }
}
