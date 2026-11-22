/*
 * Testes do backup Android com a bridge nativa falsificada.
 * O áudio de TTS nunca é gravado: estes testes garantem isso.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'www', 'backup.js'), 'utf8'
);

function makeFakeNative() {
  const files = new Map();
  const requests = [];
  const Filesystem = {
    async mkdir() {},
    async writeFile({ path: filePath, data }) { files.set(filePath, data); },
    async readFile({ path: filePath }) {
      if (!files.has(filePath)) throw new Error('arquivo inexistente: ' + filePath);
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
      return {
        uri: 'file:///storage/emulated/0/Android/data/com.ederproducer.ankiingles/files/' + dirPath
      };
    }
  };
  const CapacitorHttp = {
    async get(options) {
      requests.push(options.url);
      return { status: 200, data: Buffer.from('mp3-falso').toString('base64') };
    }
  };
  return {
    native: {
      isNative: true,
      platform: 'android',
      Filesystem,
      Directory: { External: 'EXTERNAL' },
      Encoding: { UTF8: 'utf8' },
      CapacitorHttp
    },
    files,
    requests
  };
}

function loadBackup(native) {
  const Decks = { getActive: () => ({ id: 'deck-1', name: 'Meu deck' }) };
  const sandbox = {
    window: { AndroidNative: native, Decks },
    Blob, Buffer, Uint8Array, TextEncoder, TextDecoder,
    btoa, atob, setTimeout, clearTimeout, Date, Math, JSON, Promise,
    fetch: async () => ({ ok: true, text: async () => 'conteudo' }),
    Decks
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  return sandbox.window.Backup;
}

function sampleState() {
  return {
    cards: [
      { id: '1', front: 'Hello world', back: 'Olá mundo' },
      { id: '2', front: 'Good morning', back: 'Bom dia' }
    ],
    settings: { autoBackup: true, rate: 1 },
    stats: { totalReviews: 3, history: {} }
  };
}

test('a pasta é definida pelo app e exposta no status', async () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  assert.equal(await backup.init(), true);
  const status = backup.getStatus();
  assert.equal(status.folder, 'Anki');
  assert.equal(
    status.serverPath,
    '/storage/emulated/0/Android/data/com.ederproducer.ankiingles/files/Anki'
  );
  assert.equal(status.native, true);
  assert.equal(status.audioOnlineOnly, true);
});

test('não há escolha nem mudança de pasta pelo usuário', async () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  await assert.rejects(backup.chooseFolder(), /definida pelo app/);
  await assert.rejects(backup.moveServerFolder(), /não pode ser alterada/);
  await assert.rejects(backup.moveBrowserFolder(), /não pode ser alterada/);
});

test('saveToServer grava JSON e arquivos do app, sem MP3s', async () => {
  const { native, files } = makeFakeNative();
  const backup = loadBackup(native);
  await backup.init();

  const result = await backup.saveToServer(sampleState());
  assert.equal(result.ok, true);

  const payload = JSON.parse(files.get('Anki/anki-ingles-backup.json'));
  assert.equal(payload.app, 'anki-ingles-android');
  assert.equal(payload.deckId, 'deck-1');
  assert.equal(payload.cards.length, 2);
  assert.equal(files.has('Anki/app/index.html'), true);
  assert.equal([...files.keys()].some((name) => name.includes('/audio/')), false);
  assert.equal([...files.keys()].some((name) => name.endsWith('.mp3')), false);
  assert.equal(backup.getStatus().audioCount, 0);
  assert.ok(backup.getStatus().lastSaved instanceof Date);
});

test('nenhum áudio é salvo no dispositivo', async () => {
  const { native, files } = makeFakeNative();
  const backup = loadBackup(native);
  await backup.init();
  assert.equal(await backup.saveAudios(sampleState()), 0);
  assert.equal(await backup.getAudio('Good morning'), null);
  assert.equal(await backup.countAudios(sampleState()), 0);
  assert.equal(files.size, 0);
});

test('fetchAudioBlob busca o MP3 online sem gravar arquivo', async () => {
  const { native, files, requests } = makeFakeNative();
  const backup = loadBackup(native);
  const blob = await backup.fetchAudioBlob('Hello world');
  assert.ok(blob instanceof Blob);
  assert.equal(Buffer.from(await blob.arrayBuffer()).toString(), 'mp3-falso');
  assert.match(requests[0], /translate\.google\.com\/translate_tts/);
  assert.equal(files.size, 0);
});

test('audioFileName é estável e igual ao da versão web', () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  assert.equal(backup.audioFileName('Hello world'), backup.audioFileName('Hello world'));
  assert.match(backup.audioFileName('Good morning!'), /^good_morning_[0-9a-z]+\.mp3$/);
});

test('parse aceita backup válido e rejeita lixo', () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  const valid = JSON.stringify({ cards: [{ front: 'a', back: 'b' }], settings: {}, stats: {} });
  assert.equal(backup.parse(valid).cards.length, 1);
  assert.throws(() => backup.parse('{'), /JSON válido/);
  assert.throws(() => backup.parse('{}'), /inválido/);
  assert.throws(() => backup.parse(JSON.stringify({ cards: [] })), /Nenhum cartão/);
});

test('readFromFolder lê o JSON gravado', async () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  await backup.init();
  await backup.saveToServer(sampleState());
  const text = await backup.readFromFolder();
  assert.equal(backup.parse(text).cards.length, 2);
});

test('makeZip gera um ZIP com assinatura PK', async () => {
  const { native } = makeFakeNative();
  const backup = loadBackup(native);
  const zip = backup.makeZip([{ name: 'a.txt', data: new TextEncoder().encode('abc') }]);
  const bytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
});
