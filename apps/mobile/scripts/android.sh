#!/usr/bin/env bash
# Build the debug app here in WSL, install it on the emulator or phone that
# Windows' adb sees, and open it. Android Studio on Windows cannot build a
# project that lives in WSL, so this replaces "Run" for checking a screen.
#
#   apps/mobile/scripts/android.sh            # build, install, open
#   apps/mobile/scripts/android.sh --no-build # reinstall the last build
#
# ADB, JAVA_HOME and ANDROID_HOME may be set to override the defaults below.
set -euo pipefail

cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.local/jdk/jdk-17* | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

# Windows' adb, reached through WSL interop: it owns the emulator's connection.
ADB="${ADB:-$(ls /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe 2>/dev/null | head -1)}"
if [[ -z "$ADB" ]]; then
  echo "adb.exe tidak ditemukan; set ADB=/mnt/c/.../platform-tools/adb.exe" >&2
  exit 1
fi

if [[ "${1:-}" != "--no-build" ]]; then
  ./gradlew :androidApp:assembleDebug -q
fi

APK=androidApp/build/outputs/apk/debug/androidApp-debug.apk
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "Tidak ada emulator/HP yang terhubung. Jalankan emulator dari Android Studio (Device Manager) dulu." >&2
  exit 1
fi

"$ADB" install -r "$(wslpath -w "$APK")"
"$ADB" shell am start -n id.universe.mobile/id.universe.mobile.android.MainActivity
