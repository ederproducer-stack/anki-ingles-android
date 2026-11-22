/*
 * Backup da versão Android.
 *
 * Diferente da versão web, o usuário NÃO escolhe a pasta: o app define sozinho
 * /storage/emulated/0/Android/data/com.ederproducer.ankiingles/files/Anki
 * (Directory.External do Capacitor). Não precisa de permissão de armazenamento
 * e a pasta aparece no gerenciador de arquivos em Android/data/<pacote>/files.
 *
 * A API pública é a mesma do backup.js da versão web, para app.js continuar
 * funcionando sem conhecer o Android.
 */
(function (global) {
  'use strict';

  var BACKUP_FILE = 'anki-ingles-backup.json';
  var BASE_DIR = 'Anki';
  var AUDIO_DIR = BASE_DIR + '/audio';
  var APP_DIR = BASE_DIR + '/app';
  var FALLBACK_PATH = 'Armazenamento interno/Android/data/com.ederproducer.ankiingles/files/Anki';
  var SOURCE_FILES = [
    'index.html', 'style.css', 'theme.css', 'theme-meta.json',
    'app.js', 'srs.js', 'tts.js', 'richtext.js', 'deck.js', 'decks.js', 'backup.js',
    'theme-sync.js', 'native-bundle.js',
    'favicon.svg', 'favicon.png', 'favicon.ico'
  ];

  var resolvedPath = null;
  var lastSaved = null;
  var lastAudioSync = null;
  var audioCount = 0;
  var debounceTimer = null;

  /* -------------------- bridge nativa -------------------- */

  function native() {
    var n = global.AndroidNative;
    return n && n.isNative && n.Filesystem ? n : null;
  }

  function directory(n) { return n.Directory.External; }
  function utf8(n) { return n.Encoding ? n.Encoding.UTF8 : 'utf8'; }

  function ensureDirs() {
    var n = native();
    if (!n) return Promise.resolve(false);
    return Promise.all([BASE_DIR, AUDIO_DIR, APP_DIR].map(function (path) {
      return n.Filesystem.mkdir({ path: path, directory: directory(n), recursive: true })
        .catch(function () { /* já existe */ });
    })).then(function () { return true; });
  }

  function writeText(path, text) {
    var n = native();
    return n.Filesystem.writeFile({
      path: path, directory: directory(n), data: text, encoding: utf8(n)
    });
  }

  function writeBase64(path, base64) {
    var n = native();
    return n.Filesystem.writeFile({
      path: path, directory: directory(n), data: base64
    });
  }

  function readText(path) {
    var n = native();
    return n.Filesystem.readFile({
      path: path, directory: directory(n), encoding: utf8(n)
    }).then(function (r) { return r.data; });
  }

  function readBase64(path) {
    var n = native();
    return n.Filesystem.readFile({ path: path, directory: directory(n) })
      .then(function (r) { return r.data; });
  }

  /* -------------------- base64 / binário -------------------- */

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var out = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(out);
  }

  function base64ToBytes(base64) {
    if (typeof Buffer !== 'undefined' && typeof base64 === 'string') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    var binary = atob(String(base64));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function responseToBase64(data) {
    if (typeof data === 'string') return data;
    if (data && typeof data.base64 === 'string') return data.base64;
    if (data instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(data));
    if (data && ArrayBuffer.isView(data)) {
      return bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (data && typeof data.arrayBuffer === 'function') {
      return data.arrayBuffer().then(function (buffer) {
        return bytesToBase64(new Uint8Array(buffer));
      });
    }
    throw new Error('Resposta de áudio em formato desconhecido');
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function googleUrl(text) {
    return 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=' +
      encodeURIComponent(text);
  }

  /* Busca o MP3 pelo HTTP nativo (ignora CORS) com fallback para fetch. */
  function fetchAudio(text) {
    var n = native();
    if (n && n.CapacitorHttp) {
      return n.CapacitorHttp.get({ url: googleUrl(text), responseType: 'arraybuffer' })
        .then(function (res) {
          if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
          return responseToBase64(res.data);
        });
    }
    return fetch(googleUrl(text)).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(blobToBase64);
  }

  /* -------------------- payload / nomes -------------------- */

  function buildPayload(state) {
    var active = global.Decks && global.Decks.getActive ? global.Decks.getActive() : null;
    return {
      app: 'anki-ingles-android',
      version: 2,
      exportedAt: new Date().toISOString(),
      deckId: active ? active.id : null,
      deckName: active ? active.name : null,
      cards: state.cards,
      settings: state.settings,
      stats: state.stats
    };
  }

  function uniqueFronts(state) {
    var seen = {};
    var texts = [];
    (state.cards || []).forEach(function (c) {
      if (c && c.front && !seen[c.front]) { seen[c.front] = true; texts.push(c.front); }
    });
    return texts;
  }

  /* Nome estável por frase: slug + hash FNV-1a (igual ao da versão web). */
  function audioFileName(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    var slug = String(text).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28) || 'frase';
    return slug + '_' + (hash >>> 0).toString(36) + '.mp3';
  }

  function parse(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (err) { throw new Error('Arquivo não é um JSON válido.'); }
    if (!data || !Array.isArray(data.cards)) throw new Error('Arquivo de backup inválido.');
    var cards = data.cards.filter(function (c) {
      return c && typeof c.front === 'string' && typeof c.back === 'string';
    });
    if (!cards.length) throw new Error('Nenhum cartão válido no arquivo.');
    return { cards: cards, settings: data.settings || {}, stats: data.stats || {} };
  }

  function mapLimit(items, limit, worker) {
    if (!items.length) return Promise.resolve([]);
    var results = new Array(items.length);
    var index = 0;
    function next() {
      if (index >= items.length) return Promise.resolve();
      var i = index++;
      return Promise.resolve().then(function () { return worker(items[i], i); })
        .then(function (r) { results[i] = r; return next(); });
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return results; });
  }

  /* -------------------- áudios -------------------- */

  function countAudios(state) {
    var n = native();
    if (!n) return Promise.resolve(0);
    return n.Filesystem.readdir({ path: AUDIO_DIR, directory: directory(n) })
      .then(function (r) {
        var names = {};
        (state && state.cards || []).forEach(function (c) {
          if (c && c.front) names[audioFileName(c.front)] = true;
        });
        var files = (r.files || []).filter(function (f) { return !f.directory && /\.mp3$/i.test(f.name); });
        audioCount = state ? files.filter(function (f) { return names[f.name]; }).length : files.length;
        return audioCount;
      }).catch(function () { audioCount = 0; return 0; });
  }

  function saveAudios(state, opts) {
    opts = opts || {};
    var texts = uniqueFronts(state);
    var pending = texts.map(function (text) { return { text: text, name: audioFileName(text) }; });

    function missing() {
      if (!opts.onlyMissing) return Promise.resolve(pending);
      var n = native();
      if (!n) return Promise.resolve(pending);
      return n.Filesystem.readdir({ path: AUDIO_DIR, directory: directory(n) })
        .then(function (r) {
          var exist = {};
          (r.files || []).forEach(function (f) { exist[f.name] = true; });
          return pending.filter(function (item) { return !exist[item.name]; });
        }).catch(function () { return pending; });
    }

    return ensureDirs().then(missing).then(function (list) {
      return mapLimit(list, 3, function (item) {
        return fetchAudio(item.text).then(function (base64) {
          return writeBase64(AUDIO_DIR + '/' + item.name, base64);
        });
      });
    }).then(function () {
      lastAudioSync = new Date();
      return countAudios(state).then(function () { return texts.length; });
    });
  }

  /* Blob para o tts.js tocar o MP3 salvo, sem depender de file://. */
  function getAudio(text) {
    if (!text || !native()) return Promise.resolve(null);
    return readBase64(AUDIO_DIR + '/' + audioFileName(text))
      .then(function (base64) {
        return new Blob([base64ToBytes(base64)], { type: 'audio/mpeg' });
      }).catch(function () { return null; });
  }

  /* -------------------- escrita do backup -------------------- */

  function copyAppFiles() {
    return mapLimit(SOURCE_FILES, 4, function (name) {
      return fetch('./' + name).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
        return writeText(APP_DIR + '/' + name, text);
      }).catch(function () { return null; });
    });
  }

  function saveNow(state, includeApp) {
    if (!native()) return Promise.reject(new Error('Backup nativo indisponível'));
    return ensureDirs().then(function () {
      return writeText(BASE_DIR + '/' + BACKUP_FILE,
        JSON.stringify(buildPayload(state), null, 2));
    }).then(function () {
      if (!includeApp) return;
      return copyAppFiles();
    }).then(function () {
      return saveAudios(state, { onlyMissing: true });
    }).then(function () {
      return countAudios(state);
    }).then(function () {
      lastSaved = new Date();
      return { ok: true, path: resolvedPath || FALLBACK_PATH };
    });
  }

  /* Mesma assinatura do servidor da versão web: app.js usa para salvar tudo. */
  function saveToServer(state) {
    return saveNow(state, true);
  }

  function onChange(state) {
    if (!state || !state.settings || !state.settings.autoBackup) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      saveToServer(state).catch(function () { /* tenta de novo na próxima alteração */ });
    }, 2000);
  }

  function readFromFolder() {
    if (!native()) return Promise.reject(new Error('Backup nativo indisponível'));
    return readText(BASE_DIR + '/' + BACKUP_FILE);
  }

  function clearDir() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    audioCount = 0;
    return Promise.resolve(false);
  }

  /* -------------------- ZIP (por compatibilidade; botão fica oculto) -------------------- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
  function concat(parts) {
    var size = 0, i;
    for (i = 0; i < parts.length; i++) size += parts[i].length;
    var out = new Uint8Array(size), offset = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], offset); offset += parts[i].length; }
    return out;
  }

  function makeZip(files) {
    var encoder = new TextEncoder();
    var dt = dosDateTime(new Date());
    var localParts = [], centralParts = [], offset = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var crc = crc32(file.data);
      var local = concat([
        new Uint8Array(u32(0x04034b50)), new Uint8Array(u16(20)), new Uint8Array(u16(0)),
        new Uint8Array(u16(0)), new Uint8Array(u16(dt.time)), new Uint8Array(u16(dt.date)),
        new Uint8Array(u32(crc)), new Uint8Array(u32(file.data.length)), new Uint8Array(u32(file.data.length)),
        new Uint8Array(u16(name.length)), new Uint8Array(u16(0)), name, file.data
      ]);
      var central = concat([
        new Uint8Array(u32(0x02014b50)), new Uint8Array(u16(20)), new Uint8Array(u16(20)),
        new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u16(dt.time)), new Uint8Array(u16(dt.date)),
        new Uint8Array(u32(crc)), new Uint8Array(u32(file.data.length)), new Uint8Array(u32(file.data.length)),
        new Uint8Array(u16(name.length)), new Uint8Array(u16(0)), new Uint8Array(u16(0)),
        new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u32(0)),
        new Uint8Array(u32(offset)), name
      ]);
      localParts.push(local); centralParts.push(central); offset += local.length;
    });
    var centralSize = 0;
    centralParts.forEach(function (p) { centralSize += p.length; });
    var end = concat([
      new Uint8Array(u32(0x06054b50)), new Uint8Array(u16(0)), new Uint8Array(u16(0)),
      new Uint8Array(u16(files.length)), new Uint8Array(u16(files.length)),
      new Uint8Array(u32(centralSize)), new Uint8Array(u32(offset)), new Uint8Array(u16(0))
    ]);
    return new Blob([concat(localParts.concat(centralParts, [end]))], { type: 'application/zip' });
  }

  function download(state) {
    var encoder = new TextEncoder();
    var files = [{ name: BACKUP_FILE, data: encoder.encode(JSON.stringify(buildPayload(state), null, 2)) }];
    return mapLimit(uniqueFronts(state), 8, function (text) {
      return getAudio(text).then(function (blob) {
        if (!blob) return null;
        return blob.arrayBuffer().then(function (buf) {
          files.push({ name: 'audio/' + audioFileName(text), data: new Uint8Array(buf) });
        });
      });
    }).then(function () {
      return makeZip(files).arrayBuffer().then(function (buffer) {
        return writeBase64(BASE_DIR + '/anki-ingles-backup.zip', bytesToBase64(new Uint8Array(buffer)));
      });
    }).then(function () {
      return files.filter(function (f) { return f.name.indexOf('audio/') === 0; }).length;
    }).catch(function () { return 0; });
  }

  /* -------------------- status / init -------------------- */

  function getStatus() {
    return {
      supported: true,
      native: !!native(),
      platform: global.AndroidNative ? global.AndroidNative.platform : 'web',
      folder: BASE_DIR,
      // app.js usa serverPath para mostrar o caminho fixo e esconder "Escolher pasta".
      serverPath: resolvedPath || FALLBACK_PATH,
      lastSaved: lastSaved,
      audioCount: audioCount,
      lastAudioSync: lastAudioSync
    };
  }

  function init() {
    if (!native()) return Promise.resolve(false);
    return ensureDirs().then(function () {
      return global.AndroidNative.Filesystem.getUri({
        path: BASE_DIR, directory: directory(global.AndroidNative)
      });
    }).then(function (r) {
      if (r && r.uri) resolvedPath = decodeURI(String(r.uri)).replace(/^file:\/\//, '');
      return true;
    }).catch(function () { return false; });
  }

  global.Backup = {
    isSupported: function () { return true; },
    init: init,
    getStatus: getStatus,
    saveNow: saveNow,
    saveToServer: saveToServer,
    saveAudios: saveAudios,
    getAudio: getAudio,
    countAudios: countAudios,
    onChange: onChange,
    clearDir: clearDir,
    readFromFolder: readFromFolder,
    parse: parse,
    audioFileName: audioFileName,
    fetchAudioBlob: function (text) {
      return fetchAudio(text).then(function (base64) {
        return new Blob([base64ToBytes(base64)], { type: 'audio/mpeg' });
      });
    },
    download: download,
    makeZip: makeZip,
    googleUrl: googleUrl,
    // A pasta é definida pelo app: estas ações existem só para não quebrar app.js.
    chooseFolder: function () {
      return Promise.reject(new Error('No Android a pasta de backup é definida pelo app.'));
    },
    moveServerFolder: function () {
      return Promise.reject(new Error('No Android a pasta de backup não pode ser alterada.'));
    },
    moveBrowserFolder: function () {
      return Promise.reject(new Error('No Android a pasta de backup não pode ser alterada.'));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
