/*
 * Ponte única entre o webapp (scripts clássicos) e as APIs nativas do Capacitor.
 * O esbuild empacota este arquivo em www/native-bundle.js e expõe tudo em
 * window.AndroidNative, para backup.js e tts.js não precisarem de import/export.
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

// Plugin nativo deste projeto (baixa e instala o APK de um GitHub Release).
const AppUpdater = registerPlugin('AppUpdater');

window.AndroidNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  Filesystem: Filesystem,
  Directory: Directory,
  Encoding: Encoding,
  CapacitorHttp: CapacitorHttp,
  AppUpdater: AppUpdater
};
