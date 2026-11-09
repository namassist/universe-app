package id.universe.mobile.ui.staff

import androidx.compose.runtime.Composable
import id.universe.mobile.data.MusterRuns
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.musterView
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.StaleNote
import id.universe.mobile.ui.components.StepRow
import id.universe.mobile.ui.components.Steps
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

@OptIn(ExperimentalTime::class)
internal fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

/**
 * The muster, monitor only (docs/prd.md, Mobile app → Superadmin): each stage,
 * whether it ran or was refused, and the scheduler's heartbeat. Editing stays
 * on the web.
 */
@Composable
fun TimelineScreen(runs: LoadHandle<MusterRuns>, onBack: () -> Unit) {
    InnerScreen("Monitor timeline", onBack) {
        Loaded(runs) { answer ->
            val view = musterView(answer, nowMs())
            StaleNote(runs)
            Callout(
                if (view.running) {
                    Callout("**Scheduler berjalan.** Detak terakhir ${view.lastBeat}. Edit jadwal tetap dari console web.", Tone.OK)
                } else {
                    Callout("**Scheduler mungkin berhenti.** ${view.heartbeat.text}. Periksa Operations Center.", Tone.WARN)
                },
            )
            if (view.steps.isEmpty()) {
                Note("Timeline belum bisa menentukan shift yang berjalan.")
            } else {
                ListGroup { Steps(view.steps.map { StepRow(it.time, it.name, it.note, it.state) }) }
            }
        }
    }
}
