package id.universe.mobile.data

import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import okio.Path.Companion.toPath

/** Where the session id lives between launches. */
interface TokenStore {
    suspend fun read(): String?

    /** Null forgets it. */
    suspend fun write(token: String?)
}

/**
 * The session id in a preferences file in the app's private storage. The
 * Android manifest keeps that storage out of backups and device transfers.
 * One instance per file for the life of the process, as DataStore requires.
 */
class PreferencesTokenStore(path: String) : TokenStore {
    private val store: DataStore<Preferences> = PreferenceDataStoreFactory.createWithPath(
        /* A damaged file is a signed-out phone, not an app that crashes on every launch. */
        corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
        produceFile = { path.toPath() },
    )
    private val key = stringPreferencesKey("session")

    /** Null when nothing is saved, or when the file cannot be read: the person logs in again. */
    override suspend fun read(): String? = try {
        store.data.first()[key]
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    override suspend fun write(token: String?) {
        try {
            store.edit { if (token == null) it.remove(key) else it[key] = token }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            /* The session still holds in memory; only the next launch asks for login again. */
        }
    }
}
