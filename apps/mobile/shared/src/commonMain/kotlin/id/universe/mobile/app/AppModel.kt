package id.universe.mobile.app

import id.universe.mobile.api.apis.MobileApi.PlatformGetV1MobileVersion
import id.universe.mobile.api.models.PostV1AuthLoginRequest
import id.universe.mobile.data.OFFLINE_WORDS
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.Permissions
import id.universe.mobile.data.Principal
import id.universe.mobile.data.SessionToken
import id.universe.mobile.data.TokenStore
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.Access
import id.universe.mobile.domain.VersionVerdict
import id.universe.mobile.domain.accessOf
import id.universe.mobile.domain.versionVerdict
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface AppState {
    data object Starting : AppState

    /** Below the minimum build: nothing but the download (docs/prd.md, Mobile app → Client stack). */
    data class Blocked(val downloadUrl: String?) : AppState

    /** A saved session that could not be checked: retry, rather than asking for the password again. */
    data object Unreachable : AppState

    data class SignedOut(val notice: String? = null) : AppState

    data class SignedIn(val principal: Principal, val permissions: Permissions, val access: Access) : AppState
}

private const val SESSION_ENDED = "Sesi berakhir. Silakan masuk lagi."

/** Version gate, session and sign-in: what decides which screen the app opens on. */
class AppModel(
    private val api: UniverseApi,
    private val session: SessionToken,
    private val tokens: TokenStore,
    private val build: Int,
    private val platform: PlatformGetV1MobileVersion = PlatformGetV1MobileVersion.ANDROID,
) {
    private val _state = MutableStateFlow<AppState>(AppState.Starting)
    val state: StateFlow<AppState> = _state.asStateFlow()

    private val _version = MutableStateFlow<VersionVerdict>(VersionVerdict.Current)
    val version: StateFlow<VersionVerdict> = _version.asStateFlow()

    init {
        api.onSessionLost = { forget(SESSION_ENDED) }
    }

    /**
     * Asks the version first, with no session: a build too old to read today's
     * answers should not get as far as reading them. A check that gets no
     * answer blocks nobody.
     */
    suspend fun start() {
        _state.value = AppState.Starting
        val answer = api.call(sessionBound = false) { mobile.getV1MobileVersion(platform) }
        val verdict = if (answer is Outcome.Ok) {
            versionVerdict(build, answer.value.minimumBuild, answer.value.latestBuild, answer.value.downloadUrl)
        } else {
            VersionVerdict.Current
        }
        _version.value = verdict
        if (verdict is VersionVerdict.Unsupported) {
            _state.value = AppState.Blocked(verdict.downloadUrl)
            return
        }
        resume()
    }

    /** Opens on the saved session if the API still knows it. */
    suspend fun resume() {
        val saved = tokens.read()
        if (saved == null) {
            _state.value = AppState.SignedOut()
            return
        }
        session.value = saved
        when (val answer = api.call(sessionBound = false) { auth.getV1AuthSession() }) {
            is Outcome.Ok -> signIn(answer.value.principal, answer.value.permissions)
            is Outcome.Refused ->
                if (answer.status == 401) forget(null) else _state.value = AppState.Unreachable
            Outcome.Offline -> _state.value = AppState.Unreachable
        }
    }

    /** Null when signed in, else the sentence to show under the form. */
    suspend fun login(nik: String, password: String): String? {
        val answer = api.call(sessionBound = false) {
            auth.postV1AuthLogin(
                PostV1AuthLoginRequest(nik.trim(), password, PostV1AuthLoginRequest.Transport.BEARER),
            )
        }
        return when (answer) {
            is Outcome.Ok -> {
                val id = answer.value.sessionId ?: return "Server tidak memberi sesi. Perbarui aplikasi."
                tokens.write(id)
                session.value = id
                signIn(answer.value.principal, answer.value.permissions)
                null
            }
            is Outcome.Refused -> answer.message
            Outcome.Offline -> OFFLINE_WORDS
        }
    }

    /**
     * The API accepted a new password: the gate opens at once, and the session
     * is re-read when it can be. A re-read that gets no answer must not leave
     * the person on the forced screen holding a password that no longer works.
     */
    suspend fun passwordChanged() {
        val current = _state.value as? AppState.SignedIn ?: return
        _state.value = current.copy(principal = current.principal.copy(mustChangePassword = false))
        val answer = api.call { auth.getV1AuthSession() }
        if (answer is Outcome.Ok) signIn(answer.value.principal, answer.value.permissions)
    }

    /** Forgets the session on the phone whether or not the API heard the logout. */
    suspend fun logout() {
        api.call(sessionBound = false) { auth.postV1AuthLogout() }
        forget(null)
    }

    private fun signIn(principal: Principal, permissions: Permissions) {
        _state.value = AppState.SignedIn(principal, permissions, accessOf(permissions))
    }

    /**
     * Signed out on screen first, then on disk, and the write is not cancelled
     * with the screen whose call found the session gone.
     */
    private suspend fun forget(notice: String?) {
        session.value = null
        _state.value = AppState.SignedOut(notice)
        withContext(NonCancellable) { tokens.write(null) }
    }
}
