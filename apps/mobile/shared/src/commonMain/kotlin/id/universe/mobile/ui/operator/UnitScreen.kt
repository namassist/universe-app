package id.universe.mobile.ui.operator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import id.universe.mobile.api.models.GetV1MeShift200Response
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.badgeOf
import id.universe.mobile.domain.dayLabel
import id.universe.mobile.domain.heroOf
import id.universe.mobile.domain.reasonOf
import id.universe.mobile.domain.requirementsOf
import id.universe.mobile.domain.shiftWord
import id.universe.mobile.domain.siteNow
import id.universe.mobile.domain.stepsOf
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Callout
import id.universe.mobile.ui.components.Card
import id.universe.mobile.ui.components.Duo
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.Labelled
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.LoadHandle
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Section
import id.universe.mobile.ui.components.StepRow
import id.universe.mobile.ui.components.Steps
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme

typealias MyShiftAnswer = GetV1MeShift200Response

/** "Unit saya": holder or spare, and why, so nobody has to guess (docs/prd.md, Mobile app → User). */
@Composable
fun UnitScreen(shift: LoadHandle<MyShiftAnswer>, onBack: () -> Unit) {
    InnerScreen("Unit saya", onBack) {
        Loaded(shift) { answer ->
            val current = answer.shift
            if (current == null) {
                Callout(
                    Callout(
                        "Shift yang berjalan belum bisa ditentukan dari timeline. Coba lagi beberapa saat lagi.",
                        Tone.INFO,
                    ),
                )
                return@Loaded
            }
            val hero = heroOf(current)
            Card(padding = 18) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Badge(badgeOf(current))
                    Note("${dayLabel(current.date)} · ${shiftWord(current.shift)}")
                }
                Txt(hero.code, if (hero.codeIsWord) Theme.type.displayWord else Theme.type.displayCard)
                Duo(
                    { Labelled("Lokasi", hero.where ?: "—", it) },
                    { Labelled("Bus", current.seat?.bus ?: "Menyusul", it) },
                    gap = 8,
                )
            }
            reasonOf(current)?.let { Callout(it) }
            if (current.isWorked()) {
                Section("Syarat masuk unit") {
                    ListGroup {
                        requirementsOf(current).forEachIndexed { index, requirement ->
                            if (index > 0) Hairline()
                            ListRow(
                                requirement.title,
                                notes = listOf(requirement.note),
                                glyph = if (index == 0) Glyph.HEART else Glyph.FINGER,
                            ) { Badge(requirement.badge) }
                        }
                    }
                }
                val steps = stepsOf(current, siteNow())
                if (steps.isNotEmpty()) {
                    Section("Timeline ${current.partOfDay().lowercase()}") {
                        ListGroup { Steps(steps.map { StepRow(it.time, it.name, null, it.state) }) }
                    }
                }
            }
        }
    }
}
