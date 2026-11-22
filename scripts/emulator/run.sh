#!/usr/bin/env bash
# Sobe um emulador Android headless e isolado para testar o APK.
# Segurança: sem --privileged, sem portas publicadas, sem VNC; só /dev/kvm.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="anki-android-emulator"
NAME="anki-emu"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Construindo $IMAGE (componentes oficiais do Android SDK)"
  docker build -f "$ROOT/scripts/emulator/Dockerfile" -t "$IMAGE" "$ROOT"
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  --device /dev/kvm \
  --shm-size=2g \
  -v "$ROOT/dist:/dist:ro" \
  "$IMAGE" \
  bash -lc 'adb start-server >/dev/null 2>&1; emulator -avd anki -no-window -noaudio -no-boot-anim -gpu swiftshader -ports 5554,5555 > /tmp/emulator.log 2>&1 & tail -f /dev/null'

echo "==> Emulador subindo. Aguarde o boot:"
echo "    docker exec $NAME bash -lc 'adb wait-for-device shell \"while [ \\\"\\\$(getprop sys.boot_completed)\\\" != 1 ]; do sleep 2; done\"; echo BOOT_OK'"
echo "==> Instalar o APK:"
echo "    docker exec $NAME adb install -r /dist/anki-ingles-android.apk"
echo "==> Screenshot:"
echo "    docker exec $NAME adb exec-out screencap -p > /tmp/screen.png"
