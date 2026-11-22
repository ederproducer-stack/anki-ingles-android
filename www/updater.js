/*
 * Atualização direto do GitHub Releases.
 * Verifica a última release pública do repositório Android e, se houver versão
 * mais nova, baixa o APK pelo plugin nativo e abre o instalador do sistema.
 * Cartões, estatísticas e backup não são tocados.
 */
(function (global) {
  'use strict';

  var REPO = 'ederproducer-stack/anki-ingles-android';
  var API = 'https://api.github.com/repos/' + REPO + '/releases/latest';

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bridge() {
    return global.AndroidNative || {};
  }

  function updater() { return bridge().AppUpdater; }
  function http() { return bridge().CapacitorHttp; }

  function toast(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function showModal(html) {
    var root = $('modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal">' + html + '</div></div>';
  }

  function closeModal() {
    var root = $('modal-root');
    if (root) root.innerHTML = '';
  }

  function fetchJson(url) {
    if (http()) {
      return http().get({
        url: url,
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'anki-ingles-android'
        }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      });
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* Compara versões numéricas: 1.10.0 > 1.9.0. */
  function compareVersions(a, b) {
    function parts(v) {
      return String(v || '').replace(/^v/i, '').split(/[.\-+]/).map(function (x) {
        var n = parseInt(x, 10);
        return isNaN(n) ? 0 : n;
      });
    }
    var x = parts(a), y = parts(b);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function findApk(release) {
    var assets = (release && release.assets) || [];
    for (var i = 0; i < assets.length; i++) {
      if (/\.apk$/i.test(assets[i].name)) return assets[i];
    }
    return null;
  }

  function setStatus(text) {
    var el = $('update-status');
    if (el) el.textContent = text;
  }

  function install(asset) {
    var go = $('update-go');
    if (!go || !updater()) return;
    go.disabled = true;
    go.textContent = 'Baixando...';

    updater().downloadAndInstall({ url: asset.browser_download_url }).then(function (result) {
      closeModal();
      if (result && result.needsPermission) {
        toast('Permita a instalação de apps desconhecidos para este app e tente de novo.');
        showModal(
          '<h2>Permissão necessária</h2>' +
          '<p class="update-text">O Android exige autorização para instalar um APK fora da Play Store. ' +
          'Ative a opção para o Anki Inglês e depois toque em “Verificar atualizações” novamente.</p>' +
          '<div class="modal-actions">' +
            '<button id="update-cancel" class="btn btn-ghost">Fechar</button>' +
            '<button id="update-settings" class="btn btn-primary">Abrir configurações</button>' +
          '</div>'
        );
        $('update-cancel').onclick = closeModal;
        $('update-settings').onclick = function () {
          updater().openInstallSettings().catch(function (err) { toast(err.message || String(err)); });
        };
        return;
      }
      toast('Download concluído! Confirme a instalação na tela do Android.');
    }).catch(function (err) {
      go.disabled = false;
      go.textContent = 'Baixar e instalar';
      toast('Falha ao baixar: ' + (err && err.message ? err.message : String(err)));
    });
  }

  function showInfo(current, release) {
    var remote = String(release.tag_name || release.name || '').replace(/^v/i, '');
    var newer = compareVersions(remote, current) > 0;
    var badge = newer
      ? '<div class="update-badge new">Nova versão disponível</div>'
      : '<div class="update-badge ok">✓ Tudo em dia</div>';
    var text = newer
      ? '<p class="update-text">A versão <strong>' + esc(remote) + '</strong> está pronta para instalar. ' +
        'O download sai direto do GitHub e seus cartões ficam intactos.</p>'
      : '<p class="update-text">Você já está usando a versão mais recente.</p>';
    var notes = newer && release.body
      ? '<p class="update-help">' + esc(release.body.slice(0, 400)) + '</p>'
      : '';
    var apk = findApk(release);
    if (newer && !apk) {
      badge = '<div class="update-badge warn">Sem APK</div>';
      text = '<p class="update-text">A release mais nova não tem um arquivo .apk anexado.</p>';
    }

    showModal(
      '<h2>Atualizar do GitHub</h2>' +
      '<div class="update-card">' +
        '<div><span>Versão instalada</span><strong>' + esc(current) + '</strong></div>' +
        '<div><span>Versão disponível</span><strong>' + esc(remote) + '</strong></div>' +
      '</div>' + badge + text + notes +
      '<div class="modal-actions">' +
        '<button id="update-cancel" class="btn btn-ghost">Fechar</button>' +
        (newer && apk ? '<button id="update-go" class="btn btn-primary">Baixar e instalar</button>' : '') +
      '</div>'
    );
    $('update-cancel').onclick = closeModal;
    if ($('update-go')) $('update-go').onclick = function () { install(apk); };
  }

  function check() {
    var btn = $('btn-update-app');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    setStatus('Consultando o GitHub...');

    var currentPromise = updater()
      ? updater().getVersion().then(function (info) { return info.version || ''; })
      : Promise.resolve('');

    Promise.all([fetchJson(API), currentPromise]).then(function (results) {
      btn.disabled = false;
      btn.textContent = 'Verificar atualizações';
      var release = results[0];
      var current = results[1];
      setStatus('Versão instalada: ' + (current || 'desconhecida'));
      showInfo(current, release);
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Verificar atualizações';
      setStatus('Não foi possível consultar o GitHub: ' + (err && err.message ? err.message : String(err)));
      toast('Não foi possível verificar atualizações.');
    });
  }

  function init() {
    var btn = $('btn-update-app');
    if (btn) btn.onclick = check;
    if (updater()) {
      updater().getVersion().then(function (info) {
        setStatus('Versão instalada: ' + (info.version || 'desconhecida') +
          ' • verifique se há novidades no GitHub.');
      }).catch(function () { /* mantém o texto padrão */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exportado para testes.
  global.AppUpdaterUI = { check: check, compareVersions: compareVersions, findApk: findApk };
})(typeof window !== 'undefined' ? window : globalThis);
