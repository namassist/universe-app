package id.universe.mobile.domain

import id.universe.mobile.data.MyShift
import id.universe.mobile.data.MyShiftFtw
import id.universe.mobile.data.MyShiftGates
import id.universe.mobile.data.MyShiftSeat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/*
 * The operator's home and "Unit saya" word what /v1/me/shift decided; they
 * judge nothing (docs/prd.md, Mobile app → User). These pin the words.
 */

private val seededGates = MyShiftGates(
    ftwDeadline = "05:22",
    fingerIn = "05:25",
    board = "05:26",
    secondFinger = "05:28",
    busDepart = "05:30",
)

private fun seat(unit: String = "DT4084") =
    MyShiftSeat(unit = unit, area = "PIT 3 SELATAN", bus = "BUS 07", fleet = "EX1203")

private fun shift(
    status: String = "holder",
    phase: String = "plan",
    reason: String? = null,
    refusal: String? = null,
    planUnit: String? = "DT4084",
    seat: MyShiftSeat? = seat(),
    roster: String? = "D",
    ftw: MyShiftFtw? = null,
    checkInAt: String? = null,
    gates: MyShiftGates = seededGates,
) = MyShift(
    date = "2026-10-18",
    shift = "day",
    roster = roster,
    phase = phase,
    status = status,
    reason = reason,
    refusal = refusal,
    planUnit = planUnit,
    seat = seat,
    ftw = ftw,
    checkInAt = checkInAt,
    gates = gates,
)

class StandingTest {
    @Test
    fun aHolderBeforeTheBoardReadsAsAPlan() {
        val hero = heroOf(shift())
        assertEquals("DT4084", hero.code)
        assertEquals("Pegangan · rencana s.d. 05:26", hero.line)
        assertEquals(Tone.WARN, hero.tone)
        assertEquals("EX1203 · PIT 3 SELATAN", hero.where)
        assertEquals("Shift Siang · Roster D", hero.chip)
        assertEquals(Pill("Rencana · belum final", Tone.WARN), badgeOf(shift()))
    }

    @Test
    fun aHolderOnTheBoardIsFinal() {
        val final = shift(phase = "board")
        assertEquals("DT4084", heroOf(final).code)
        assertEquals(Tone.OK, heroOf(final).tone)
        assertEquals(Pill("Final · papan 05:26", Tone.OK), badgeOf(final))
    }

    @Test
    fun aSpareIsSpareWithTheReasonAndTheSecondFingerTime() {
        val spare = shift(status = "spare", reason = "breakdown", seat = null)
        val hero = heroOf(spare)
        assertEquals("SPARE", hero.code)
        assertTrue(hero.codeIsWord)
        assertEquals("DT4084 breakdown · unit 05:28", hero.line)
        val callout = reasonOf(spare)!!
        assertEquals(Tone.WARN, callout.tone)
        assertTrue("**breakdown**" in callout.text)
        assertTrue("05:28" in callout.text)
    }

    @Test
    fun anIneligibleSpareReadsTheBoardsOwnSentence() {
        val spare = shift(
            status = "spare",
            reason = "ineligible",
            refusal = "SIMPER HD785 sudah habis",
            seat = null,
        )
        assertTrue("SIMPER HD785 sudah habis" in reasonOf(spare)!!.text)
    }

    @Test
    fun aSpareOnTheBoardWaitsForTheSecondFinger() {
        val waiting = shift(
            status = "spare",
            phase = "board",
            reason = "awaiting-second-finger",
            seat = null,
        )
        assertEquals("SPARE", heroOf(waiting).code)
        assertEquals("SPARE, menunggu finger kedua · 05:28", heroOf(waiting).line)
    }

    @Test
    fun theSecondFingerTimeIsNeverInventedWhenTheTimelineHasNone() {
        val spare = shift(
            status = "spare",
            reason = "no-plan-seat",
            planUnit = null,
            seat = null,
            gates = seededGates.copy(secondFinger = null),
        )
        assertEquals("Tanpa unit pegangan", heroOf(spare).line)
    }

    @Test
    fun aPersonNotRosteredIsOff() {
        val off = shift(status = "off", roster = "OFF", seat = null)
        assertEquals("OFF", heroOf(off).code)
        assertEquals("Tidak dijadwalkan shift ini", heroOf(off).line)
        assertEquals(Tone.NEUTRAL, heroOf(off).tone)
    }

    @Test
    fun aPersonAllocationIsNotAboutIsNeverCalledSpare() {
        val outside = shift(status = "not-allocated", planUnit = null, seat = null)
        val hero = heroOf(outside)
        assertEquals("—", hero.code)
        assertTrue("SPARE" !in hero.line)
    }

    @Test
    fun aStatusThisBuildDoesNotKnowAsksForAnUpdate() {
        val hero = heroOf(shift(status = "reserve", seat = null))
        assertEquals("—", hero.code)
        assertTrue("Perbarui aplikasi" in hero.line)
    }

    @Test
    fun noShiftWhenTheTimelineCannotDecide() {
        val hero = heroOf(null)
        assertEquals("—", hero.code)
        assertEquals("Shift belum bisa ditentukan", hero.line)
        assertNull(hero.where)
    }

    @Test
    fun aLateUploadReadsLateNotFail() {
        val late = shift(
            ftw = MyShiftFtw(
                verdict = "late",
                sentAt = "2026-10-18 05:24:10",
                sleepMinutes = 390,
                category = "Dapat Bekerja",
            ),
        )
        assertEquals(Pill("FTW terlambat · 05:24", Tone.WARN), ftwPill(late))
    }

    @Test
    fun aPassingUploadShowsItsTime() {
        val passed = shift(
            ftw = MyShiftFtw(
                verdict = "pass",
                sentAt = "2026-10-18 04:18:00",
                sleepMinutes = 372,
                category = "Dapat Bekerja",
            ),
        )
        assertEquals(Pill("FTW lolos · 04:18", Tone.OK), ftwPill(passed))
    }

    @Test
    fun theFingerPillStatesTheGateUntilTheTapThenTheTap() {
        assertEquals(Pill("Finger sebelum 05:25", Tone.NEUTRAL), fingerPill(shift()))
        assertEquals(
            Pill("Finger 05:03", Tone.INFO),
            fingerPill(shift(checkInAt = "05:03:41")),
        )
    }

    @Test
    fun theRequirementsWordSleepAndUpload() {
        val passed = shift(
            ftw = MyShiftFtw(
                verdict = "pass",
                sentAt = "2026-10-18 04:18:00",
                sleepMinutes = 372,
                category = "Dapat Bekerja",
            ),
        )
        val (ftw, finger) = requirementsOf(passed)
        assertEquals("Tidur 6 j 12 m · diunggah 04:18", ftw.note)
        assertEquals(Pill("Lolos", Tone.OK), ftw.badge)
        assertEquals("Batas 05:25", finger.note)
        assertEquals(Pill("Belum tap", Tone.NEUTRAL), finger.badge)
    }

    private val passedFtw = MyShiftFtw(
        verdict = "pass",
        sentAt = "2026-10-18 04:18:00",
        sleepMinutes = 372,
        category = "Dapat Bekerja",
    )

    @Test
    fun readinessCountsWhatTheApiPassedAndNamesWhatIsLeft() {
        val ftwOnly = readinessOf(shift(ftw = passedFtw))!!
        assertEquals(1, ftwOnly.met)
        assertEquals(2, ftwOnly.of)
        assertEquals("FTW sudah lolos. Tinggal finger pertama sebelum 05:25.", ftwOnly.note)

        val both = readinessOf(shift(ftw = passedFtw, checkInAt = "05:03:41"))!!
        assertEquals(2, both.met)
        assertEquals("FTW lolos dan finger tercatat 05:03.", both.note)

        val none = readinessOf(shift())!!
        assertEquals(0, none.met)
        assertEquals("Unggah FTW sebelum 05:22 dan finger sebelum 05:25.", none.note)
    }

    @Test
    fun aLateFtwIsNotCountedAsMet() {
        val late = readinessOf(shift(ftw = passedFtw.copy(verdict = "late"), checkInAt = "05:03:41"))!!
        assertEquals(1, late.met)
        assertEquals("Finger tercatat 05:03. FTW belum lolos: terlambat.", late.note)
    }

    @Test
    fun nobodyIsAskedToGetReadyForAShiftTheyDoNotWork() {
        assertNull(readinessOf(shift(status = "off", roster = "OFF")))
        assertNull(readinessOf(shift(status = "not-allocated")))
        assertNull(readinessOf(null))
    }
}
