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
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

sealed interface Load<out T> {
    data object Loading : Load<Nothing>

    data class Ready<T>(val value: T) : Load<T>

    data class Failed(val words: String) : Load<Nothing>
}

class LoadHandle<T>(private val state: MutableState<Load<T>>, val reload: () -> Unit) {
    val value: Load<T> get() = state.value
}

/**
 * A call made when the screen opens, and again on [LoadHandle.reload]. A
 * refresh that fails keeps what was already shown rather than blanking it.
 */
@Composable
fun <T : Any> rememberLoad(vararg keys: Any?, fetch: suspend () -> Outcome<T>): LoadHandle<T> {
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(fetch)
    val state = remember(*keys) { mutableStateOf<Load<T>>(Load.Loading) }
    val run: suspend () -> Unit = {
        val outcome = latest()
        state.value = when {
            outcome is Outcome.Ok -> Load.Ready(outcome.value)
            state.value is Load.Ready -> state.value
            else -> Load.Failed(outcome.failureWords().orEmpty())
        }
    }
    LaunchedEffect(*keys) { run() }
    /* One reload at a time: a slow older answer must not overwrite a newer one. */
    val running = remember(*keys) { arrayOfNulls<Job>(1) }
    return remember(state) {
        LoadHandle(state) {
            running[0]?.cancel()
            if (state.value is Load.Failed) state.value = Load.Loading
            running[0] = scope.launch { run() }
        }
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
