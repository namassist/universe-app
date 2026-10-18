package id.universe.mobile.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private val json = headersOf(HttpHeaders.ContentType, "application/json")

class ApiTest {
    @Test
    fun everyCallCarriesTheSessionAsABearer() = runTest {
        val seen = mutableListOf<String?>()
        val engine = MockEngine { request ->
            seen += request.headers[HttpHeaders.Authorization]
            respond("[]", HttpStatusCode.OK, json)
        }
        val api = UniverseApi("http://api.test", engine, SessionToken("s3cret"))
        /* The generated roster call names no security scheme; the header is the client's. */
        api.call { roster.getV1Roster(month = "2026-10") }
        assertEquals(listOf<String?>("Bearer s3cret"), seen)
    }

    @Test
    fun aRefusalCarriesTheApisOwnCodeAndSentence() = runTest {
        val engine = MockEngine {
            respond(
                """{"code":"first_login_on_site","message":"Login pertama harus dari jaringan site"}""",
                HttpStatusCode.Forbidden,
                json,
            )
        }
        val api = UniverseApi("http://api.test", engine, SessionToken(null))
        val outcome = api.call(sessionBound = false) { auth.getV1AuthSession() }
        assertEquals(
            Outcome.Refused(403, "first_login_on_site", "Login pertama harus dari jaringan site"),
            outcome,
        )
    }

    @Test
    fun noAnswerIsOfflineNotARefusal() = runTest {
        val engine = MockEngine { throw IOException("no route to host") }
        val api = UniverseApi("http://api.test", engine, SessionToken("s3cret"))
        assertIs<Outcome.Offline>(api.call { me.getV1MeShift() })
    }

    @Test
    fun anAnswerThatIsNotJsonStillRefusesInWords() = runTest {
        val engine = MockEngine { respond("<html>Bad gateway</html>", HttpStatusCode.BadGateway) }
        val api = UniverseApi("http://api.test", engine, SessionToken("s3cret"))
        val outcome = api.call { me.getV1MeShift() }
        assertIs<Outcome.Refused>(outcome)
        assertEquals(502, outcome.status)
        assertTrue(outcome.message.isNotBlank())
    }

    @Test
    fun aSessionTheApiNoLongerKnowsIsDropped() = runTest {
        val engine = MockEngine {
            respond("""{"code":"unauthenticated","message":"Sesi tidak valid"}""", HttpStatusCode.Unauthorized, json)
        }
        val token = SessionToken("expired")
        var lost = 0
        val api = UniverseApi("http://api.test", engine, token).apply { onSessionLost = { lost++ } }

        api.call { me.getV1MeShift() }
        assertEquals(1, lost)

        /* A wrong password at login is a 401 too, and no session to lose. */
        api.call(sessionBound = false) { auth.getV1AuthSession() }
        assertEquals(1, lost)
    }

    @Test
    fun aWrongCurrentPasswordIsNotALostSession() = runTest {
        val engine = MockEngine {
            respond("""{"code":"invalid_credentials","message":"Password saat ini salah"}""", HttpStatusCode.Unauthorized, json)
        }
        var lost = 0
        val api = UniverseApi("http://api.test", engine, SessionToken("s1")).apply { onSessionLost = { lost++ } }
        val outcome = api.call { auth.getV1AuthSession() }
        assertEquals(Outcome.Refused(401, "invalid_credentials", "Password saat ini salah"), outcome)
        assertEquals(0, lost)
    }

    @Test
    fun aLate401ForAnOldSessionLeavesTheNewOneAlone() = runTest {
        val token = SessionToken("old")
        val engine = MockEngine {
            /* Signed in again while this request was out. */
            token.value = "new"
            respond("""{"code":"unauthenticated","message":"Sesi tidak valid"}""", HttpStatusCode.Unauthorized, json)
        }
        var lost = 0
        val api = UniverseApi("http://api.test", engine, token).apply { onSessionLost = { lost++ } }
        api.call { me.getV1MeShift() }
        assertEquals(0, lost)
    }
}
