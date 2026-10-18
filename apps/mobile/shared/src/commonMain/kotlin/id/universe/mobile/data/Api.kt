package id.universe.mobile.data

import id.universe.mobile.api.apis.AttendanceApi
import id.universe.mobile.api.apis.AuthApi
import id.universe.mobile.api.apis.EmployeesApi
import id.universe.mobile.api.apis.FitToWorkApi
import id.universe.mobile.api.apis.MeApi
import id.universe.mobile.api.apis.MobileApi
import id.universe.mobile.api.apis.RosterApi
import id.universe.mobile.api.infrastructure.HttpResponse
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.concurrent.Volatile

/** The session id the API issued at login, sent back as a bearer (docs/prd.md, Mobile app). */
class SessionToken(initial: String?) {
    @Volatile
    var value: String? = initial
}

/** What a call came back with. The app shows the API's own sentence when it refuses. */
sealed interface Outcome<out T> {
    data class Ok<T>(val value: T) : Outcome<T>

    data class Refused(val status: Int, val code: String?, val message: String) : Outcome<Nothing>

    /** No answer: the phone is off the network, or the server is. */
    data object Offline : Outcome<Nothing>
}

const val OFFLINE_WORDS = "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi."

private const val APP_FAULT = "Permintaan gagal dibuat oleh aplikasi. Perbarui aplikasi."

/** What login and the password change answer a wrong password with (apps/api routes/auth.ts). */
private const val INVALID_CREDENTIALS = "invalid_credentials"

private const val CONNECT_TIMEOUT_MS = 10_000L
private const val REQUEST_TIMEOUT_MS = 20_000L

/** The sentence for a call that did not succeed, null for one that did. */
fun Outcome<*>.failureWords(): String? = when (this) {
    is Outcome.Ok -> null
    is Outcome.Refused -> message
    Outcome.Offline -> OFFLINE_WORDS
}

@Serializable
private data class ApiError(val code: String? = null, val message: String? = null)

/**
 * The generated client over one HTTP client. The bearer is added here rather
 * than through the generated security schemes, which the spec only names on
 * some operations: a call without the header would read as signed out.
 */
class UniverseApi(origin: String, engine: HttpClientEngine, private val session: SessionToken) {
    /** Called when a signed-in call is answered 401: the API no longer knows the session. */
    var onSessionLost: suspend () -> Unit = {}

    private val json = Json { ignoreUnknownKeys = true }

    private val http = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            connectTimeoutMillis = CONNECT_TIMEOUT_MS
            requestTimeoutMillis = REQUEST_TIMEOUT_MS
        }
        install(
            createClientPlugin("SessionBearer") {
                onRequest { request, _ ->
                    session.value?.let { request.headers[HttpHeaders.Authorization] = "Bearer $it" }
                }
            },
        )
    }

    val auth = AuthApi(origin, http)
    val me = MeApi(origin, http)
    val mobile = MobileApi(origin, http)
    val roster = RosterApi(origin, http)
    val employees = EmployeesApi(origin, http)
    val fitToWork = FitToWorkApi(origin, http)
    val attendance = AttendanceApi(origin, http)

    /**
     * One request, as an [Outcome]. [sessionBound] is false for the calls a
     * 401 does not end a session on: login, and checking a saved one.
     */
    suspend fun <T : Any> call(
        sessionBound: Boolean = true,
        request: suspend UniverseApi.() -> HttpResponse<T>,
    ): Outcome<T> {
        val sent = session.value
        val response = try {
            request()
        } catch (e: CancellationException) {
            throw e
        } catch (_: IOException) {
            /* Timeouts and resets included: Ktor's are IOExceptions too. */
            return Outcome.Offline
        } catch (_: Exception) {
            return Outcome.Refused(0, null, APP_FAULT)
        }
        if (response.success) {
            return try {
                Outcome.Ok(response.body())
            } catch (e: CancellationException) {
                throw e
            } catch (_: IOException) {
                Outcome.Offline
            } catch (_: Exception) {
                Outcome.Refused(response.status, null, "Jawaban server tidak terbaca. Perbarui aplikasi.")
            }
        }
        val error = readError(response)
        /*
         * A 401 ends the session unless it is a wrong password (login, password
         * change), or it answers a session already replaced: a request that left
         * before a logout and a new login must not end the new one.
         */
        if (sessionBound && response.status == 401 && error?.code != INVALID_CREDENTIALS && session.value == sent) {
            onSessionLost()
        }
        return Outcome.Refused(
            response.status,
            error?.code,
            error?.message ?: "Server tidak bisa memproses permintaan (${response.status}). Coba lagi.",
        )
    }

    private suspend fun readError(response: HttpResponse<*>): ApiError? =
        try {
            json.decodeFromString<ApiError>(response.response.bodyAsText())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
}
