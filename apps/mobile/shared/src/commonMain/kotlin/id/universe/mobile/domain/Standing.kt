package id.universe.mobile.domain

import id.universe.mobile.data.MyShift
import kotlinx.datetime.LocalDateTime

/*
 * The operator's standing for the coming shift, worded from /v1/me/shift.
 *
 * Nothing here decides anything: the API has already said holder or spare
 * and why, with the board's and the slip's own rules (docs/prd.md, Mobile app
 * → User). This turns that answer into the words and hues on the screen, and
 * every time it names comes from the timeline through `gates`, never from a
 * constant here.
 */

data class Hero(
    val chip: String,
    val code: String,
    /** A word (SPARE, OFF) rather than a unit code: drawn a size smaller. */
    val codeIsWord: Boolean,
    val line: String,
    val tone: Tone,
    val where: String?,
)

data class Requirement(val title: String, val note: String, val badge: Pill)

data class Fact(val time: String, val title: String, val note: String)

/** FAILED: a stage the scheduler refused or never ran (the Superadmin's monitor). */
enum class StepState { DONE, NOW, WAIT, FAILED }

data class Step(val time: String, val name: String, val state: StepState)

private const val NO_CODE = "—"

private fun MyShift.isSeatedSpare() = status == "spare" && seat != null

fun heroOf(shift: MyShift?): Hero {
    if (shift == null) {
        return Hero("Shift belum diketahui", NO_CODE, true, "Shift belum bisa ditentukan", Tone.NEUTRAL, null)
    }
    val chip = "Shift ${shiftWord(shift.shift)}" + (shift.roster?.let { " · Roster $it" } ?: "")
    val where = shift.seat
        ?.let { listOfNotNull(it.fleet, it.area).joinToString(" · ") }
        ?.ifEmpty { null }
    val board = shift.gates.board
    return when {
        shift.status == "holder" && shift.phase == "board" -> Hero(
            chip, shift.seat?.unit ?: shift.planUnit ?: NO_CODE, false,
            board?.let { "Final · papan $it" } ?: "Final · dari papan", Tone.OK, where,
        )
        shift.status == "holder" && shift.reason == "partner-rostered" -> Hero(
            chip, shift.seat?.unit ?: shift.planUnit ?: NO_CODE, false,
            "Pegangan · partner juga dijadwalkan", Tone.WARN, where,
        )
        shift.status == "holder" -> Hero(
            chip, shift.seat?.unit ?: shift.planUnit ?: NO_CODE, false,
            board?.let { "Pegangan · rencana s.d. $it" } ?: "Pegangan · rencana, belum final",
            Tone.WARN, where,
        )
        shift.isSeatedSpare() -> Hero(chip, shift.seat!!.unit, false, "Final · dari pool spare", Tone.OK, where)
        shift.status == "spare" -> Hero(chip, "SPARE", true, spareLine(shift), Tone.WARN, null)
        shift.status == "off" -> Hero(chip, shift.roster ?: "OFF", true, "Tidak dijadwalkan shift ini", Tone.NEUTRAL, null)
        shift.status == "not-allocated" ->
            Hero(chip, NO_CODE, true, "Tidak termasuk alokasi unit", Tone.NEUTRAL, null)
        else -> Hero(chip, NO_CODE, true, "Status belum dikenal. Perbarui aplikasi.", Tone.NEUTRAL, null)
    }
}

private fun spareLine(shift: MyShift): String {
    val unit = shift.planUnit ?: "Unit pegangan"
    val opens = shift.gates.secondFinger?.let { " · unit $it" } ?: ""
    return when (shift.reason) {
        "breakdown" -> "$unit breakdown$opens"
        "not-in-fleet" -> "$unit di luar alokasi$opens"
        "ineligible" -> "SIMPER tidak berlaku untuk $unit$opens"
        "partner-rostered" -> "$unit dipegang partner$opens"
        "no-plan-seat" -> "Tanpa unit pegangan$opens"
        "awaiting-second-finger" ->
            "SPARE, menunggu finger kedua" + (shift.gates.secondFinger?.let { " · $it" } ?: "")
        "not-seated" -> "Tidak mendapat unit di papan"
        else -> "Spare$opens"
    }
}

/** "Rencana" until the board, then what the board says. */
fun badgeOf(shift: MyShift): Pill {
    val board = shift.gates.board
    return when {
        shift.status == "off" -> Pill("Tidak dijadwalkan", Tone.NEUTRAL)
        shift.status == "not-allocated" -> Pill("Di luar alokasi", Tone.NEUTRAL)
        shift.phase == "plan" -> Pill("Rencana · belum final", Tone.WARN)
        shift.status == "holder" || shift.isSeatedSpare() ->
            Pill(board?.let { "Final · papan $it" } ?: "Final", Tone.OK)
        shift.reason == "awaiting-second-finger" -> Pill("Menunggu finger kedua", Tone.WARN)
        else -> Pill("Papan · tanpa unit", Tone.WARN)
    }
}

/** Why the person stands where they do, in a sentence. */
fun reasonOf(shift: MyShift): Callout? {
    val g = shift.gates
    val unit = shift.planUnit?.let { "**$it**" } ?: "pegangan"
    val boardAt = g.board?.let { "pukul $it" } ?: "saat papan dibuat"
    val spareAt = g.secondFinger?.let { "pukul $it, bersamaan dengan tiket finger kedua" }
        ?: "bersamaan dengan tiket finger kedua"
    val spareOpens = "Unit dari pool spare tampil di sini $spareAt."
    return when {
        shift.status == "holder" && shift.phase == "board" ->
            Callout("Papan dibuat $boardAt. Kamu di **${shift.seat?.unit ?: shift.planUnit}**.", Tone.OK)
        shift.status == "holder" && shift.reason == "partner-rostered" -> Callout(
            "Kamu pegangan $unit, tapi partner kamu juga dijadwalkan di shift ini. " +
                "Saat papan dibuat, satu dari kalian mendapat unit ini dan yang lain menjadi spare.",
            Tone.WARN,
        )
        shift.status == "holder" -> Callout(
            "Kamu pegangan $unit. Unit final ditetapkan $boardAt setelah FTW dan finger divalidasi.",
            Tone.INFO,
        )
        shift.isSeatedSpare() ->
            Callout("Papan dibuat $boardAt. Kamu mendapat **${shift.seat!!.unit}** dari pool spare.", Tone.OK)
        shift.status == "spare" -> when (shift.reason) {
            "breakdown" -> Callout(
                "Unit pegangan $unit sedang **breakdown**, jadi hari ini kamu spare. $spareOpens",
                Tone.WARN,
            )
            "not-in-fleet" -> Callout(
                "Unit pegangan $unit tidak masuk alokasi fleet hari ini, jadi kamu spare. $spareOpens",
                Tone.WARN,
            )
            "ineligible" -> Callout(
                "Kamu spare untuk unit $unit: ${shift.refusal ?: "SIMPER tidak berlaku untuk unit ini"}. $spareOpens",
                Tone.WARN,
            )
            "partner-rostered" -> Callout(
                "Unit pegangan $unit dipegang partner kamu di shift ini, jadi kamu spare. $spareOpens",
                Tone.WARN,
            )
            "no-plan-seat" -> Callout(
                "Kamu tidak punya unit pegangan, jadi hari ini kamu spare. $spareOpens",
                Tone.WARN,
            )
            "awaiting-second-finger" -> Callout(
                "Papan sudah dibuat. Unitmu tampil di sini $spareAt, sama seperti tiketmu.",
                Tone.WARN,
            )
            "not-seated" -> Callout(
                "Papan sudah dibuat dan kamu tidak mendapat unit. Tiketmu tertulis SPARE.",
                Tone.WARN,
            )
            else -> null
        }
        shift.status == "off" -> Callout(
            "Roster kamu ${dayLabel(shift.date)} adalah **${shift.roster ?: "-"}**, " +
                "jadi kamu tidak dijadwalkan di shift ${shiftWord(shift.shift).lowercase()}.",
            Tone.INFO,
        )
        shift.status == "not-allocated" -> Callout(
            "Posisi atau status kamu tidak termasuk alokasi unit, jadi tidak ada unit yang ditampilkan.",
            Tone.INFO,
        )
        else -> null
    }
}

fun ftwPill(shift: MyShift): Pill {
    val ftw = shift.ftw ?: return Pill("FTW belum diunggah", Tone.NEUTRAL)
    val at = clockOf(ftw.sentAt)?.let { " · $it" } ?: ""
    return when (ftw.verdict) {
        "pass" -> Pill("FTW lolos$at", Tone.OK)
        "late" -> Pill("FTW terlambat$at", Tone.WARN)
        "fail" -> Pill("FTW tidak lolos", Tone.BAD)
        "missing" -> Pill("FTW belum ada", Tone.NEUTRAL)
        "unreadable" -> Pill("FTW tak terbaca", Tone.WARN)
        "not-required" -> Pill("FTW tidak wajib", Tone.NEUTRAL)
        else -> Pill("FTW diunggah$at", Tone.NEUTRAL)
    }
}

/**
 * The tap, or the gate it must beat. Whether a tap beat the gate is the
 * API's to say (`late` on the attendance list), so the pill states the time
 * and leaves the verdict to "Riwayat".
 */
fun fingerPill(shift: MyShift): Pill = when {
    shift.checkInAt != null -> Pill("Finger ${clockOf(shift.checkInAt)}", Tone.INFO)
    shift.gates.fingerIn != null -> Pill("Finger sebelum ${shift.gates.fingerIn}", Tone.NEUTRAL)
    else -> Pill("Belum finger", Tone.NEUTRAL)
}

fun busPill(shift: MyShift): Pill? = shift.seat?.bus?.let { Pill(it, Tone.NEUTRAL) }

private fun ftwBadge(shift: MyShift): Pill = when (shift.ftw?.verdict) {
    "pass" -> Pill("Lolos", Tone.OK)
    "late" -> Pill("Terlambat", Tone.WARN)
    "fail" -> Pill("Tidak lolos", Tone.BAD)
    "unreadable" -> Pill("Tak terbaca", Tone.WARN)
    "not-required" -> Pill("Tidak wajib", Tone.NEUTRAL)
    null, "missing" -> if (shift.ftw == null) Pill("Belum ada", Tone.NEUTRAL) else Pill("Diunggah", Tone.NEUTRAL)
    else -> Pill(shift.ftw!!.verdict!!, Tone.NEUTRAL)
}

/** The two things a unit asks of its operator: a passing FTW and the first tap. */
fun requirementsOf(shift: MyShift): List<Requirement> {
    val ftw = shift.ftw
    val ftwNote = if (ftw == null) {
        shift.gates.ftwDeadline?.let { "Batas unggah $it" } ?: "Belum diunggah"
    } else {
        listOfNotNull(
            ftw.sleepMinutes?.let { "Tidur ${sleepLabel(it)}" },
            clockOf(ftw.sentAt)?.let { "diunggah $it" },
        ).joinToString(" · ")
    }
    val finger = Requirement(
        "Finger pertama",
        shift.gates.fingerIn?.let { "Batas $it" } ?: "Batas belum diatur",
        shift.checkInAt?.let { Pill(clockOf(it)!!, Tone.INFO) } ?: Pill("Belum tap", Tone.NEUTRAL),
    )
    return listOf(Requirement("Fit To Work", ftwNote, ftwBadge(shift)), finger)
}

data class Readiness(val met: Int, val of: Int, val note: String)

private fun ftwWord(verdict: String?): String = when (verdict) {
    "late" -> "terlambat"
    "fail" -> "tidak lolos"
    "unreadable" -> "tak terbaca"
    null, "missing" -> "belum ada"
    else -> verdict
}

/**
 * "Kesiapan hari ini": how many of the two requirements the API has already
 * passed. A late FTW is not counted, as the board does not count it. Null
 * for a shift the person does not work.
 */
fun readinessOf(shift: MyShift?): Readiness? {
    if (shift == null || shift.status == "off" || shift.status == "not-allocated") return null
    val g = shift.gates
    val verdict = shift.ftw?.verdict
    val ftwMet = verdict == "pass" || verdict == "not-required"
    val tap = clockOf(shift.checkInAt)
    val fingerBy = g.fingerIn?.let { "finger sebelum $it" } ?: "finger pertama"
    val note = when {
        ftwMet && tap != null ->
            (if (verdict == "pass") "FTW lolos" else "FTW tidak wajib") + " dan finger tercatat $tap."
        ftwMet -> "FTW sudah lolos. Tinggal ${g.fingerIn?.let { "finger pertama sebelum $it" } ?: "finger pertama"}."
        tap != null -> "Finger tercatat $tap. FTW belum lolos: ${ftwWord(verdict)}."
        shift.ftw == null -> "Unggah FTW${g.ftwDeadline?.let { " sebelum $it" } ?: ""} dan $fingerBy."
        else -> "FTW belum lolos: ${ftwWord(verdict)}. Lalu $fingerBy."
    }
    return Readiness(listOf(ftwMet, tap != null).count { it }, 2, note)
}

/** The two moments of the morning that matter to this person. */
fun factsOf(shift: MyShift): List<Fact> {
    val g = shift.gates
    val first = when {
        shift.status == "spare" && !shift.isSeatedSpare() ->
            Fact(g.secondFinger ?: NO_CODE, "Finger kedua", "Unit spare dibuka")
        shift.phase == "board" ->
            Fact(g.board ?: NO_CODE, "Papan dibuat", "${shift.seat?.unit ?: "Unit"} ditetapkan")
        else -> Fact(g.board ?: NO_CODE, "Papan dibuat", "Unit final ditetapkan")
    }
    val bus = Fact(g.busDepart ?: NO_CODE, "Bus berangkat", shift.seat?.bus ?: "Bus menyusul")
    return listOf(first, bus)
}

/**
 * The shift's gates as a rail, by the site's clock: those passed are done,
 * the next is now. Times come from the timeline; a gate it lacks is left out.
 */
fun stepsOf(shift: MyShift, now: LocalDateTime): List<Step> {
    val g = shift.gates
    val gates = listOfNotNull(
        g.ftwDeadline?.let { it to "Batas upload FTW" },
        g.fingerIn?.let { it to "Batas finger pertama" },
        g.board?.let { it to "Papan alokasi dibuat" },
        g.secondFinger?.let { it to "Finger kedua" },
        g.busDepart?.let { it to "Bus berangkat" },
    )
    val stamp = "${now.date} ${now.time.toString().take(5)}"
    var nowTaken = false
    return gates.map { (time, name) ->
        val state = when {
            stamp >= "${shift.date} $time" -> StepState.DONE
            !nowTaken -> StepState.NOW.also { nowTaken = true }
            else -> StepState.WAIT
        }
        Step(time, name, state)
    }
}
