package id.universe.mobile.android

import android.app.Application
import android.util.Log
import id.universe.mobile.app.AppModel
import id.universe.mobile.data.PreferencesTokenStore
import id.universe.mobile.data.SessionToken
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.ui.AppGraph
import id.universe.mobile.ui.AppInfo
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

/**
 * One client, one session store and one [AppModel] for the life of the
 * process: an Activity recreated by a theme change keeps the signed-in state,
 * and DataStore never sees a second instance on the same file.
 */
class UniverseApplication : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        val session = SessionToken(null)
        val api = UniverseApi(BuildConfig.API_ORIGIN, OkHttp.create(), session)
        val tokens = PreferencesTokenStore(filesDir.resolve("session.preferences_pb").absolutePath)
        val model = AppModel(api, session, tokens, BuildConfig.VERSION_CODE)
        graph = AppGraph(api, model, AppInfo(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE))
        /* The version check and the saved session, once per launch. A fault here
           is logged rather than crashing the app before its first frame. */
        val logged = CoroutineExceptionHandler { _, error -> Log.e("Universe", "start failed", error) }
        MainScope().launch(logged) { model.start() }
    }
}
