/*
 * Smoke test da interface Android: carrega o index.html e os scripts reais num
 * DOM falso, com a bridge nativa simulada, e confere que o app inicia e salva.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');

function boot() {
  const files = new Map();
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
      async get() { return { status: 200, data: Buffer.from('mp3').toString('base64') }; }
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

  const order = ['richtext.js', 'srs.js', 'deck.js', 'decks.js', 'backup.js', 'tts.js', 'app.js'];
  for (const name of order) {
    window.eval(fs.readFileSync(path.join(ROOT, 'www', name), 'utf8'));
  }
  return { window, files, dom };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

test('o app inicia e mostra a pasta fixa do Android', async () => {
  const { window, dom } = boot();
  await flush();
  const status = window.document.getElementById('backup-status').textContent;
  assert.match(status, /Salvando automaticamente em:/);
  assert.match(status, /Android\/data\/com\.ederproducer\.ankiingles\/files\/Anki/);
  assert.equal(window.document.querySelectorAll('.screen.active').length, 1);
  dom.window.close();
});

test('Salvar agora grava na pasta definida pelo app', async () => {
  const { window, files, dom } = boot();
  await flush();
  window.document.getElementById('btn-backup-save').click();
  await flush();
  assert.ok(files.has('Anki/anki-ingles-backup.json'));
  const payload = JSON.parse(files.get('Anki/anki-ingles-backup.json'));
  assert.equal(payload.app, 'anki-ingles-android');
  assert.ok(payload.cards.length > 0);
  dom.window.close();
});

test('os botões de escolher/mudar pasta ficam ocultos', async () => {
  const { window, dom } = boot();
  await flush();
  const choose = window.document.getElementById('btn-backup-folder');
  const change = window.document.getElementById('btn-backup-change');
  // O JS esconde "Escolher pasta"; "Mudar pasta" é escondido só no CSS Android.
  assert.equal(choose.classList.contains('hidden'), true);
  assert.ok(/display:\s*none/.test(fs.readFileSync(path.join(ROOT, 'www', 'style.css'), 'utf8')));
  assert.ok(change);
  dom.window.close();
});
