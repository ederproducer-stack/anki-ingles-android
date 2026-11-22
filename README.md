# Anki Inglês — Android

**Criado por [Eder Oliveira](mailto:ederproducer@gmail.com)** ·
[ederproducer@gmail.com](mailto:ederproducer@gmail.com)

Versão **Android** do Anki Inglês. Este é um projeto **separado** da versão web
(`ederproducer-stack/anki-ingles`): o app original continua rodando normalmente
no desktop e **não é modificado por aqui**.

APK debug pronto: [v1.1.1](https://github.com/ederproducer-stack/anki-ingles-android/releases/tag/v1.1.1).
Código: https://github.com/ederproducer-stack/anki-ingles-android

O webapp (HTML/CSS/JS) é empacotado num WebView com **Capacitor 8**. A camada
nativa cuida da pasta de backup, do HTTP da voz e da atualização pelo GitHub.

## Diferenças em relação à versão web

| | Versão web | Versão Android |
|---|---|---|
| Backup | usuário escolhe a pasta (File System Access API) ou `server.py` grava no HD | **o app define a pasta sozinha**; não há botão “Escolher pasta”/“Mudar pasta” |
| Caminho do backup | `/run/media/eder/BACKUP/Anki` | `Armazenamento interno/Android/data/com.ederproducer.ankiingles/files/Anki` |
| Voz | proxy `/tts` do `server.py`, Google direto ou voz do navegador | **sempre online**: Google via HTTP nativo (`CapacitorHttp`) → voz do navegador. Nenhum MP3 é salvo |
| Atualização | `server.py` faz `git pull` no servidor | botão **Verificar atualizações** consulta a API do GitHub, baixa o APK da release e abre o instalador |
| Instalação | `server.py` + navegador | APK instalado no celular |

O caminho Android é o *app-specific external storage* (`Directory.External` do
Capacitor). Não pede permissão de armazenamento, aparece no gerenciador de
arquivos em `Android/data/<pacote>/files` e é removido ao desinstalar o app.

Estrutura criada pelo app:

```
Android/data/com.ederproducer.ankiingles/files/Anki/
├── anki-ingles-backup.json   # cartões, configurações e estatísticas
├── app/                      # cópia dos arquivos do webapp
└── anki-ingles-backup.zip    # gerado por Backup.download()
```

Não existe mais a pasta `audio/`: os MP3s de TTS não são gravados no aparelho,
para não ocupar espaço. **Salvar agora** e **Restaurar** funcionam normalmente.
O salvamento automático continua ligado por padrão.

### Voz somente online

O áudio vem do Google Tradutor em cada reprodução e vive apenas na memória
(Blob → `URL.createObjectURL`). Se a rede falhar, o app tenta a síntese de voz
do navegador em `en-US`. Não há modo offline de voz nesta versão.

## Atualização direto do GitHub

Em **Configurações → Atualizar do GitHub**, o botão **Verificar atualizações**:

1. consulta `https://api.github.com/repos/ederproducer-stack/anki-ingles-android/releases/latest`;
2. compara a versão da release com a versão instalada (`versionName` do APK);
3. mostra um modal com versões e notas da release;
4. ao confirmar, o plugin nativo `AppUpdater` baixa o `.apk` para
   `Android/data/<pacote>/files/updates/` e abre o instalador do sistema.

Se o Android pedir, ative **Instalar aplicativos desconhecidos** para o app
(o modal oferece um atalho para as configurações). Cartões, estatísticas e
backup não são alterados pela atualização.

## Como gerar o APK

Requisitos: Node 20+, Docker (para o build, já que o Android SDK não precisa
ficar instalado na máquina) e `adb` para instalar no celular.

```bash
npm install
npm test              # testes do backup, da interface e da atualização
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
  `window.AndroidNative` (Filesystem, CapacitorHttp, AppUpdater, Directory,
  Encoding).
- `www/backup.js` mantém a API da versão web, mas `saveAudios`/`getAudio`/
  `countAudios` são no-ops: nada de áudio é gravado.
- `www/tts.js` busca o MP3 na rede e o descarta após a reprodução.
- `www/updater.js` implementa a interface de atualização; o download e o intent
  de instalação ficam em `android/app/src/main/java/.../UpdaterPlugin.java`.
- `capacitor.config.json` desliga a exigência de gesto do usuário para áudio e
  habilita o `CapacitorHttp`.

## Estrutura

```
src/native.js               ponte com as APIs nativas (vira www/native-bundle.js)
www/                        webapp (cópia isolada da versão web + ajustes Android)
www/version.json            versão, autor e repositório
www/updater.js              interface de atualização pelo GitHub
android/                    projeto nativo gerado pelo Capacitor
scripts/bundle-native.js    empacota a ponte nativa
scripts/generate-assets.sh  ícone e splash
scripts/build-apk.sh        build do APK via Docker
tests/backup.test.js        testes do backup (sem áudio em disco)
tests/ui.test.js            testes da interface e da atualização
```

## Escopo

Não edite `~/Work/anki-ingles`, o repositório `anki-ingles` nem qualquer
configuração do Omarchy a partir deste projeto. Toda mudança fica aqui.
