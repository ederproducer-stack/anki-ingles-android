# Anki Inglês — Android

Versão **Android** do Anki Inglês. Este é um projeto **separado** da versão web
(`ederproducer-stack/anki-ingles`): o app original continua rodando normalmente
no desktop e **não é modificado por aqui**.

APK debug pronto: [v1.0.0](https://github.com/ederproducer-stack/anki-ingles-android/releases/tag/v1.0.0).

O webapp (HTML/CSS/JS) é empacotado num WebView com **Capacitor 8**. A única
camada nativa adicional é a pasta de backup e o HTTP usado para buscar o áudio.

## Diferenças em relação à versão web

| | Versão web | Versão Android |
|---|---|---|
| Backup | usuário escolhe a pasta (File System Access API) ou `server.py` grava no HD | **o app define a pasta sozinha**; não há botão “Escolher pasta”/“Mudar pasta” |
| Caminho do backup | `/run/media/eder/BACKUP/Anki` | `Armazenamento interno/Android/data/com.ederproducer.ankiingles/files/Anki` |
| Voz | proxy `/tts` do `server.py`, Google direto ou voz do navegador | MP3 salvo no app → Google via HTTP nativo (`CapacitorHttp`) → voz do navegador |
| Instalação | `server.py` + navegador | APK instalado no celular |

O caminho Android é o *app-specific external storage* (`Directory.External` do
Capacitor). Não pede permissão de armazenamento, aparece no gerenciador de
arquivos em `Android/data/<pacote>/files` e é removido ao desinstalar o app.
Se quiser preservar os cartões, use **Salvar agora** e copie essa pasta, ou
importe/exporte pelo menu **Cartões**.

Estrutura criada pelo app:

```
Android/data/com.ederproducer.ankiingles/files/Anki/
├── anki-ingles-backup.json   # cartões, configurações e estatísticas
├── app/                      # cópia dos arquivos do webapp
├── audio/                    # MP3 de cada frase (nomes estáveis por hash)
└── anki-ingles-backup.zip    # gerado por Backup.download()
```

**Salvar agora** e **Restaurar** em Configurações → Pasta de backup funcionam
normalmente; o salvamento automático também continua ligado por padrão.

## Como gerar o APK

Requisitos: Node 20+, Docker (para o build, já que o Android SDK não precisa
ficar instalado na máquina) e `adb` para instalar no celular.

```bash
npm install
npm test              # testes do backup e da interface com a bridge nativa falsificada
npm run bundle        # gera www/native-bundle.js
npm run sync          # bundle + cap sync android

# Build do debug APK em um container com Android SDK:
npm run build:apk     # sai em dist/anki-ingles-android.apk

# Instalar no celular (com depuração USB ligada):
adb install -r dist/anki-ingles-android.apk
```

Para gerar ícone/splash novamente: `bash scripts/generate-assets.sh`
(requer ImageMagick 7 / `magick`).

Se preferir uma imagem menor que o `mingc/android-build-box`, há um `Dockerfile`
com JDK 21 + Android SDK 36:

```bash
docker build -t anki-ingles-android-builder .
ANDROID_BUILD_IMAGE=anki-ingles-android-builder npm run build:apk
```

Se preferir buildar sem Docker, abra `android/` no Android Studio e rode
`./gradlew assembleDebug` com `ANDROID_HOME` apontando para seu SDK.

### Detalhes técnicos

- `src/native.js` é empacotado pelo esbuild em `www/native-bundle.js` e expõe
  `window.AndroidNative` (Filesystem, CapacitorHttp, Directory, Encoding).
- `www/backup.js` substitui o backup da versão web mantendo a **mesma API**,
  então `app.js` continua funcionando sem saber que está no Android. O status
  usa `serverPath` apenas como “caminho fixo” para reaproveitar a interface.
- `www/tts.js` toca primeiro o MP3 local (Blob via `URL.createObjectURL`, sem
  depender de `file://`), depois busca na rede pelo HTTP nativo — que ignora
  CORS — e por fim tenta a Web Speech API.
- `capacitor.config.json` desliga a exigência de gesto do usuário para áudio,
  necessária para a voz automática ao mostrar o cartão.

## Estrutura

```
src/native.js               ponte com as APIs nativas (vira www/native-bundle.js)
www/                        webapp (cópia isolada da versão web + ajustes Android)
android/                    projeto nativo gerado pelo Capacitor
scripts/bundle-native.js    empacota a ponte nativa
scripts/generate-assets.sh  ícone e splash
scripts/build-apk.sh        build do APK via Docker
tests/backup.test.js        testes do backup
```

## Escopo

Não edite `~/Work/anki-ingles`, o repositório `anki-ingles` nem qualquer
configuração do Omarchy a partir deste projeto. Toda mudança fica aqui.
