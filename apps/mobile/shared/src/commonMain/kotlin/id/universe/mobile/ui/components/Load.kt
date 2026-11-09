package id.universe.mobile.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.failureWords
import id.universe.mobile.domain.Callout
import id.universe.mobile.domain.Tone
import id.universe.mobile.domain.siteNow
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

sealed interface Load<out T> {
    data object Loading : Load<Nothing>

    data class Ready<T>(val value: T) : Load<T>

    data class Failed(val words: String) : Load<Nothing>
}

class LoadHandle<T>(
    private val state: MutableState<Load<T>>,
    private val stale: MutableState<String?>,
    /** Asked for by a person: a failure on screen turns back into "Memuat…". */
    val reload: () -> Unit,
    /** Asked for by a timer: whatever is on screen stays there until the answer. */
    val refresh: () -> Unit,
) {
    val value: Load<T> get() = state.value

    /** "HH:MM" of the data on screen when refreshing it last failed; null while it is current. */
    val staleSince: String? get() = stale.value
}

/**
 * A call made when the screen opens, and again on [LoadHandle.reload] or
 * [LoadHandle.refresh]. A refresh that fails keeps what was already shown
 * rather than blanking it, and says since when it has been showing.
 */
@Composable
fun <T : Any> rememberLoad(vararg keys: Any?, fetch: suspend () -> Outcome<T>): LoadHandle<T> {
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(fetch)
    val state = remember(*keys) { mutableStateOf<Load<T>>(Load.Loading) }
    val stale = remember(*keys) { mutableStateOf<String?>(null) }
    val current = remember(*keys) { arrayOfNulls<String>(1) }
    val run: suspend () -> Unit = {
        val outcome = latest()
        when {
            outcome is Outcome.Ok -> {
                state.value = Load.Ready(outcome.value)
                current[0] = siteNow().time.toString().take(5)
                stale.value = null
            }
            state.value is Load.Ready -> stale.value = current[0]
            else -> state.value = Load.Failed(outcome.failureWords().orEmpty())
        }
    }
    LaunchedEffect(*keys) { run() }
    /* One reload at a time: a slow older answer must not overwrite a newer one. */
    val running = remember(*keys) { arrayOfNulls<Job>(1) }
    return remember(state) {
        val again: (Boolean) -> Unit = { asked ->
            running[0]?.cancel()
            if (asked && state.value is Load.Failed) state.value = Load.Loading
            running[0] = scope.launch { run() }
        }
        LoadHandle(state, stale, reload = { again(true) }, refresh = { again(false) })
    }
}

/** Said above data that could not be refreshed: the supervisor is not reading a live board. */
@Composable
fun StaleNote(handle: LoadHandle<*>) {
    handle.staleSince?.let {
        Callout(Callout("Belum bisa memperbarui. Data terakhir pukul **$it**.", Tone.WARN))
    }
}

/** The loaded content, or a quiet "Memuat…", or the failure with a way to try again. */
@Composable
fun <T> Loaded(handle: LoadHandle<T>, content: @Composable (T) -> Unit) {
    when (val load = handle.value) {
        Load.Loading -> Note("Memuat…", Modifier.padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite })
        is Load.Failed -> Failure(load.words, handle.reload)
        is Load.Ready -> content(load.value)
    }
}

@Composable
fun Failure(words: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Callout(Callout(words, Tone.BAD))
        ActionButton("Coba lagi", onRetry, kind = ButtonKind.GHOST)
    }
}
