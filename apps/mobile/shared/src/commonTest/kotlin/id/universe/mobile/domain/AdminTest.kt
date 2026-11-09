package id.universe.mobile.domain

import id.universe.mobile.data.Account
import id.universe.mobile.data.Candidate
import id.universe.mobile.data.MusterLastRun
import id.universe.mobile.data.MusterRuns
import id.universe.mobile.data.MusterShift
import id.universe.mobile.data.MusterStage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/*
 * The Superadmin's screens (docs/prd.md, Mobile app → Superadmin): a hand
 * placement as the Actual tab makes it, the accounts, and the muster monitor.
 * The rules are the API's; these pin the words.
 */
class AdminTest {
    private fun candidate(ftw: String, tappedAt: String? = "05:10:00", onAnotherUnit: Boolean = false) = Candidate(
        employeeId = "e1",
        nik = "10241276",
        name = "Eko Wahyudi",
        tappedAt = tappedAt,
        sentAt = null,
        ftw = ftw,
        finger = "pass",
        ready = ftw == "pass",
        refusal = null,
        onAnotherUnit = onAnotherUnit,
    )

    @Test
    fun aCandidateSaysWhenTheyTappedAndHowTheirFtwStands() {
        val line = candidateLine(candidate("pass"))
        assertEquals("NIK 10241276 · tap 05:10", line.note)
        assertEquals(Pill("FTW lolos", Tone.OK), line.badge)
        assertFalse(line.needsAck)
        assertEquals("NIK 10241276 · belum tap", candidateLine(candidate("pass", tappedAt = null)).note)
    }

    @Test
    fun anFtwThatDidNotPassNeedsTheConfirmationTheApiAsksFor() {
        assertTrue(candidateLine(candidate("fail")).needsAck)
        assertEquals(Pill("FTW tidak lolos", Tone.BAD), candidateLine(candidate("fail")).badge)
        assertTrue(candidateLine(candidate("missing")).needsAck)
        assertTrue(candidateLine(candidate("late")).needsAck)
        /* A unit that asks for no FTW asks for no confirmation either. */
        assertFalse(candidateLine(candidate("not-required")).needsAck)
    }

    @Test
    fun someoneOnAnotherUnitCannotBeChosen() {
        assertTrue(candidateLine(candidate("pass", onAnotherUnit = true)).blocked)
    }

    private fun stage(name: String, at: String, fired: Boolean, due: Boolean, run: MusterLastRun? = null) = MusterStage(
        id = name,
        name = name,
        action = "spare-validate",
        shift = "day",
        at = at,
        date = "2026-10-19",
        due = due,
        active = true,
        fired = fired,
        lastRun = run,
    )

    private fun runs(tick: String?) = MusterRuns(
        runningShift = MusterShift(date = "2026-10-19", shift = "day"),
        schedulerLastTick = tick,
        stages = listOf(
            stage("Batas finger pertama", "05:25", fired = true, due = true, run = MusterLastRun("2026-10-18T21:25:01.000Z", true, "")),
            stage("Papan alokasi dibuat", "05:26", fired = true, due = true, run = MusterLastRun("2026-10-18T21:26:01.000Z", false, "Tidak ada finger-in")),
            stage("Finger kedua", "05:28", fired = false, due = false),
            stage("Bus berangkat", "05:30", fired = false, due = false),
        ),
    )

    /* 21:27:30Z is 05:27:30 WITA. */
    @OptIn(ExperimentalTime::class)
    private val now = Instant.parse("2026-10-18T21:27:30Z").toEpochMilliseconds()

    @Test
    fun theMonitorSaysWhatRanWhatWasRefusedAndWhatIsNext() {
        val view = musterView(runs("2026-10-18T21:27:01.000Z"), now)
        assertEquals("05:28", view.nextTime)
        assertEquals("Berikutnya: Finger kedua · scheduler berjalan", view.line)
        /* The board's stage was refused: the hero is amber even with the scheduler ticking. */
        assertEquals(Tone.WARN, view.tone)
        assertEquals(Pill("Detak 05:27:01", Tone.OK), view.heartbeat)
        assertEquals(
            listOf(StepState.DONE, StepState.FAILED, StepState.NOW, StepState.WAIT),
            view.steps.map { it.state },
        )
        assertEquals("Ditolak: Tidak ada finger-in", view.steps[1].note)
    }

    @Test
    fun aRefusedStageIsNeverReportedAsAllRun() {
        val done = MusterLastRun("2026-10-18T21:30:01.000Z", true, "")
        val refused = MusterLastRun("2026-10-18T21:26:01.000Z", false, "")
        val view = musterView(
            runs("2026-10-18T21:27:01.000Z").copy(
                stages = listOf(
                    stage("Papan alokasi dibuat", "05:26", fired = true, due = true, run = refused),
                    stage("Bus berangkat", "05:30", fired = true, due = true, run = done),
                ),
            ),
            now,
        )
        assertEquals("1 tahap ditolak · scheduler berjalan", view.line)
        assertEquals(Tone.WARN, view.tone)
        /* A refusal with no sentence still says it was refused. */
        assertEquals("Ditolak", view.steps[0].note)
    }

    @Test
    fun aStageJustDueIsWaitedForWhileTheSchedulerTicks() {
        /* 05:27 is due at 05:27:30; the scheduler fires on the next tick, not a failure. */
        val view = musterView(
            runs("2026-10-18T21:27:01.000Z").copy(
                stages = listOf(stage("Finger kedua", "05:27", fired = false, due = true)),
            ),
            now,
        )
        assertEquals(StepState.NOW, view.steps[0].state)
        val stopped = musterView(
            runs("2026-10-18T21:20:00.000Z").copy(
                stages = listOf(stage("Finger kedua", "05:27", fired = false, due = true)),
            ),
            now,
        )
        assertEquals(StepState.FAILED, stopped.steps[0].state)
    }

    @Test
    fun stagesAreReadInTheOrderTheyRunWhateverOrderTheyArrive() {
        val view = musterView(runs("2026-10-18T21:27:01.000Z").let { it.copy(stages = it.stages.reversed()) }, now)
        assertEquals(listOf("05:25", "05:26", "05:28", "05:30"), view.steps.map { it.time })
        assertEquals("05:28", view.nextTime)
    }

    @Test
    fun aHeartbeatOlderThanTwoMinutesIsAWarning() {
        val view = musterView(runs("2026-10-18T21:20:00.000Z"), now)
        assertEquals("Berikutnya: Finger kedua · scheduler mungkin berhenti", view.line)
        assertEquals(Tone.WARN, view.tone)
        assertEquals(Pill("Detak 05:20:00", Tone.WARN), view.heartbeat)
        assertEquals(Pill("Belum ada detak", Tone.BAD), musterView(runs(null), now).heartbeat)
    }

    private fun account(name: String, nik: String?, active: Boolean = true) = Account(
        id = "a-$name",
        email = null,
        nik = nik,
        name = name,
        roleId = "r",
        roleName = "User",
        scope = "self",
        active = active,
        mustChangePassword = false,
        createdAt = "2026-10-01T00:00:00.000Z",
    )

    @Test
    fun accountsAreFoundByNameOrNikInNameOrder() {
        val all = listOf(account("Rudi Hartono", "10234567"), account("Fajar Nugroho", "10239911"), account("Admin", null))
        assertEquals(listOf("Fajar Nugroho", "Rudi Hartono"), accountsMatching(all, "102").map { it.name })
        assertEquals(listOf("Rudi Hartono"), accountsMatching(all, " rudi ").map { it.name })
        assertEquals(3, accountsMatching(all, "").size)
        assertEquals("NIK 10234567 · User", accountNote(all[0]))
        /* An account with no NIK shows its role, never its email. */
        assertEquals("User", accountNote(all[2].copy(email = "admin@example.id")))
        assertNull(accountBadge(all[0]))
        assertEquals(Pill("Nonaktif", Tone.NEUTRAL), accountBadge(account("X", "1", active = false)))
    }
}
