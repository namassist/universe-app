package id.universe.mobile.app

import id.universe.mobile.data.SessionToken
import id.universe.mobile.data.TokenStore
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.HomeKind
import id.universe.mobile.domain.VersionVerdict
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val json = headersOf(HttpHeaders.ContentType, "application/json")

private class MemoryTokens(var saved: String? = null) : TokenStore {
    override suspend fun read() = saved
    override suspend fun write(token: String?) {
        saved = token
    }
}

private fun principal(mustChange: Boolean = false) = """
    {"kind":"user","id":"u1","name":"Rudi Hartono","email":null,"nik":"10234567",
     "roleId":"r1","roleName":"User","scope":"self","mustChangePassword":$mustChange}
""".trimIndent()

private const val OPERATOR_GRANTS = """{"roster-data":"view","attendance":"view","fit-to-work":"manage"}"""

private fun version(minimum: Int?, latest: Int?) =
    """{"platform":"android","minimumBuild":$minimum,"latestBuild":$latest,"downloadUrl":"https://u.test/app.apk"}"""

private typealias Route = MockRequestHandleScope.(HttpRequestData) -> HttpResponseData

private fun engine(routes: Map<String, Route>) = MockEngine { request ->
    val key = "${request.method.value} ${request.url.encodedPath}"
    val route = routes[key] ?: error("unexpected $key")
    route(request)
}

private fun model(tokens: MemoryTokens, build: Int = 5, routes: Map<String, Route>): AppModel {
    val token = SessionToken(null)
    return AppModel(UniverseApi("http://api.test", engine(routes), token), token, tokens, build)
}

private val current: Route = { respond(version(minimum = 1, latest = 5), HttpStatusCode.OK, json) }

class AppModelTest {
    @Test
    fun aBuildBelowTheMinimumIsStoppedBeforeLogin() = runTest {
        val app = model(MemoryTokens("s1"), build = 3, routes = mapOf(
            "GET /v1/mobile/version" to { respond(version(minimum = 4, latest = 6), HttpStatusCode.OK, json) },
        ))
        app.start()
        assertEquals(AppState.Blocked("https://u.test/app.apk"), app.state.value)
    }

    @Test
    fun aVersionCheckWithNoAnswerDoesNotLockAnyoneOut() = runTest {
        val app = model(MemoryTokens(), routes = mapOf(
            "GET /v1/mobile/version" to { throw IOException("offline") },
        ))
        app.start()
        assertIs<AppState.SignedOut>(app.state.value)
        assertEquals(VersionVerdict.Current, app.version.value)
    }

    @Test
    fun aSavedSessionTheApiStillKnowsOpensTheHome() = runTest {
        val app = model(MemoryTokens("s1"), routes = mapOf(
            "GET /v1/mobile/version" to { respond(version(minimum = 1, latest = 6), HttpStatusCode.OK, json) },
            "GET /v1/auth/session" to { request ->
                assertEquals("Bearer s1", request.headers[HttpHeaders.Authorization])
                respond("""{"principal":${principal()},"permissions":$OPERATOR_GRANTS}""", HttpStatusCode.OK, json)
            },
        ))
        app.start()
        val state = assertIs<AppState.SignedIn>(app.state.value)
        assertEquals(HomeKind.OPERATOR, state.access.home)
        assertIs<VersionVerdict.UpdateAvailable>(app.version.value)
    }

    @Test
    fun aSavedSessionTheApiForgotIsClearedAndAsksForLogin() = runTest {
        val tokens = MemoryTokens("stale")
        val app = model(tokens, routes = mapOf(
            "GET /v1/mobile/version" to current,
            "GET /v1/auth/session" to {
                respond("""{"code":"unauthenticated","message":"Sesi tidak valid"}""", HttpStatusCode.Unauthorized, json)
            },
        ))
        app.start()
        assertIs<AppState.SignedOut>(app.state.value)
        assertNull(tokens.saved)
    }

    @Test
    fun noAnswerWithASavedSessionOffersARetryNotALogin() = runTest {
        val tokens = MemoryTokens("s1")
        val app = model(tokens, routes = mapOf(
            "GET /v1/mobile/version" to current,
            "GET /v1/auth/session" to { throw IOException("offline") },
        ))
        app.start()
        assertEquals(AppState.Unreachable, app.state.value)
        assertEquals("s1", tokens.saved)
    }

    @Test
    fun loginAsksForABearerAndKeepsIt() = runTest {
        val tokens = MemoryTokens()
        val app = model(tokens, routes = mapOf(
            "GET /v1/mobile/version" to current,
            "POST /v1/auth/login" to { request ->
                val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
                assertTrue("\"transport\":\"bearer\"" in body, body)
                respond(
                    """{"principal":${principal(mustChange = true)},"permissions":$OPERATOR_GRANTS,"sessionId":"s9"}""",
                    HttpStatusCode.OK,
                    json,
                )
            },
        ))
        app.start()
        assertNull(app.login("10234567", "rahasia123"))
        assertEquals("s9", tokens.saved)
        val state = assertIs<AppState.SignedIn>(app.state.value)
        assertTrue(state.principal.mustChangePassword)
    }

    @Test
    fun aChangedPasswordOpensTheAppEvenIfTheSessionCannotBeReread() = runTest {
        val app = model(MemoryTokens(), routes = mapOf(
            "GET /v1/mobile/version" to current,
            "POST /v1/auth/login" to {
                respond(
                    """{"principal":${principal(mustChange = true)},"permissions":$OPERATOR_GRANTS,"sessionId":"s9"}""",
                    HttpStatusCode.OK,
                    json,
                )
            },
            "GET /v1/auth/session" to { throw IOException("offline") },
        ))
        app.start()
        app.login("10234567", "rahasia123")
        app.passwordChanged()
        val state = assertIs<AppState.SignedIn>(app.state.value)
        assertTrue(!state.principal.mustChangePassword)
    }

    @Test
    fun aRefusedLoginSaysWhatTheApiSaid() = runTest {
        val app = model(MemoryTokens(), routes = mapOf(
            "GET /v1/mobile/version" to current,
            "POST /v1/auth/login" to {
                respond(
                    """{"code":"too_many_attempts","message":"Terlalu banyak percobaan login. Coba lagi dalam 15 menit."}""",
                    HttpStatusCode.TooManyRequests,
                    json,
                )
            },
        ))
        app.start()
        assertEquals("Terlalu banyak percobaan login. Coba lagi dalam 15 menit.", app.login("10234567", "x"))
        assertIs<AppState.SignedOut>(app.state.value)
    }

    @Test
    fun logoutForgetsTheSessionEvenWithoutAnAnswer() = runTest {
        val tokens = MemoryTokens("s1")
        val app = model(tokens, routes = mapOf(
            "GET /v1/mobile/version" to current,
            "GET /v1/auth/session" to {
                respond("""{"principal":${principal()},"permissions":$OPERATOR_GRANTS}""", HttpStatusCode.OK, json)
            },
            "POST /v1/auth/logout" to { throw IOException("offline") },
        ))
        app.start()
        app.logout()
        assertIs<AppState.SignedOut>(app.state.value)
        assertNull(tokens.saved)
    }
}
