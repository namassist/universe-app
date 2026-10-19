package id.universe.mobile.ui

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import id.universe.mobile.app.AppModel
import id.universe.mobile.app.AppState
import id.universe.mobile.data.Outcome
import id.universe.mobile.data.UniverseApi
import id.universe.mobile.domain.HomeKind
import id.universe.mobile.domain.NavItem
import id.universe.mobile.domain.VersionVerdict
import id.universe.mobile.ui.components.NavBar
import id.universe.mobile.ui.components.NavEntry
import id.universe.mobile.ui.components.Toast
import id.universe.mobile.ui.components.rememberLoad
import id.universe.mobile.ui.icons.Glyph
import id.universe.mobile.ui.operator.JadwalScreen
import id.universe.mobile.ui.operator.KartuScreen
import id.universe.mobile.ui.operator.NotifScreen
import id.universe.mobile.ui.operator.OperatorHome
import id.universe.mobile.ui.operator.ProfilScreen
import id.universe.mobile.ui.operator.RiwayatScreen
import id.universe.mobile.ui.operator.UnitScreen
import id.universe.mobile.ui.screens.BlockedScreen
import id.universe.mobile.ui.screens.LoginScreen
import id.universe.mobile.ui.screens.PasswordScreen
import id.universe.mobile.ui.screens.SoonScreen
import id.universe.mobile.ui.screens.Splash
import id.universe.mobile.ui.screens.StaffHome
import id.universe.mobile.ui.screens.UnreachableScreen
import id.universe.mobile.ui.components.Load
import id.universe.mobile.ui.staff.AdminHome
import id.universe.mobile.ui.staff.AkunScreen
import id.universe.mobile.ui.staff.CariScreen
import id.universe.mobile.ui.staff.PlaceSheet
import id.universe.mobile.ui.staff.TimelineScreen
import id.universe.mobile.ui.staff.PapanScreen
import id.universe.mobile.ui.staff.ScanScreen
import id.universe.mobile.ui.staff.SupervisorHome
import id.universe.mobile.ui.staff.UnitHistoryScreen
import id.universe.mobile.ui.staff.UnitStatusScreen
import id.universe.mobile.ui.theme.Theme
import id.universe.mobile.ui.theme.UniverseTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute

@Serializable data object UnitRoute

@Serializable data object JadwalRoute

@Serializable data object KartuRoute

@Serializable data class RiwayatRoute(val tab: String = "unit")

@Serializable data object NotifRoute

@Serializable data object ProfilRoute

@Serializable data object PasswordRoute

/** A screen not in this build: [nav] names the bottom-bar item it stands for, if any. */
@Serializable data class SoonRoute(val title: String, val nav: String? = null)

/** Papan ACTUAL, opened on one of the `BoardFilter` names. */
@Serializable data class PapanRoute(val filter: String = "ALL")

@Serializable data object CariRoute

@Serializable data object UnitStatusRoute

@Serializable data class UnitHistoryRoute(val code: String)

@Serializable data object ScanRoute

@Serializable data object TimelineRoute

@Serializable data object AkunRoute

/** What the Android (later iOS) shell builds once per process and hands in. */
class AppGraph(val api: UniverseApi, val model: AppModel, val info: AppInfo)

private const val TOAST_MILLIS = 2_600L

/** Not a data class: two toasts with the same words are two toasts. */
private class ToastMessage(val text: String)

private const val BOARD_REFRESH_MS = 60_000L

/** The bar's 88px plus the 16px a screen keeps clear above it. */
private val NAV_RESERVE = 104.dp

@Composable
fun UniverseApp(graph: AppGraph, platform: PlatformHooks) {
    UniverseTheme {
        /* Each toast is its own object, so the same sentence twice restarts the timer. */
        var toast by remember { mutableStateOf<ToastMessage?>(null) }
        LaunchedEffect(toast) {
            if (toast != null) {
                delay(TOAST_MILLIS)
                toast = null
            }
        }
        val state by graph.model.state.collectAsState()
        val version by graph.model.version.collectAsState()
        val scope = rememberCoroutineScope()
        val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        val withBar = state is AppState.SignedIn && !(state as AppState.SignedIn).principal.mustChangePassword
        CompositionLocalProvider(
            LocalPlatform provides platform,
            LocalAppInfo provides graph.info,
            LocalToast provides { toast = ToastMessage(it) },
        ) {
            Box(Modifier.fillMaxSize().background(Theme.palette.ground)) {
                when (val current = state) {
                    AppState.Starting -> Splash()
                    is AppState.Blocked -> BlockedScreen(current.downloadUrl)
                    /* From the top: a version check that got no answer the first time is asked again. */
                    AppState.Unreachable -> UnreachableScreen { scope.launch { graph.model.start() } }
                    is AppState.SignedOut -> LoginScreen(current.notice) { nik, password -> graph.model.login(nik, password) }
                    is AppState.SignedIn -> key(current.principal.id) {
                        if (current.principal.mustChangePassword) {
                            PasswordScreen(
                                forced = true,
                                api = graph.api,
                                onSaved = { graph.model.passwordChanged() },
                                onBack = null,
                                onLogout = { scope.launch { graph.model.logout() } },
                            )
                        } else {
                            SignedInShell(current, graph, version)
                        }
                    }
                }
                toast?.let {
                    Toast(
                        it.text,
                        Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = (if (withBar) NAV_RESERVE else 24.dp) + navInset)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
        }
    }
}

private fun glyphOf(item: NavItem): Glyph = when (item) {
    NavItem.HOME -> Glyph.HOME
    NavItem.JADWAL -> Glyph.CALENDAR
    NavItem.KARTU -> Glyph.QR
    NavItem.RIWAYAT -> Glyph.RECEIPT
    NavItem.PROFIL -> Glyph.USER
    NavItem.PAPAN -> Glyph.BOARD
    NavItem.SCAN -> Glyph.SCAN
    NavItem.UNIT -> Glyph.TRUCK
    NavItem.TIMELINE -> Glyph.TIMELINE
    NavItem.AKUN -> Glyph.PEOPLE
}

private fun routeOf(item: NavItem): Any = when (item) {
    NavItem.HOME -> HomeRoute
    NavItem.JADWAL -> JadwalRoute
    NavItem.KARTU -> KartuRoute
    NavItem.RIWAYAT -> RiwayatRoute()
    NavItem.PROFIL -> ProfilRoute
    NavItem.PAPAN -> PapanRoute()
    NavItem.SCAN -> ScanRoute
    NavItem.UNIT -> UnitStatusRoute
    NavItem.TIMELINE -> TimelineRoute
    NavItem.AKUN -> AkunRoute
}

/** The bar item a screen belongs to: "Unit saya" and Notifikasi sit under Beranda. */
private fun activeItem(entry: NavBackStackEntry?): NavItem? {
    val destination = entry?.destination ?: return NavItem.HOME
    return when {
        destination.hasRoute<HomeRoute>() || destination.hasRoute<UnitRoute>() || destination.hasRoute<NotifRoute>() ->
            NavItem.HOME
        destination.hasRoute<JadwalRoute>() -> NavItem.JADWAL
        destination.hasRoute<KartuRoute>() -> NavItem.KARTU
        destination.hasRoute<RiwayatRoute>() -> NavItem.RIWAYAT
        destination.hasRoute<ProfilRoute>() || destination.hasRoute<PasswordRoute>() -> NavItem.PROFIL
        destination.hasRoute<PapanRoute>() -> NavItem.PAPAN
        destination.hasRoute<CariRoute>() -> NavItem.HOME
        destination.hasRoute<ScanRoute>() -> NavItem.SCAN
        destination.hasRoute<UnitStatusRoute>() || destination.hasRoute<UnitHistoryRoute>() -> NavItem.UNIT
        destination.hasRoute<TimelineRoute>() -> NavItem.TIMELINE
        destination.hasRoute<AkunRoute>() -> NavItem.AKUN
        destination.hasRoute<SoonRoute>() ->
            entry.toRoute<SoonRoute>().nav?.let { name -> NavItem.entries.firstOrNull { it.name == name } }
        else -> null
    }
}

private fun NavHostController.switchTo(item: NavItem) {
    val route = routeOf(item)
    if (route is HomeRoute) {
        /* Home is the root: go back to it. Saving and restoring here would bring
           back the very page being left. */
        if (!popBackStack<HomeRoute>(inclusive = false)) navigate(HomeRoute)
        return
    }
    if (route is SoonRoute) {
        /* Every unbuilt item is this one destination with another title: reusing or
           restoring it would keep showing the page already open (Papan, then Timeline). */
        navigate(route) { popUpTo<HomeRoute>() }
        return
    }
    navigate(route) {
        popUpTo<HomeRoute> { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun SignedInShell(signedIn: AppState.SignedIn, graph: AppGraph, version: VersionVerdict) {
    val api = graph.api
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val scope = rememberCoroutineScope()
    val operator = signedIn.access.home == HomeKind.OPERATOR
    val nik = signedIn.principal.nik
    var updateDismissed by rememberSaveable { mutableStateOf(false) }

    /* Read by Beranda, Unit saya and Profil alike; refreshed whenever the app comes back. */
    val shift = rememberLoad(signedIn.principal.id) { api.call { me.getV1MeShift() } }
    val employee = rememberLoad(nik) {
        if (nik == null) {
            Outcome.Refused(404, "no_employee", "Akun ini tidak terhubung ke data karyawan.")
        } else {
            api.call { employees.getV1EmployeesByNik(nik) }
        }
    }
    /* The fleet wall's board and the unit list, for the Pengawas Lapangan and Superadmin. */
    val permissions = signedIn.permissions
    val board = rememberLoad(signedIn.principal.id, "board") {
        if (permissions.fleetAllocation == null) {
            Outcome.Refused(403, "forbidden", "Akun ini tidak memegang menu papan alokasi.")
        } else {
            api.call { fleetAllocation.getV1FleetAllocationActualDisplay() }
        }
    }
    val units = rememberLoad(signedIn.principal.id, "units") {
        if (permissions.unitStatus == null) {
            Outcome.Refused(403, "forbidden", "Akun ini tidak memegang menu status unit.")
        } else {
            api.call { unitStatus.getV1UnitStatus() }
        }
    }
    /* The running muster, for the Superadmin's home and monitor. */
    val runs = rememberLoad(signedIn.principal.id, "runs") {
        if (permissions.timeline == null) {
            Outcome.Refused(403, "forbidden", "Akun ini tidak memegang menu timeline.")
        } else {
            api.call { timeline.getV1TimelineRuns() }
        }
    }
    var placing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var resumed by remember { mutableStateOf(false) }
    LifecycleResumeEffect(operator) {
        if (resumed) {
            if (operator) {
                shift.reload()
            } else {
                board.reload()
                units.reload()
                runs.reload()
            }
        }
        resumed = true
        /* The board moves fast between 05:26 and 05:30; while the app is in front it is re-read. */
        val ticker = if (operator) {
            null
        } else {
            scope.launch {
                while (true) {
                    delay(BOARD_REFRESH_MS)
                    board.refresh()
                    units.refresh()
                    runs.refresh()
                }
            }
        }
        onPauseOrDispose { ticker?.cancel() }
    }

    val go: (Any) -> Unit = { nav.navigate(it) { launchSingleTop = true } }
    val back: () -> Unit = { nav.popBackStack() }
    val home: () -> Unit = { nav.switchTo(NavItem.HOME) }
    val logout: () -> Unit = { scope.launch { graph.model.logout() } }
    val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    Box(Modifier.fillMaxSize()) {
        CompositionLocalProvider(LocalNavReserve provides NAV_RESERVE + navInset) {
            NavHost(
                nav,
                startDestination = HomeRoute,
                modifier = Modifier.fillMaxSize(),
                enterTransition = { fadeIn(tween(220)) },
                exitTransition = { fadeOut(tween(220)) },
            ) {
                composable<HomeRoute> {
                    when (signedIn.access.home) {
                        HomeKind.OPERATOR -> OperatorHome(
                            shift,
                            (version as? VersionVerdict.UpdateAvailable)?.takeUnless { updateDismissed },
                            { updateDismissed = true },
                            go,
                        )
                        HomeKind.SUPERVISOR -> SupervisorHome(board, units, go)
                        HomeKind.ADMIN -> AdminHome(board, runs, go)
                    }
                }
                composable<PapanRoute> {
                    /* An Isi sheet belongs to this visit of Papan: leaving closes it. */
                    DisposableEffect(Unit) { onDispose { placing = null } }
                    PapanScreen(
                        board,
                        it.toRoute<PapanRoute>().filter,
                        back,
                        onPlace = { id: String, code: String -> placing = id to code }.takeIf { signedIn.access.canPlace },
                    )
                    val shown = (board.value as? Load.Ready)?.value
                    placing?.let { (unitId, unitCode) ->
                        if (shown != null) {
                            PlaceSheet(
                                api,
                                shown,
                                unitId,
                                unitCode,
                                onPlaced = {
                                    placing = null
                                    board.refresh()
                                },
                                onDismiss = { placing = null },
                            )
                        }
                    }
                }
                composable<TimelineRoute> { TimelineScreen(runs, back) }
                composable<AkunRoute> { AkunScreen(api, signedIn.principal.id, back) }
                composable<CariRoute> { CariScreen(board, back) }
                composable<UnitStatusRoute> { UnitStatusScreen(units, back, go) }
                composable<UnitHistoryRoute> { UnitHistoryScreen(api, it.toRoute<UnitHistoryRoute>().code, back) }
                composable<ScanRoute> { ScanScreen(api, back) }
                composable<UnitRoute> { UnitScreen(shift, back) }
                composable<JadwalRoute> { JadwalScreen(api, nik, back) }
                composable<KartuRoute> { KartuScreen(employee, back, go) }
                composable<RiwayatRoute> { RiwayatScreen(api, it.toRoute<RiwayatRoute>().tab, back) }
                composable<NotifRoute> { NotifScreen(api, back) }
                composable<ProfilRoute> {
                    ProfilScreen(
                        signedIn,
                        employee.takeIf { operator },
                        shift.takeIf { operator },
                        version,
                        onBack = if (operator) null else back,
                        go = go,
                        onLogout = logout,
                    )
                }
                composable<PasswordRoute> {
                    PasswordScreen(
                        forced = false,
                        api = api,
                        onSaved = {
                            graph.model.passwordChanged()
                            back()
                        },
                        onBack = back,
                        onLogout = logout,
                    )
                }
                composable<SoonRoute> {
                    val route = it.toRoute<SoonRoute>()
                    SoonScreen(route.title, pending = route.nav != null, onBack = back, onHome = home)
                }
            }
        }
        val active = activeItem(entry)
        NavBar(
            signedIn.access.nav.map { item ->
                NavEntry(item.label, glyphOf(item), item.center, item == active) { nav.switchTo(item) }
            },
            Modifier.align(Alignment.BottomCenter),
        )
    }
}
