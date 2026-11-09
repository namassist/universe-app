package id.universe.mobile.ui.operator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.data.failureWords
import id.universe.mobile.domain.Pill
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.noticeWhen
import id.universe.mobile.domain.noticeWords
import id.universe.mobile.domain.siteToday
import id.universe.mobile.ui.LocalToast
import id.universe.mobile.ui.components.ActionButton
import id.universe.mobile.ui.components.Badge
import id.universe.mobile.ui.components.ButtonKind
import id.universe.mobile.ui.components.Hairline
import id.universe.mobile.ui.components.InnerScreen
import id.universe.mobile.ui.components.ListGroup
import id.universe.mobile.ui.components.ListRow
import id.universe.mobile.ui.components.Loaded
import id.universe.mobile.ui.components.Note
import id.universe.mobile.ui.components.Txt
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.theme.Theme
import kotlinx.coroutines.launch

/**
 * The person's own notices that have come due: the same rows a push carries,
 * so one that never arrived is read here (docs/prd.md, Notifications on the phone).
 */
@Composable
fun NotifScreen(api: UniverseApi, onBack: () -> Unit) {
    val notices = rememberLoad("notices") { api.call { me.getV1MeNotifications() } }
    val scope = rememberCoroutineScope()
    val toast = LocalToast.current
    val today = remember { siteToday() }
    val palette = Theme.palette
    InnerScreen("Notifikasi", onBack) {
        Loaded(notices) { page ->
            if (page.items.isEmpty()) {
                Note("Belum ada notifikasi. Kabar unit kamu muncul di sini saat papan dibuat.")
                return@Loaded
            }
            ListGroup {
                page.items.forEachIndexed { index, notice ->
                    if (index > 0) Hairline()
                    val words = noticeWords(notice)
                    val unread = notice.readAt == null
                    ListRow(
                        words.title,
                        notes = listOf(words.body),
                        glyph = when (notice.kind) {
                            "seat-assigned" -> Glyph.TRUCK
                            "seat-removed" -> Glyph.WARN
                            else -> Glyph.BELL
                        },
                        background = if (unread) palette.actionSoft else Color.Transparent,
                        onClick = if (unread) {
                            {
                                scope.launch {
                                    api.call { me.postV1MeNotificationsByIdRead(notice.id) }.failureWords()?.let(toast)
                                    notices.reload()
                                }
                            }
                        } else {
                            null
                        },
                        chevron = false,
                    ) {
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Txt(
                                noticeWhen(notice.availableAt, today),
                                Theme.type.label.copy(fontFeatureSettings = "tnum"),
                                color = palette.inkFaint,
                            )
                            if (unread) Badge(Pill("Baru", Tone.INFO))
                        }
                    }
                }
            }
            if (page.unread > 0) {
                ActionButton(
                    "Tandai semua dibaca",
                    {
                        scope.launch {
                            val answer = api.call { me.postV1MeNotificationsReadAll() }
                            toast(answer.failureWords() ?: "Semua notifikasi ditandai dibaca")
                            notices.reload()
                        }
                    },
                    kind = ButtonKind.GHOST,
                )
            }
        }
    }
}
