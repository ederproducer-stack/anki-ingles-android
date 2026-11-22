/*
 * Texto para fala na versão Android, em três tentativas:
 * 1) MP3 salvo pelo Backup na pasta definida pelo app (funciona offline).
 * 2) Google Tradutor via CapacitorHttp (HTTP nativo, sem problema de CORS no WebView).
 * 3) Web Speech API como última reserva.
 */
(function (global) {
  'use strict';

  var audio = null;
  var token = 0;
  var activeResolve = null;
  var activeObjectUrl = null;

  function googleUrl(text, lang) {
    return 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' +
      encodeURIComponent(lang || 'en') + '&q=' + encodeURIComponent(text);
  }

  /* Mantido por compatibilidade com a versão web (não existe proxy no Android). */
  function proxyUrl(text, lang) {
    return googleUrl(text, lang);
  }

  function browserSpeak(text, rate) {
    return new Promise(function (resolve) {
      if (!('speechSynthesis' in global) || !('SpeechSynthesisUtterance' in global)) {
        return resolve(null);
      }
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = rate || 1;
        var voices = global.speechSynthesis.getVoices() || [];
        var voice = voices.filter(function (v) { return /en[-_]US/i.test(v.lang); })[0] ||
                    voices.filter(function (v) { return /^en/i.test(v.lang); })[0];
        if (voice) u.voice = voice;
        u.onend = function () { resolve('speech'); };
        u.onerror = function () { resolve(null); };
        global.speechSynthesis.cancel();
        global.speechSynthesis.speak(u);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function revokeObjectUrl() {
    if (activeObjectUrl) {
      try { URL.revokeObjectURL(activeObjectUrl); } catch (err) { /* ignore */ }
      activeObjectUrl = null;
    }
  }

  function stop() {
    token += 1;
    revokeObjectUrl();
    if (audio) {
      try { audio.pause(); } catch (err) { /* ignore */ }
      try { audio.src = ''; } catch (err) { /* ignore */ }
      audio = null;
    }
    try {
      if ('speechSynthesis' in global) global.speechSynthesis.cancel();
    } catch (err) { /* ignore */ }
    if (activeResolve) {
      var resolve = activeResolve;
      activeResolve = null;
      resolve({ ok: false, via: 'stopped' });
    }
  }

  /*
   * Fala o texto. Retorna Promise<{ ok, via }>, onde via é
   * 'local' | 'google' | 'speech' | 'blocked' | 'none' | 'timeout' | 'stopped'.
   */
  function speak(text, opts) {
    if (!text) return Promise.resolve({ ok: false, via: 'none' });
    opts = opts || {};
    var lang = opts.lang || 'en';
    var rate = opts.rate || 1;

    stop();
    var myToken = token;

    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;

      function finish(via) {
        if (settled || myToken !== token) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (activeResolve) activeResolve = null;
        revokeObjectUrl();
        resolve({
          ok: via === 'local' || via === 'google' || via === 'speech',
          via: via
        });
      }

      activeResolve = function (result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      function tryBrowser() {
        if (myToken !== token) return;
        browserSpeak(text, rate).then(function (via) { finish(via || 'none'); });
      }

      function playBlob(blob, via, onFailure) {
        if (myToken !== token || !blob) return onFailure();
        // Uma tentativa mais rápida (arquivo local) já começou a tocar.
        if (audio) return;
        try {
          activeObjectUrl = URL.createObjectURL(blob);
          var a = new Audio();
          audio = a;
          a.src = activeObjectUrl;
          a.playbackRate = rate;
          a.onended = function () { finish(via); };
          a.onerror = function () { onFailure(); };
          var playPromise;
          try { playPromise = a.play(); }
          catch (err) { playPromise = Promise.reject(err); }
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function (err) {
              if (myToken !== token) return;
              if (err && err.name === 'NotAllowedError') return finish('blocked');
              onFailure();
            });
          }
        } catch (err) {
          onFailure();
        }
      }

      function tryLocal(onFailure) {
        if (myToken !== token || !global.Backup || !global.Backup.getAudio) {
          setTimeout(onFailure, 0);
          return;
        }
        var result;
        try { result = global.Backup.getAudio(text); }
        catch (err) { setTimeout(onFailure, 0); return; }
        if (!result || typeof result.then !== 'function') { setTimeout(onFailure, 0); return; }
        result.then(function (blob) {
          if (myToken !== token) return;
          playBlob(blob, 'local', onFailure);
        }).catch(function () { if (myToken === token) onFailure(); });
        // Rede de segurança: se o plugin não responder, segue para a rede.
        setTimeout(function () {
          if (myToken === token && !audio) onFailure();
        }, 800);
      }

      function tryGoogle() {
        if (myToken !== token) return;
        if (!global.Backup || !global.Backup.fetchAudioBlob) return tryBrowser();
        var result;
        try { result = global.Backup.fetchAudioBlob(text); }
        catch (err) { return tryBrowser(); }
        if (!result || typeof result.then !== 'function') return tryBrowser();
        result.then(function (blob) {
          if (myToken !== token) return;
          playBlob(blob, 'google', tryBrowser);
        }).catch(function () { if (myToken === token) tryBrowser(); });
      }

      // Ordem: arquivo salvo no app (offline) → Google via HTTP nativo → voz do navegador.
      tryLocal(tryGoogle);
      timer = setTimeout(function () { finish('timeout'); }, Math.max(9000, text.length * 200));
    });
  }

  global.TTS = { speak: speak, stop: stop, googleUrl: googleUrl, proxyUrl: proxyUrl };
})(typeof window !== 'undefined' ? window : globalThis);
