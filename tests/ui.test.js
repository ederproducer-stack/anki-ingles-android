/*
 * Smoke test da interface Android: carrega o index.html e os scripts reais num
 * DOM falso, com a bridge nativa simulada, e confere backup, voz e atualização.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');

const RELEASE = {
  tag_name: 'v1.1.0',
  name: 'v1.1.0 — APK debug',
  body: 'Voz sempre online e atualização direto do GitHub.',
  assets: [{
    name: 'anki-ingles-android.apk',
    browser_download_url: 'https://github.com/ederproducer-stack/anki-ingles-android/releases/download/v1.1.0/anki-ingles-android.apk'
  }]
};

function boot() {
  const files = new Map();
  const downloads = [];
  const settingsOpened = [];
  const native = {
    isNative: true,
    platform: 'android',
    Filesystem: {
      async mkdir() {},
      async writeFile({ path: filePath, data }) { files.set(filePath, data); },
      async readFile({ path: filePath }) {
        if (!files.has(filePath)) throw new Error('sem arquivo');
        return { data: files.get(filePath) };
      },
      async readdir({ path: dirPath }) {
        const prefix = dirPath + '/';
        return {
          files: [...files.keys()]
            .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
            .map((name) => ({ name: name.slice(prefix.length), directory: false }))
        };
      },
      async getUri({ path: dirPath }) {
        return { uri: 'file:///storage/emulated/0/Android/data/com.ederproducer.ankiingles/files/' + dirPath };
      }
    },
    Directory: { External: 'EXTERNAL' },
    Encoding: { UTF8: 'utf8' },
    CapacitorHttp: {
      async get({ url }) {
        if (url.includes('api.github.com')) return { status: 200, data: RELEASE };
        return { status: 200, data: Buffer.from('mp3').toString('base64') };
      }
    },
    AppUpdater: {
      async getVersion() { return { version: '1.0.0', canInstall: true }; },
      async downloadAndInstall({ url }) { downloads.push(url); return { ok: true }; },
      async openInstallSettings() { settingsOpened.push(true); }
    }
  };

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.AndroidNative = native;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.URL.createObjectURL = () => 'blob:falso';
  window.URL.revokeObjectURL = () => {};
  window.Audio = class {
    constructor() { this.src = ''; this.playbackRate = 1; }
    play() { return Promise.resolve(); }
    pause() {}
  };
  window.speechSynthesis = {
    getVoices: () => [],
    cancel() {},
    speak(utterance) { setTimeout(() => utterance.onend && utterance.onend(), 0); }
  };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.fetch = async () => ({ ok: true, text: async () => 'conteudo', json: async () => ({}) });
  window.confirm = () => true;

  const order = [
    'richtext.js', 'srs.js', 'deck.js', 'decks.js', 'backup.js',
    'tts.js', 'updater.js', 'app.js'
  ];
  for (const name of order) {
    window.eval(fs.readFileSync(path.join(ROOT, 'www', name), 'utf8'));
  }
  return { window, files, downloads, settingsOpened, dom };
}

const flush = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

test('o app inicia e mostra a pasta fixa do Android', async () => {
  const { window, dom } = boot();
  await flush();
  const status = window.document.getElementById('backup-status').textContent;
  assert.match(status, /Salvando automaticamente em:/);
  assert.match(status, /Android\/data\/com\.ederproducer\.ankiingles\/files\/Anki/);
  assert.equal(window.document.querySelectorAll('.screen.active').length, 1);
  dom.window.close();
});

test('Salvar agora grava só o backup (sem MP3s)', async () => {
  const { window, files, dom } = boot();
  await flush();
  window.document.getElementById('btn-backup-save').click();
  await flush();
  assert.ok(files.has('Anki/anki-ingles-backup.json'));
  const payload = JSON.parse(files.get('Anki/anki-ingles-backup.json'));
  assert.equal(payload.app, 'anki-ingles-android');
  assert.ok(payload.cards.length > 0);
  assert.equal([...files.keys()].some((name) => name.endsWith('.mp3')), false);
  dom.window.close();
});

test('os botões de escolher/mudar pasta ficam ocultos', async () => {
  const { window, dom } = boot();
  await flush();
  const choose = window.document.getElementById('btn-backup-folder');
  assert.equal(choose.classList.contains('hidden'), true);
  assert.ok(/display:\s*none/.test(fs.readFileSync(path.join(ROOT, 'www', 'style.css'), 'utf8')));
  dom.window.close();
});

test('a autoria aparece no rodapé com o repositório Android', () => {
  const { window, dom } = boot();
  const footer = window.document.querySelector('.app-footer');
  assert.match(footer.textContent, /Eder Oliveira/);
  assert.match(footer.querySelector('a[href^="mailto:"]').getAttribute('href'), /ederproducer@gmail.com/);
  assert.match(footer.querySelector('a[href^="https://github.com/"]').getAttribute('href'), /anki-ingles-android$/);
  dom.window.close();
});

test('verifica atualização no GitHub e baixa o APK', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'www', 'style.css'), 'utf8');
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /display:\s*flex;\s*align-items:\s*center/);
  assert.match(css, /max-width:\s*560px/);
  const { window, downloads, dom } = boot();
  await flush(80);
  assert.match(window.document.getElementById('update-status').textContent, /Versão instalada: 1\.0\.0/);

  window.document.getElementById('btn-update-app').click();
  await flush(80);
  const modal = window.document.getElementById('modal-root').textContent;
  assert.match(modal, /Nova versão disponível/);
  assert.match(modal, /1\.1\.0/);
  assert.match(modal, /Voz sempre online/);

  window.document.getElementById('update-go').click();
  await flush(80);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0], /anki-ingles-android\.apk$/);
  dom.window.close();
});

test('comparação de versões respeita números (1.10 > 1.9)', () => {
  const { window, dom } = boot();
  const cmp = window.AppUpdaterUI.compareVersions;
  assert.equal(cmp('1.10.0', '1.9.0'), 1);
  assert.equal(cmp('v1.1.0', '1.1.0'), 0);
  assert.equal(cmp('1.0.0', '1.1.0'), -1);
  dom.window.close();
});
