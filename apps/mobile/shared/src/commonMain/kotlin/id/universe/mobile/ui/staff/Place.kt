package id.universe.mobile.ui.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import id.universe.mobile.api.apis.FleetAllocationApi.ShiftGetV1FleetAllocationActualByDateByShiftCandidatesByUnitId as CandidateShift
import id.universe.mobile.api.apis.FleetAllocationApi.ShiftPatchV1FleetAllocationActualByDateByShiftByUnitId as PlaceShift
import id.universe.mobile.api.models.PatchV1FleetAllocationActualByDateByShiftByUnitIdRequest
import id.universe.mobile.data.Board
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.data.failureWords
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.CandidateLine
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.candidateLine
import id.universe.mobile.ui.LocalToast
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.BottomSheet
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.icons.GlyphIcon
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift
import kotlinx.coroutines.launch

/**
 * "Isi": a hand placement on the running board, through the same endpoint and
 * the same FTW confirmation as the web's Actual tab (docs/prd.md, Mobile app →
 * Superadmin). The candidates and what stands in their way are the engine's.
 */
@Composable
fun PlaceSheet(api: UniverseApi, board: Board, unitId: String, unitCode: String, onPlaced: () -> Unit, onDismiss: () -> Unit) {
    val date = board.date ?: return
    val shift = board.shift ?: return
    /* A shift this build does not know is said, never a crash. */
    val candidateShift = CandidateShift.entries.firstOrNull { it.value == shift }
    val placeShift = PlaceShift.entries.firstOrNull { it.value == shift }
    val candidates = rememberLoad(date, shift, unitId) {
        if (candidateShift == null) {
            Outcome.Refused(0, null, UNKNOWN_SHIFT)
        } else {
            api.call {
                fleetAllocation.getV1FleetAllocationActualByDateByShiftCandidatesByUnitId(date, candidateShift, unitId)
            }
        }
    }
    var picked by remember { mutableStateOf<String?>(null) }
    var acknowledged by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val toast = LocalToast.current
    val lines = remember(candidates.value) {
        (candidates.value as? Load.Ready)?.value?.map(::candidateLine).orEmpty()
    }
    val chosen = lines.firstOrNull { it.employeeId == picked }
    BottomSheet(
        "Isi unit $unitCode",
        onDismiss,
        dismissible = !busy,
        footer = {
            if (chosen?.needsAck == true) AckBox(acknowledged, chosen.badge.text) { acknowledged = !acknowledged }
            error?.let { Callout(Callout(it, Tone.BAD)) }
            ActionButton(
                when {
                    busy -> "Menempatkan…"
                    chosen != null -> "Tempatkan ${chosen.name}"
                    else -> "Pilih kandidat"
                },
                {
                    val who = chosen ?: return@ActionButton
                    val toShift = placeShift ?: run {
                        error = UNKNOWN_SHIFT
                        return@ActionButton
                    }
                    error = null
                    busy = true
                    scope.launch {
                        val answer = api.call {
                            fleetAllocation.patchV1FleetAllocationActualByDateByShiftByUnitId(
                                date,
                                toShift,
                                unitId,
                                PatchV1FleetAllocationActualByDateByShiftByUnitIdRequest(
                                    employeeId = who.employeeId,
                                    acknowledgeFtw = if (who.needsAck) true else null,
                                ),
                            )
                        }
                        if (answer is Outcome.Ok) {
                            /* busy stays on: the sheet is closing. */
                            toast("${who.name} ditempatkan di $unitCode")
                            onPlaced()
                        } else {
                            busy = false
                            error = answer.failureWords()
                        }
                    }
                },
                enabled = chosen != null && (!chosen.needsAck || acknowledged) && !busy,
            )
        },
    ) {
        Loaded(candidates) {
            if (lines.isEmpty()) {
                Note("Tidak ada kandidat untuk unit ini.")
                return@Loaded
            }
            /* Every operator on the shift can be a candidate: only the cards on screen are drawn. */
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                item { Note("Kandidat untuk unit ini, dengan yang menghalanginya bila ada.") }
                items(lines, key = { it.employeeId }) { line ->
                    CandidateCard(line, selected = picked == line.employeeId) {
                        picked = line.employeeId
                        acknowledged = false
                        error = null
                    }
                }
            }
        }
    }
}

@Composable
private fun CandidateCard(line: CandidateLine, selected: Boolean, onPick: () -> Unit) {
    val palette = Theme.palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .lift(Corners.callout, palette)
            .background(palette.surface, Corners.callout)
            .border(2.dp, if (selected) palette.action else palette.surface, Corners.callout)
            .clip(Corners.callout)
            .clickable(enabled = !line.blocked, role = Role.RadioButton, onClick = onPick)
            .semantics { this.selected = selected }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(line.name, Theme.type.bodyStrong, color = if (line.blocked) palette.inkFaint else palette.ink)
            Note(line.note)
            line.refusal?.let { Txt(it, Theme.type.body, color = palette.warn) }
            if (line.blocked) Note("Sudah dipasang di unit lain")
        }
        Badge(line.badge)
    }
}

/** The warn callout holding the checkbox; the button stays off until it is ticked (DESIGN.md). */
@Composable
private fun AckBox(checked: Boolean, status: String, onToggle: () -> Unit) {
    val palette = Theme.palette
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Corners.callout)
            .background(palette.warnSoft)
            .clickable(role = Role.Checkbox, onClick = onToggle)
            .semantics { stateDescription = if (checked) "Dicentang" else "Belum dicentang" }
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .padding(top = 1.dp)
                .size(22.dp)
                .clip(CheckboxShape)
                .background(if (checked) palette.warn else palette.warnSoft)
                .border(2.dp, palette.warn, CheckboxShape),
            contentAlignment = Alignment.Center,
        ) { if (checked) GlyphIcon(Glyph.CHECK, palette.warnSoft, size = 16.dp, stroke = 3f) }
        Txt(
            "$status, sedangkan unit ini mensyaratkan FTW lolos. Saya tetap menempatkan, " +
                "dan konfirmasi ini dicatat atas nama saya.",
            Theme.type.callout,
            Modifier.weight(1f),
            color = palette.warn,
        )
    }
}

/** A 22px checkbox reads as a box, not a ring (DESIGN.md → Checkbox acknowledgement). */
private val CheckboxShape = RoundedCornerShape(6.dp)

private const val UNKNOWN_SHIFT = "Shift papan tidak dikenali versi aplikasi ini. Perbarui aplikasi."
