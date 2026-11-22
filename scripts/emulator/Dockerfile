# Emulador Android mínimo, montado só com componentes oficiais do Google SDK.
# Não expõe VNC/ADB na rede e não roda em modo privilegiado: só recebe /dev/kvm.
FROM anki-ingles-android-builder

ENV HOME=/home/gradle
ENV PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

# Bibliotecas mínimas para o emulator headless (sem interface gráfica).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libnss3 libx11-6 libxcb1 libxext6 libxrender1 \
      libxrandr2 libxkbcommon0 libpulse0 libasound2t64 libusb-1.0-0 \
      libfontconfig1 libfreetype6 libgbm1 libdrm2 libegl1 libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

RUN sdkmanager "emulator" "system-images;android-36;google_apis;x86_64" >/dev/null

USER gradle
RUN echo "no" | avdmanager create avd \
      -n anki \
      -k "system-images;android-36;google_apis;x86_64" \
      --force \
    && printf 'hw.ramSize=2048\nhw.gpu.enabled=yes\nhw.gpu.mode=swiftshader\ndisk.dataPartition.size=4096M\n' \
      >> "$HOME/.android/avd/anki.avd/config.ini"

CMD ["bash"]
