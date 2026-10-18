# Universe mobile

The phone app for the people a muster is about (docs/prd.md, _Mobile app_):
Kotlin with Compose Multiplatform, one codebase for Android and iOS, Android
first. It builds with Gradle, outside `bun run build` and turbo, so it is
verified on its own.

**Built (stage 3, 2026-10-18):** login with a bearer session, the version
gate, the forced password change, navigation from the session's menu grants,
and the operator's screens: Beranda, Unit saya, Jadwal, Kartu, Riwayat,
Notifikasi, Profil. **Not yet:** the Pengawas Lapangan and Superadmin screens
(a placeholder home says so), FCM push (the in-app list carries the same
notices), iOS.

## Layout

```
openapi.json        # the API's routes the app calls; written by `bun run openapi:mobile` in apps/api
DESIGN.md           # the design system; prototype/ is the visual reference
shared/             # all app code, common to Android and iOS
  src/commonMain/kotlin/id/universe/mobile/
    domain/         # pure wording of what the API decided: the app judges nothing
    data/           # UniverseApi (generated client + bearer + Outcome), TokenStore, model aliases
    app/AppModel.kt # version gate → saved session → login, as a StateFlow
    ui/             # theme (DESIGN.md tokens), icons, components, screens, App.kt (routes)
  src/commonMain/composeResources/  # Figtree (TTF from prototype/fonts) and the logo vector
  src/commonTest/   # kotlin.test: domain, the API wrapper (Ktor MockEngine), AppModel
androidApp/         # the Android shell: Application, MainActivity, manifest, icon
```

The API client is generated at build time from `openapi.json` into
`shared/build/generated/openapi` and is not committed. Its models are named
after their routes; `data/Models.kt` gives the ones the app uses their names.

## Toolchain

JDK 17 and the Android SDK (platform 37, build-tools). In WSL they live in
`~/.local/jdk` and `~/Android/Sdk`:

```bash
export JAVA_HOME=$(ls -d ~/.local/jdk/jdk-17*) ANDROID_HOME=~/Android/Sdk
./gradlew :shared:testAndroidHostTest      # the tests
./gradlew :androidApp:assembleDebug        # androidApp/build/outputs/apk/debug
./gradlew :androidApp:lintDebug
```

A debug build talks to `http://10.0.2.2:3001` (the developer's machine, as an
emulator sees it). A release is built for one installation's origin, over
HTTPS only:

```bash
./gradlew :androidApp:assembleRelease -Puniverse.apiOrigin=https://universe.example.id
```

Raise `versionCode` in `androidApp/build.gradle.kts` for every release: it is
the build number `/v1/mobile/version` compares. **Keep the signing key**; an
APK signed with another key cannot update the installed one.

## When the API changes

A route the app calls is listed in `MOBILE_OPERATIONS`
(`apps/api/src/mobile-openapi.ts`). After changing one, run
`bun run openapi:mobile` in `apps/api` and commit `openapi.json`; the API's
tests fail until the copy matches. Responses are published without `enum`, so
an old build reads a value the API added later as a string it does not know,
and words it as "Perbarui aplikasi" instead of failing.

## Rules

- **Wording only.** `domain/` turns `/v1/me/shift` and the lists into words
  and hues; holder or spare, late or not, is the API's answer.
- **Screens from grants, not role names** (`domain/Access.kt`).
- **Status is a colour and a word**, every time (DESIGN.md).
- No Material, no icon library: `ui/theme` and `ui/components` are the
  design system, glyphs are the prototype's paths (`ui/icons/Glyph.kt`).
- No component tests, as on the web: pure logic gets `commonTest`, the UI is
  verified by build and lint, and on a phone.
