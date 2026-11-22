#!/usr/bin/env bash
# Gera o APK debug usando uma imagem Docker que já traz JDK + Android SDK.
# Assim não é preciso instalar o SDK na máquina de desenvolvimento.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-mingc/android-build-box:latest}"
OUT="$ROOT/dist"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

cd "$ROOT"
npm run sync >/dev/null

mkdir -p "$OUT"

echo "==> Buildando APK com $IMAGE"
docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace/android \
  "$IMAGE" \
  bash -lc '
    export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    java -version
    ./gradlew assembleDebug --no-daemon --stacktrace
  '

if [ ! -f "$APK" ]; then
  echo "APK não encontrado em $APK" >&2
  exit 1
fi

cp "$APK" "$OUT/anki-ingles-android.apk"
echo "==> APK: $OUT/anki-ingles-android.apk"
