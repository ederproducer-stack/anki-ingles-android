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
# Roda como o usuário da máquina para o Gradle não deixar arquivos root-owned.
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e GRADLE_USER_HOME=/tmp/gradle-home \
  -e ANDROID_USER_HOME=/tmp/android-user-home \
  -v "$ROOT:/workspace" \
  -w /workspace/android \
  "$IMAGE" \
  bash -lc '
    # A imagem define ANDROID_SDK_HOME; usar junto com ANDROID_USER_HOME confunde o AGP.
    unset ANDROID_SDK_HOME
    mkdir -p "$ANDROID_USER_HOME/.android"
    export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    # O capacitor-android exige JDK 21; imagens com jenv costumam apontar para 17.
    for candidate in /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/java-21-openjdk /opt/java/openjdk; do
      if [ -x "$candidate/bin/java" ]; then JAVA_HOME="$candidate"; break; fi
    done
    export JAVA_HOME
    export PATH="$JAVA_HOME/bin:$PATH"
    java -version
    ./gradlew assembleDebug --no-daemon --stacktrace
  '

if [ ! -f "$APK" ]; then
  echo "APK não encontrado em $APK" >&2
  exit 1
fi

cp "$APK" "$OUT/anki-ingles-android.apk"
echo "==> APK: $OUT/anki-ingles-android.apk"
