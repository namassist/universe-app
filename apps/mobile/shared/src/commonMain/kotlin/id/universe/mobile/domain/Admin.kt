package id.universe.mobile.domain

import id.universe.mobile.data.Account
import id.universe.mobile.data.Candidate
import id.universe.mobile.data.MusterRuns
import kotlinx.datetime.toLocalDateTime
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/*
 * The Superadmin's screens (docs/prd.md, Mobile app → Superadmin), worded
 * from what the API answers: the candidates the Actual tab offers, the
 * accounts, and the muster the Operations Center watches.
 */

data class CandidateLine(
    val employeeId: String,
    val name: String,
    val note: String,
    val badge: Pill,
    /** The FTW did not pass on a unit that asks for one: the API refuses until it is confirmed. */
    val needsAck: Boolean,
    /** Already seated elsewhere on this board: one person, one unit. */
    val blocked: Boolean,
    /** What the engine weighed against them, said out loud. */
    val refusal: String?,
)

private val FTW_CLEARS = setOf("pass", "not-required")

fun candidateLine(candidate: Candidate): CandidateLine = CandidateLine(
    employeeId = candidate.employeeId,
    name = candidate.name,
    note = "NIK ${candidate.nik} · " + (clockOf(candidate.tappedAt)?.let { "tap $it" } ?: "belum tap"),
    badge = when (candidate.ftw) {
        "pass" -> Pill("FTW lolos", Tone.OK)
        "not-required" -> Pill("FTW tidak wajib", Tone.NEUTRAL)
        "fail" -> Pill("FTW tidak lolos", Tone.BAD)
        "late" -> Pill("FTW terlambat", Tone.WARN)
        "unreadable" -> Pill("FTW tak terbaca", Tone.WARN)
        else -> Pill("FTW belum ada", Tone.WARN)
    },
    needsAck = candidate.ftw !in FTW_CLEARS,
    blocked = candidate.onAnotherUnit,
    refusal = candidate.refusal,
)

data class MusterStep(val time: String, val name: String, val note: String?, val state: StepState)

data class MusterView(
    /** The next stage's time, the hero fact; "—" once the shift's stages have all run. */
    val nextTime: String,
    val line: String,
    val tone: Tone,
    val heartbeat: Pill,
    /** "HH:MM:SS" of the last tick on the site's clock; null when there is none. */
    val lastBeat: String?,
    val running: Boolean,
    val steps: List<MusterStep>,
)

/** A heartbeat older than this means the scheduler has stopped ticking (it ticks each minute). */
private const val HEARTBEAT_FRESH_MS = 2 * 60 * 1000L

/** "HH:MM:SS" on the site's clock, seconds always shown. */
@OptIn(ExperimentalTime::class)
private fun siteSecondsOf(instant: String): String {
    val time = Instant.parse(instant).toLocalDateTime(SITE_ZONE).time
    return listOf(time.hour, time.minute, time.second).joinToString(":") { it.toString().padStart(2, '0') }
}

/**
 * The running muster as the monitor shows it: what ran, what was refused,
 * what is next, and whether the scheduler is still ticking.
 */
@OptIn(ExperimentalTime::class)
private fun epochOf(instant: String?): Long? =
    instant?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }

@OptIn(ExperimentalTime::class)
fun musterView(runs: MusterRuns, nowEpochMs: Long): MusterView {
    val tick = runs.schedulerLastTick
    val tickAt = epochOf(tick)
    val running = tickAt != null && nowEpochMs - tickAt <= HEARTBEAT_FRESH_MS
    val lastBeat = tick?.takeIf { tickAt != null }?.let(::siteSecondsOf)
    val heartbeat = when {
        lastBeat == null -> Pill("Belum ada detak", Tone.BAD)
        running -> Pill("Detak $lastBeat", Tone.OK)
        else -> Pill("Detak $lastBeat", Tone.WARN)
    }
    var nextTaken = false
    /* In the order they run, whatever order they arrive in. */
    val steps = runs.stages.sortedWith(compareBy({ it.date }, { it.at })).map { stage ->
        val run = stage.lastRun
        val (state, note) = when {
            !stage.active -> StepState.WAIT to "Dimatikan"
            run != null && !run.ok -> StepState.FAILED to (run.note.ifBlank { null }?.let { "Ditolak: $it" } ?: "Ditolak")
            stage.fired -> StepState.DONE to run?.note?.ifBlank { null }
            /* Due but not fired while the scheduler ticks: it fires on the next tick. */
            stage.due && !running -> StepState.FAILED to "Lewat waktunya, belum berjalan"
            !nextTaken -> {
                nextTaken = true
                StepState.NOW to null
            }
            else -> StepState.WAIT to null
        }
        MusterStep(stage.at.take(5), stage.name, note, state)
    }
    val next = steps.firstOrNull { it.state == StepState.NOW }
    val failed = steps.count { it.state == StepState.FAILED }
    val scheduler = if (running) "scheduler berjalan" else "scheduler mungkin berhenti"
    return MusterView(
        nextTime = next?.time ?: "—",
        line = when {
            next != null -> "Berikutnya: ${next.name} · $scheduler"
            failed > 0 -> "$failed tahap ditolak · $scheduler"
            else -> "Semua tahap shift ini sudah berjalan · $scheduler"
        },
        tone = if (running && failed == 0) Tone.OK else Tone.WARN,
        heartbeat = heartbeat,
        lastBeat = lastBeat,
        running = running,
        steps = steps,
    )
}

/** By name or NIK, in name order; a blank query lists everyone. */
fun accountsMatching(accounts: List<Account>, query: String): List<Account> {
    val needle = query.trim().lowercase()
    /* Each name lowercased once: this runs on every keystroke over every account. */
    return accounts
        .map { it to it.name.lowercase() }
        .filter { (account, name) -> needle.isEmpty() || name.contains(needle) || account.nik?.contains(needle) == true }
        .sortedBy { it.second }
        .map { it.first }
}

/** NIK and role; never the email, which has no business on a screen held up at a gate. */
fun accountNote(account: Account): String =
    listOfNotNull(account.nik?.let { "NIK $it" }, account.roleName).joinToString(" · ")

fun accountBadge(account: Account): Pill? = if (account.active) null else Pill("Nonaktif", Tone.NEUTRAL)
