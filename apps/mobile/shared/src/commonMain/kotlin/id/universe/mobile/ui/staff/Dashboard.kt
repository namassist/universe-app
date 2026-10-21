package id.universe.mobile.ui.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.DashCard
import id.universe.mobile.domain.DashLink
import id.universe.mobile.domain.ReportKind
import id.universe.mobile.domain.Topic
import id.universe.mobile.domain.dashboardView
import id.universe.mobile.ui.LaporanDetailRoute
import id.universe.mobile.ui.PapanRoute
import id.universe.mobile.ui.UnitStatusRoute
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Progress
import id.universe.mobile.ui.components.Section
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Corners
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.lift

/**
 * The Dashboard (docs/prd.md, Mobile app; DESIGN.md → Dashboard and Laporan):
 * the web dashboard's counts as fact cards, with no charts. What arrives is
 * what the account's grants allow; a figure opens only a screen that lists
 * exactly it.
 */
@Composable
fun DashboardScreen(api: UniverseApi, onBack: () -> Unit, go: (Any) -> Unit) {
    val dashboard = rememberLoad("dashboard") { api.call { dashboard.getV1Dashboard() } }
    InnerScreen("Dashboard", onBack) {
        Loaded(dashboard) { data ->
            val view = dashboardView(data)
            val open = { link: DashLink ->
                go(
                    when (link) {
                        DashLink.BOARD -> PapanRoute()
                        DashLink.UNITS -> UnitStatusRoute
                        DashLink.EMPTY_UNITS_REPORT ->
                            LaporanDetailRoute(ReportKind.EQUIPMENT_NO_OPERATOR.value, data.date, data.shift)
                    },
                )
            }
            Note(view.heading)
            if (view.empty) {
                Note("Akun ini tidak memegang menu yang angkanya tampil di dashboard.")
                return@Loaded
            }
            view.cards.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    pair.forEach { card -> DashFact(card, Modifier.weight(1f), card.link?.let { { open(it) } }) }
                    /* An odd card keeps its half: a full-width one would read as more important. */
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (view.attention.isNotEmpty()) {
                Section("Perlu perhatian") {
                    ListGroup {
                        view.attention.forEachIndexed { index, line ->
                            if (index > 0) Hairline()
                            ListRow(
                                line.title,
                                notes = listOf(line.note),
                                glyph = when (line.topic) {
                                    Topic.UNITS -> Glyph.TRUCK
                                    Topic.FTW -> Glyph.HEART
                                    Topic.SIMPER -> Glyph.CARD
                                },
                                onClick = line.link?.let { { open(it) } },
                            ) { Badge(line.badge) }
                        }
                    }
                }
            }
            if (view.categories.isNotEmpty()) {
                Section("Operator per kategori") {
                    ListGroup {
                        view.categories.forEachIndexed { index, line ->
                            if (index > 0) Hairline()
                            ListRow(line.title, notes = listOf(line.note))
                        }
                    }
                }
            }
            Note("Shift yang dihitung: siang sebelum jam 12:00, malam sesudahnya, seperti dashboard web. Grafik tetap di console web.")
        }
    }
}

/** A figure, what it counts and a note, with its bar when it is part of a whole. */
@Composable
private fun DashFact(card: DashCard, modifier: Modifier, onClick: (() -> Unit)?) {
    val palette = Theme.palette
    Column(
        modifier
            .lift(Corners.card, palette)
            .background(palette.surface, Corners.card)
            .clip(Corners.card)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Txt(card.figure, Theme.type.factTime, color = palette.action)
        Txt(card.title, Theme.type.bodyStrong)
        Txt(card.note, Theme.type.body, color = palette.inkMuted)
        card.percent?.let { Progress(it / 100f, Modifier.padding(top = 8.dp)) }
    }
}
