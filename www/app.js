(function () {
  'use strict';

  var session = null;
  var currentScreen = 'study';
  var initialLoad = true;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() { return Decks.uid(); }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function globalBackup() { return typeof Backup !== 'undefined' ? Backup : null; }

  function appState() { return Decks.getState(); }
  function settings() { return appState().settings; }
  function deck() { return Decks.getActive(); }
  function cards() { return deck() ? deck().cards : []; }
  function stats() { return deck() ? deck().stats : { totalReviews: 0, history: {} }; }

  function save() {
    Decks.save();
    if (globalBackup()) {
      globalBackup().onChange({ cards: deck().cards, settings: settings(), stats: deck().stats });
    }
  }

  function getCard(id) {
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function dueCount() {
    var now = Date.now();
    return cards().filter(function (c) { return c.due <= now; }).length;
  }

  function recordHistory(rating) {
    var s = stats();
    var key = todayKey();
    if (!s.history[key]) s.history[key] = { again: 0, hard: 0, good: 0, easy: 0 };
    s.history[key][rating] = (s.history[key][rating] || 0) + 1;
    s.totalReviews += 1;
    var keys = Object.keys(s.history).sort();
    while (keys.length > 60) delete s.history[keys.shift()];
  }

  /* ------------------ Navegação ------------------ */

  function showScreen(name) {
    currentScreen = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-screen') === name);
    }
    var screens = document.querySelectorAll('.screen');
    for (var j = 0; j < screens.length; j++) {
      screens[j].classList.toggle('active', screens[j].id === 'screen-' + name);
    }
    if (name !== 'study') TTS.stop();
    if (name === 'cards') renderCards();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
  }

  /* ------------------ Decks ------------------ */

  function renderDeckSwitcher() {
    var sel = $('deck-select');
    sel.innerHTML = Decks.getDecks().map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + ' (' + d.cards.length + ')</option>';
    }).join('');
    sel.value = deck().id;
  }

  function syncAudios() {
    var b = globalBackup();
    if (!b || !settings().autoBackup) return;
    if (b.getStatus().serverPath) {
      b.saveToServer({ cards: deck().cards, settings: settings(), stats: deck().stats })
        .then(function () { renderBackupStatus(); })
        .catch(function () { /* o backup automático tenta de novo */ });
      return;
    }
    b.saveAudios(deck(), { onlyMissing: true }).then(function (n) {
      if (n) b.countAudios(deck()).then(function () { renderBackupStatus(); });
    }).catch(function () { /* sem internet: tenta na próxima alteração */ });
  }

  function switchDeck(id) {
    if (!Decks.setActive(id)) return;
    session = null;
    TTS.stop();
    if (globalBackup()) globalBackup().clearDir();
    renderDeckSwitcher();
    renderSettings();
    renderCards();
    renderStats();
    startSession(settings().free, true);
    syncAudios();
    toast('Deck "' + deck().name + '" ativado.');
  }

  function openDeckModal(mode) {
    var d = deck();
    var editing = mode === 'rename';
    openModal(
      '<h2>' + (editing ? 'Renomear deck' : 'Novo deck') + '</h2>' +
      (editing
        ? '<div class="field"><label for="deck-name">Nome do deck</label>' +
          '<input id="deck-name" class="input" value="' + esc(d.name) + '" required /></div>'
        : '<div class="field"><label for="deck-name">Nome do deck</label>' +
          '<input id="deck-name" class="input" placeholder="Ex.: Inglês para viagem" required /></div>' +
          '<label class="setting" style="border:0;padding:0">' +
            '<input type="checkbox" id="deck-seed" />' +
            '<span><strong>Copiar as 30 frases de exemplo</strong><small>Se desmarcado, o deck começa vazio.</small></span>' +
          '</label>') +
      '<div class="modal-actions">' +
        '<button id="deck-cancel" class="btn btn-ghost">Cancelar</button>' +
        '<button id="deck-go" class="btn btn-primary">' + (editing ? 'Salvar' : 'Criar deck') + '</button>' +
      '</div>'
    );
    $('deck-cancel').onclick = closeModal;
    $('deck-go').onclick = function () {
      var name = $('deck-name').value.trim();
      try {
        var changed;
        if (editing) {
          changed = Decks.renameDeck(d.id, name);
          toast('Deck renomeado.');
        } else {
          changed = Decks.createDeck(name, $('deck-seed') && $('deck-seed').checked);
          toast('Deck "' + changed.name + '" criado!');
        }
        closeModal();
        renderDeckSwitcher();
        renderSettings();
        renderCards(); renderStats();
        session = null;
        startSession(settings().free, true);
        syncAudios();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  function deleteDeckModal() {
    var d = deck();
    if (Decks.getDecks().length <= 1) return toast('Não é possível excluir o único deck.');
    if (!confirm('Excluir o deck "' + d.name + '" e seus ' + d.cards.length + ' cartões? Isso não pode ser desfeito.')) return;
    try {
      Decks.deleteDeck(d.id);
      if (globalBackup()) globalBackup().clearDir();
      session = null;
      renderDeckSwitcher(); renderSettings(); renderCards(); renderStats();
      startSession(settings().free, true);
      toast('Deck excluído.');
    } catch (err) {
      toast(err.message);
    }
  }

  /* ------------------ Sessão de estudo ------------------ */

  function startSession(free, silent) {
    var now = Date.now();
    var eligible = cards().filter(function (c) { return free || c.due <= now; });

    if (!free) {
      var reviews = eligible.filter(function (c) { return c.reps > 0; });
      var fresh = eligible.filter(function (c) { return c.reps === 0; })
        .slice(0, settings().newPerDay);
      eligible = reviews.concat(fresh);
    }

    eligible.sort(function (a, b) { return a.due - b.due; });
    var queue = eligible.slice(0, settings().dailyLimit).map(function (c) {
      return { id: c.id, again: 0 };
    });

    session = {
      queue: queue,
      done: 0,
      counts: { again: 0, hard: 0, good: 0, easy: 0 },
      free: !!free,
      silent: !!silent
    };

    $('session-summary').classList.add('hidden');
    $('study-empty').classList.add('hidden');
    $('study-area').classList.remove('hidden');
    $('btn-end').classList.remove('hidden');

    if (queue.length === 0) return showEmpty();
    nextCard();
  }

  /* Mantém a sessão ativa sincronizada quando cartões são adicionados/removidos,
     sem exigir recarregar a página. */
  function refreshSessionHeader() {
    if (!session) return;
    var remaining = session.queue.length;
    $('study-title').textContent = remaining + (remaining === 1 ? ' cartão restante' : ' cartões restantes');
    $('study-sub').textContent = session.free
      ? 'Modo livre — praticando todos os cartões'
      : 'Revisão do dia • ' + dueCount() + ' disponíveis no total';
  }

  function notifyCardsAdded(ids) {
    ids = ids || [];
    if (!session || $('session-summary') && !$('session-summary').classList.contains('hidden') ||
        !$('study-empty').classList.contains('hidden')) {
      startSession(settings().free);
      return;
    }
    ids.forEach(function (id) {
      if (!session.queue.some(function (item) { return item.id === id; })) {
        session.queue.push({ id: id, again: 0 });
      }
    });
    refreshSessionHeader();
  }

  function notifyCardsRemoved(ids) {
    if (!session) return;
    session.queue = session.queue.filter(function (item) {
      return ids.indexOf(item.id) < 0;
    });
    if (!session.queue.length) return startSession(settings().free);
    refreshSessionHeader();
  }

  function showEmpty() {
    $('study-area').classList.add('hidden');
    $('study-empty').classList.remove('hidden');
    $('btn-end').classList.add('hidden');
    $('study-title').textContent = 'Nada pendente';
    $('study-sub').textContent = 'Você está em dia.';
    $('progress-bar').style.width = '100%';

    var next = cards()
      .filter(function (c) { return c.due > Date.now(); })
      .sort(function (a, b) { return a.due - b.due; })[0];
    $('empty-message').textContent = next
      ? 'Próxima revisão: ' + formatDue(next.due) + '. Quer praticar mesmo assim?'
      : 'Você ainda não tem cartões. Adicione uma frase para começar.';
  }

  function formatDue(due) {
    var diff = due - Date.now();
    if (diff <= 0) return 'agora';
    if (diff < 60 * 60 * 1000) return 'em ' + Math.ceil(diff / 60000) + ' min';
    if (diff < 24 * 60 * 60 * 1000) return 'em ' + Math.ceil(diff / 3600000) + ' h';
    var days = Math.ceil(diff / 86400000);
    return 'em ' + days + (days === 1 ? ' dia' : ' dias');
  }

  function currentCard() {
    if (!session || !session.queue.length) return null;
    return getCard(session.queue[0].id);
  }

  function nextCard() {
    if (!session) return;
    if (!session.queue.length) return finishSession(false);
    var card = getCard(session.queue[0].id);
    if (!card) {
      session.queue.shift();
      return nextCard();
    }
    renderCard(card);
  }

  function intervalLabel(days) {
    if (!days) return '< 1 dia';
    if (days === 1) return '1 dia';
    if (days < 30) return days + ' dias';
    var months = Math.round(days / 30);
    return months <= 1 ? '1 mês' : months + ' meses';
  }

  function renderCard(card) {
    var flashcard = $('flashcard');
    flashcard.classList.remove('flipped');
    $('card-front').innerHTML = RichText.sanitize(card.front);
    $('card-back').innerHTML = RichText.sanitize(card.back);
    $('card-meta').textContent = card.reps === 0
      ? '✨ Novo cartão'
      : 'Revisão ' + (card.reps + 1) + ' • intervalo atual: ' + intervalLabel(card.interval);

    $('controls-front').classList.remove('hidden');
    $('controls-back').classList.add('hidden');

    $('int-again').textContent = SRS.formatInterval(card, 'again');
    $('int-hard').textContent = SRS.formatInterval(card, 'hard');
    $('int-good').textContent = SRS.formatInterval(card, 'good');
    $('int-easy').textContent = SRS.formatInterval(card, 'easy');

    var remaining = session.queue.length;
    $('study-title').textContent = remaining + (remaining === 1 ? ' cartão restante' : ' cartões restantes');
    $('study-sub').textContent = session.free
      ? 'Modo livre — praticando todos os cartões'
      : 'Revisão do dia • ' + dueCount() + ' disponíveis no total';

    var done = session.done;
    var pct = Math.round((done / (done + remaining)) * 100);
    $('progress-bar').style.width = pct + '%';

    if (settings().autoplay && !session.silent) speakCurrent();
  }

  function flip() {
    var card = currentCard();
    if (!card) return;
    session.silent = false; // interação explícita: autoplay volta a valer
    var flashcard = $('flashcard');
    var flipped = flashcard.classList.toggle('flipped');
    $('controls-front').classList.toggle('hidden', flipped);
    $('controls-back').classList.toggle('hidden', !flipped);
    if (flipped && settings().autoplay) speakCurrent();
  }

  function speakCurrent() {
    var card = currentCard();
    if (!card) return;
    var buttons = document.querySelectorAll('[data-speak]');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.add('playing');

    TTS.speak(RichText.strip(card.front), { lang: 'en', rate: settings().rate }).then(function (result) {
      for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('playing');
      if (result.via === 'blocked') {
        if (initialLoad) initialLoad = false;
        else toast('O navegador bloqueou o áudio. Clique no botão 🔊 para ouvir.');
      } else if (!result.ok && result.via !== 'stopped') {
        toast('Não foi possível reproduzir a voz. Verifique o som do navegador.');
      }
    });
  }

  function rate(rating) {
    if (!session || !session.queue.length) return;
    var item = session.queue[0];
    var card = getCard(item.id);
    if (!card) return;

    session.silent = false; // próximos cartões voltam a respeitar o autoplay
    var result = SRS.schedule(card, rating, Date.now());
    Object.assign(card, result.card);
    session.counts[rating] += 1;
    session.done += 1;
    recordHistory(rating);
    session.queue.shift();

    if (result.requeue) {
      var insertAt = Math.min(2, session.queue.length);
      session.queue.splice(insertAt, 0, { id: card.id, again: item.again + 1 });
    }

    save();
    nextCard();
  }

  function finishSession(manual) {
    TTS.stop();
    var counts = session ? session.counts : { again: 0, hard: 0, good: 0, easy: 0 };
    var reviewed = counts.again + counts.hard + counts.good + counts.easy;
    session = null;

    $('study-area').classList.add('hidden');
    $('study-empty').classList.add('hidden');
    $('btn-end').classList.add('hidden');
    $('session-summary').classList.remove('hidden');
    $('study-title').textContent = manual ? 'Sessão encerrada' : 'Sessão concluída';
    $('study-sub').textContent = 'Bom trabalho!';
    $('progress-bar').style.width = '100%';

    $('session-summary').innerHTML =
      '<div class="empty-icon">' + (manual ? '👋' : '🎉') + '</div>' +
      '<h2>' + (manual ? 'Até a próxima!' : 'Sessão concluída!') + '</h2>' +
      '<p class="muted">' + reviewed + ' avaliação(ões) nesta sessão.</p>' +
      '<div class="summary-counts">' +
        '<span style="color:var(--again)">De novo: ' + counts.again + '</span>' +
        '<span style="color:var(--hard)">Difícil: ' + counts.hard + '</span>' +
        '<span style="color:var(--good)">Bom: ' + counts.good + '</span>' +
        '<span style="color:var(--easy)">Fácil: ' + counts.easy + '</span>' +
      '</div>' +
      '<div class="row center">' +
        '<button id="btn-new-session" class="btn btn-primary">Nova sessão</button>' +
        '<button id="btn-summary-cards" class="btn btn-ghost">Ver cartões</button>' +
      '</div>';
    $('btn-new-session').onclick = function () { startSession(settings().free); };
    $('btn-summary-cards').onclick = function () { showScreen('cards'); };
  }

  /* ------------------ Cartões ------------------ */

  function renderCards() {
    var query = ($('card-search').value || '').toLowerCase().trim();
    var list = cards().filter(function (c) {
      return RichText.strip(c.front).toLowerCase().indexOf(query) >= 0 ||
        RichText.strip(c.back).toLowerCase().indexOf(query) >= 0;
    });
    // Cartões novos (nunca avaliados) primeiro, com os mais recentes no topo.
    var originalIndex = {};
    cards().forEach(function (c, i) { originalIndex[c.id] = i; });
    list.sort(function (a, b) {
      var an = a.reps === 0 ? 0 : 1;
      var bn = b.reps === 0 ? 0 : 1;
      if (an !== bn) return an - bn;
      if (an === 0) {
        var byDate = (b.created || b.due) - (a.created || a.due);
        // Desempate: cartões adicionados depois (índice maior) vêm primeiro.
        return byDate !== 0 ? byDate : originalIndex[b.id] - originalIndex[a.id];
      }
      return 0; // preserva a ordem original entre cartões já estudados
    });
    $('cards-count').textContent = list.length + (list.length === 1 ? ' cartão' : ' cartões') +
      ' no deck "' + deck().name + '" • ' + dueCount() + ' para hoje';

    if (!list.length) {
      $('cards-list').innerHTML = '<div class="empty-state"><p class="muted">Nenhum cartão encontrado.</p></div>';
      return;
    }

    $('cards-list').innerHTML = list.map(function (c) {
      return '<div class="card-row">' +
        '<div class="en">' + RichText.sanitize(c.front) + '</div>' +
        '<div class="pt">' + RichText.sanitize(c.back) + '</div>' +
        '<span class="badge">' + (c.reps === 0 ? 'novo' : intervalLabel(c.interval)) + '</span>' +
        '<div class="row">' +
          '<button class="icon-btn" data-speak-card="' + esc(c.id) + '" title="Ouvir em inglês">🔊</button>' +
          '<button class="icon-btn" data-edit="' + esc(c.id) + '" title="Editar">✏️</button>' +
          '<button class="icon-btn del" data-del="' + esc(c.id) + '" title="Excluir">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openModal(html) {
    var root = $('modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal">' + html + '</div></div>';
    root.querySelector('.modal-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    var first = root.querySelector('input, textarea');
    if (first) first.focus();
  }

  function closeModal() { $('modal-root').innerHTML = ''; }

  function editorToolbar(target) {
    return '<div class="editor-toolbar" data-toolbar="' + target + '">' +
      '<button type="button" data-cmd="bold" title="Negrito (Ctrl+B)"><b>B</b></button>' +
      '<button type="button" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>' +
      '<button type="button" data-cmd="underline" title="Sublinhado (Ctrl+U)"><u>U</u></button>' +
      '<span class="toolbar-sep"></span>' +
      '<label class="toolbar-color" title="Cor do texto">' +
        '<input type="color" data-color="' + target + '" value="#e68e0d" /> Cor' +
      '</label>' +
      '<button type="button" data-cmd="removeFormat" title="Limpar formatação">⌫</button>' +
    '</div>';
  }

  function bindEditor(editorId, toolbarId) {
    var editor = $(editorId);
    var toolbar = document.querySelector(toolbarId);
    var savedRange = null;

    function saveSelection() {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    }
    function restoreSelection() {
      editor.focus();
      if (savedRange) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }

    editor.addEventListener('mouseup', saveSelection);
    editor.addEventListener('keyup', saveSelection);
    editor.addEventListener('focus', function () {
      if (!savedRange) {
        var range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        savedRange = range;
      }
    });

    toolbar.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) e.preventDefault(); // mantém a seleção
    });
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      restoreSelection();
      document.execCommand(btn.getAttribute('data-cmd'), false, null);
      saveSelection();
    });
    // Aplica a cor diretamente na seleção, sem precisar focar o editor nem
      // esperar o diálogo nativo do seletor de cores.
    function applyColor(value) {
      var sel = window.getSelection();
      var range = savedRange;
      if (range && editor.contains(range.commonAncestorContainer) && !range.collapsed) {
        try {
          var fragment = range.extractContents();
          var span = document.createElement('span');
          span.style.color = value;
          span.appendChild(fragment);
          range.insertNode(span);
          var next = document.createRange();
          next.selectNodeContents(span);
          sel.removeAllRanges();
          sel.addRange(next);
          savedRange = next.cloneRange();
          return;
        } catch (err) { /* cai no fallback abaixo */ }
      }
      // Sem seleção de texto: aplica a cor para a próxima digitação.
      editor.focus();
      if (range) {
        try { sel.removeAllRanges(); sel.addRange(range); } catch (err) { /* ignora */ }
      }
      document.execCommand('foreColor', false, value);
      saveSelection();
    }

    var color = toolbar.querySelector('input[data-color]');
    color.addEventListener('mousedown', function () {
      saveSelection();
      applyColor(color.value); // cor atual já é aplicada ao clicar no quadrado
    });
    color.addEventListener('change', function () {
      applyColor(color.value); // atualiza se o usuário escolher outra cor
    });

    editor.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[k], false, null);
      }
    });
  }

  function openCardModal(card) {
    var editing = !!card;
    var frontHtml = RichText.sanitize(card ? card.front : '');
    var backHtml = RichText.sanitize(card ? card.back : '');
    openModal(
      '<h2>' + (editing ? 'Editar cartão' : 'Novo cartão') + '</h2>' +
      '<p class="help">Selecione uma palavra e use a barra para negrito, itálico, sublinhado ou cor.</p>' +
      '<form id="card-form">' +
        '<div class="field"><label>Frase em inglês 🇺🇸</label>' +
          editorToolbar('front') +
          '<div id="f-front" class="editor" contenteditable="true" data-placeholder="Ex.: I am <b>very</b> happy.">' + frontHtml + '</div></div>' +
        '<div class="field"><label>Tradução em português 🇧🇷</label>' +
          editorToolbar('back') +
          '<div id="f-back" class="editor" contenteditable="true" data-placeholder="Ex.: Eu estou <i>muito</i> feliz.">' + backHtml + '</div></div>' +
        '<div class="field"><label for="f-notes">Observação (opcional)</label>' +
          '<input id="f-notes" class="input" value="' + esc(card ? card.notes : '') + '" /></div>' +
        '<button type="button" id="f-test" class="btn btn-ghost">🔊 Ouvir frase em inglês</button>' +
        '<div class="modal-actions">' +
          '<button type="button" id="f-cancel" class="btn btn-ghost">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Salvar</button>' +
        '</div>' +
      '</form>'
    );
    bindEditor('f-front', '.editor-toolbar[data-toolbar="front"]');
    bindEditor('f-back', '.editor-toolbar[data-toolbar="back"]');
    $('f-front').focus();
    $('f-cancel').onclick = closeModal;
    $('f-test').onclick = function () {
      TTS.speak(RichText.strip($('f-front').innerHTML) || 'Hello world', {
        lang: 'en', rate: settings().rate
      });
    };
    $('card-form').onsubmit = function (e) {
      e.preventDefault();
      var front = RichText.sanitize($('f-front').innerHTML);
      var back = RichText.sanitize($('f-back').innerHTML);
      if (!RichText.strip(front) || !RichText.strip(back)) {
        return toast('Preencha os dois lados do cartão.');
      }
      var notes = $('f-notes').value.trim();
      var created = null;
      if (editing) {
        card.front = front; card.back = back; card.notes = notes;
      } else {
        created = SRS.newCard(uid(), front, back, notes);
        cards().push(created);
      }
      save(); closeModal(); renderDeckSwitcher(); renderCards();
      if (created) notifyCardsAdded([created.id]);
      toast(editing ? 'Cartão atualizado.' : 'Cartão adicionado!');
    };
  }

  function openImportModal() {
    openModal(
      '<h2>Importar frases</h2>' +
      '<p class="help">Uma frase por linha, no formato <strong>inglês :: português</strong> (ou separado por tab).</p>' +
      '<div class="field"><textarea id="import-text" placeholder="Could you help me? :: Você pode me ajudar?\nI am tired. :: Eu estou cansado."></textarea></div>' +
      '<div class="modal-actions">' +
        '<button id="import-cancel" class="btn btn-ghost">Cancelar</button>' +
        '<button id="import-go" class="btn btn-primary">Importar</button>' +
      '</div>'
    );
    $('import-cancel').onclick = closeModal;
    $('import-go').onclick = function () {
      var lines = $('import-text').value.split(/\r?\n/);
      var ids = [];
      lines.forEach(function (line) {
        var parts = line.indexOf('\t') >= 0 ? line.split('\t') : line.split('::');
        if (parts.length < 2) return;
        var front = parts[0].trim();
        var back = parts.slice(1).join('::').trim();
        if (!front || !back) return;
        var created = SRS.newCard(uid(), front, back, '');
        cards().push(created);
        ids.push(created.id);
      });
      if (!ids.length) return toast('Nenhuma frase válida encontrada. Use: inglês :: português');
      save(); closeModal(); renderDeckSwitcher(); renderCards();
      notifyCardsAdded(ids);
      toast(ids.length + (ids.length === 1 ? ' cartão importado!' : ' cartões importados!'));
    };
  }

  function exportCards() {
    if (!globalBackup()) return;
    globalBackup().download({ cards: deck().cards, settings: settings(), stats: deck().stats })
      .then(function (n) {
        toast('Backup baixado: ZIP com JSON, arquivos e ' + n + ' áudio(s).');
      })
      .catch(function (err) { toast('Falha ao baixar: ' + err.message); });
  }

  function openImportDeckModal() {
    openModal(
      '<h2>Importar deck</h2>' +
      '<p class="help">Cole o JSON de um deck ou backup. Ele será criado como um novo deck, sem apagar os atuais.</p>' +
      '<div class="field"><label for="importdeck-name">Nome do novo deck</label>' +
        '<input id="importdeck-name" class="input" placeholder="Ex.: Inglês para viagem" /></div>' +
      '<div class="field"><textarea id="importdeck-text" placeholder=\'{"cards":[{"front":"Hello","back":"Olá"}]}\'></textarea></div>' +
      '<div class="modal-actions">' +
        '<button id="importdeck-cancel" class="btn btn-ghost">Cancelar</button>' +
        '<button id="importdeck-go" class="btn btn-primary">Importar</button>' +
      '</div>'
    );
    $('importdeck-cancel').onclick = closeModal;
    $('importdeck-go').onclick = function () {
      var text = $('importdeck-text').value.trim();
      var name = $('importdeck-name').value.trim();
      if (!text) return toast('Cole o JSON do deck.');
      try {
        var data = JSON.parse(text);
        var newDeck = Decks.importDeck(data, name || (data.app === 'anki-ingles' ? 'Deck importado' : 'Novo deck'));
        closeModal();
        if (globalBackup()) globalBackup().clearDir();
        renderDeckSwitcher(); renderSettings(); renderCards(); renderStats();
        session = null; startSession(settings().free, true);
        syncAudios();
        toast('Deck "' + newDeck.name + '" importado com ' + newDeck.cards.length + ' cartões!');
      } catch (err) {
        toast('Erro: ' + err.message);
      }
    };
  }

  /* ------------------ Estatísticas e configurações ------------------ */

  function renderStats() {
    var s = stats();
    var total = s.totalReviews;
    var today = s.history[todayKey()] || { again: 0, hard: 0, good: 0, easy: 0 };
    var todayTotal = today.again + today.hard + today.good + today.easy;
    var learned = cards().filter(function (c) { return c.reps > 0; }).length;
    var newToday = cards().filter(function (c) {
      return todayKey(new Date(c.created || c.due)) === todayKey();
    }).length;
    var accuracy = total ? Math.round(((total - (sumField('again'))) / total) * 100) : 0;

    var boxes = [
      ['Cartões no deck', cards().length],
      ['Para revisar hoje', dueCount()],
      ['Cartões novos hoje', newToday],
      ['Cartões aprendidos', learned],
      ['Avaliações hoje', todayTotal],
      ['Avaliações no total', total],
      ['Precisão', accuracy + '%']
    ];
    $('stat-cards').innerHTML = boxes.map(function (b) {
      return '<div class="stat-box"><div class="value">' + b[1] + '</div><div class="label">' + b[0] + '</div></div>';
    }).join('');

    var days = [];
    var weekday = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      var h = s.history[todayKey(d)] || {};
      days.push({
        label: weekday[d.getDay()],
        total: (h.again || 0) + (h.hard || 0) + (h.good || 0) + (h.easy || 0)
      });
    }
    var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
    $('chart').innerHTML = days.map(function (x) {
      var height = Math.max(2, Math.round((x.total / max) * 120));
      return '<div class="chart-col"><span class="chart-num">' + (x.total || '') + '</span>' +
        '<div class="chart-bar" style="height:' + height + 'px"></div>' +
        '<span class="chart-day">' + x.label + '</span></div>';
    }).join('');
  }

  function sumField(field) {
    var n = 0;
    Object.keys(stats().history).forEach(function (k) {
      n += stats().history[k][field] || 0;
    });
    return n;
  }

  function renderSettings() {
    var s = settings();
    $('set-autoplay').checked = !!s.autoplay;
    $('set-rate').value = String(s.rate);
    $('set-daily').value = s.dailyLimit;
    $('set-newperday').value = s.newPerDay;
    $('set-free').checked = !!s.free;
    $('set-auto-backup').checked = !!s.autoBackup;
    $('deck-manage-name').textContent = deck().name;
    $('btn-deck-delete').classList.toggle('hidden', Decks.getDecks().length <= 1);
    renderDeckSwitcher();
    renderBackupStatus();
  }

  function renderBackupStatus() {
    var b = globalBackup();
    if (!b) return;
    var status = b.getStatus();
    var text;
    if (status.serverPath) {
      text = 'Salvando automaticamente em: ' + status.serverPath +
        (status.audioCount ? ' • áudios: ' + status.audioCount : '') +
        (status.lastSaved ? ' • último salvamento: ' + status.lastSaved.toLocaleTimeString('pt-BR') : ' • salvando...');
    } else if (!status.supported) {
      text = 'Este navegador não permite escolher pastas. Os áudios ficam guardados no próprio navegador (' +
        (status.audioCount || 0) + ') e o botão "Baixar backup" gera um ZIP com JSON, arquivos do app e todos os áudios.';
    } else if (!status.folder) {
      text = 'Nenhuma pasta escolhida.';
    } else {
      text = 'Pasta: ' + status.folder + ' • áudios salvos: ' + (status.audioCount || 0) +
        (status.lastSaved ? ' • último salvamento: ' + status.lastSaved.toLocaleTimeString('pt-BR') : ' • salvando...');
    }
    $('backup-status').textContent = text;
    $('btn-backup-folder').classList.toggle('hidden', !status.supported || !!status.serverPath);
    $('btn-backup-change').classList.toggle('hidden', !status.serverPath && !status.folder);
    $('btn-backup-save').classList.toggle('hidden', !status.folder && !status.serverPath);
    $('btn-backup-restore').classList.toggle('hidden', !status.folder && !status.serverPath);
    $('btn-backup-download').classList.toggle('hidden', (status.supported && !!status.folder) || !!status.serverPath);
    $('backup-auto-row').classList.toggle('hidden', (!status.supported || !status.folder) && !status.serverPath);
  }

  function restoreBackup(text) {
    var data;
    try {
      data = globalBackup().parse(text);
    } catch (err) {
      toast(err.message);
      return;
    }
    if (!confirm('Restaurar ' + data.cards.length + ' cartões no deck "' + deck().name + '"? Isso substitui os cartões atuais.')) return;
    deck().cards = data.cards.map(Decks.normalizeCard);
    deck().stats = data.stats || { totalReviews: 0, history: {} };
    save();
    renderCards(); renderStats(); renderSettings(); renderDeckSwitcher();
    session = null; startSession(settings().free, true);
    syncAudios();
    if (globalBackup()) {
      globalBackup().countAudios(deck()).then(function () { renderBackupStatus(); });
      globalBackup().saveAudios(deck(), { onlyMissing: true }).then(function (n) {
        if (n) renderBackupStatus();
      }).catch(function () { /* sem internet: tenta de novo depois */ });
    }
    toast('Backup restaurado com sucesso!');
  }

  /* ------------------ Eventos ------------------ */

  function bindEvents() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { showScreen(this.getAttribute('data-screen')); });
    }

    $('deck-select').addEventListener('change', function (e) { switchDeck(e.target.value); });
    $('deck-new').onclick = function () { openDeckModal('new'); };
    $('deck-rename').onclick = function () { openDeckModal('rename'); };
    $('btn-deck-delete').onclick = deleteDeckModal;
    $('btn-deck-import').onclick = openImportDeckModal;

    $('btn-free').onclick = function () { startSession(true); toast('Modo livre ativado.'); };
    $('btn-end').onclick = function () { if (session) finishSession(true); };
    $('btn-empty-free').onclick = function () { startSession(true); toast('Modo livre ativado.'); };
    $('btn-empty-add').onclick = function () { showScreen('cards'); openCardModal(null); };
    $('btn-flip').onclick = function () { flip(); };

    var speakButtons = document.querySelectorAll('[data-speak]');
    for (var s = 0; s < speakButtons.length; s++) {
      speakButtons[s].addEventListener('click', speakCurrent);
    }

    var rateButtons = document.querySelectorAll('.rate');
    for (var r = 0; r < rateButtons.length; r++) {
      rateButtons[r].addEventListener('click', function () { rate(this.getAttribute('data-rating')); });
    }

    $('card-search').addEventListener('input', renderCards);
    $('btn-new').onclick = function () { openCardModal(null); };
    $('btn-import').onclick = openImportModal;
    $('btn-export').onclick = exportCards;

    $('cards-list').addEventListener('click', function (e) {
      var speakId = e.target.getAttribute('data-speak-card');
      if (speakId) {
        var card = getCard(speakId);
        if (card) TTS.speak(RichText.strip(card.front), { lang: 'en', rate: settings().rate });
        return;
      }
      var editId = e.target.getAttribute('data-edit');
      if (editId) { openCardModal(getCard(editId)); return; }
      var delId = e.target.getAttribute('data-del');
      if (delId) {
        var target = getCard(delId);
        if (!target) return;
        if (!confirm('Excluir o cartão:\n"' + RichText.strip(target.front) + '"?')) return;
        deck().cards = cards().filter(function (c) { return c.id !== delId; });
        save(); renderDeckSwitcher(); renderCards(); notifyCardsRemoved([delId]);
        toast('Cartão excluído.');
      }
    });

    $('set-autoplay').onchange = function (e) { settings().autoplay = e.target.checked; save(); };
    $('set-rate').onchange = function (e) { settings().rate = Number(e.target.value); save(); };
    $('set-daily').onchange = function (e) {
      settings().dailyLimit = Math.max(1, Math.min(500, Number(e.target.value) || 30));
      renderSettings(); save();
    };
    $('set-newperday').onchange = function (e) {
      settings().newPerDay = Math.max(0, Math.min(200, Number(e.target.value) || 0));
      renderSettings(); save();
    };
    $('set-free').onchange = function (e) { settings().free = e.target.checked; save(); };
    $('set-auto-backup').onchange = function (e) {
      settings().autoBackup = e.target.checked;
      save(); renderBackupStatus();
    };

    $('btn-backup-folder').onclick = function () {
      var b = globalBackup();
      if (!b) return;
      b.chooseFolder(function () {
        return { cards: deck().cards, settings: settings(), stats: deck().stats };
      }).then(function (name) {
        deck().folderName = name;
        save();
        renderBackupStatus();
        toast('Pasta "' + name + '" escolhida para o deck "' + deck().name + '".');
      }).catch(function (err) {
        toast('Não foi possível usar a pasta: ' + err.message);
      });
    };
    $('btn-backup-change').onclick = function () {
      var b = globalBackup();
      if (!b) return;
      var status = b.getStatus();
      var current = status.serverPath || status.folder || '';
      openModal(
        '<h2>Mudar pasta de backup</h2>' +
        '<p class="help">Tudo que está na pasta atual (JSON, arquivos do app e áudios) será copiado para a nova pasta. A antiga não é apagada.</p>' +
        (status.serverPath
          ? '<div class="field"><label for="new-folder-path">Nova pasta (caminho completo)</label>' +
            '<input id="new-folder-path" class="input" value="' + esc(current) + '" /></div>' +
            '<p class="help">A pasta precisa existir. Dica: crie-a no HD antes de confirmar.</p>'
          : '<p class="help">Na próxima etapa, escolha a nova pasta no seletor do navegador.</p>') +
        '<div class="modal-actions">' +
          '<button id="new-folder-cancel" class="btn btn-ghost">Cancelar</button>' +
          '<button id="new-folder-go" class="btn btn-primary">Mudar pasta</button>' +
        '</div>'
      );
      $('new-folder-cancel').onclick = closeModal;
      $('new-folder-go').onclick = function () {
        var promise;
        if (status.serverPath) {
          var to = $('new-folder-path').value.trim();
          promise = b.moveServerFolder(status.serverPath, to);
        } else {
          promise = b.moveBrowserFolder(function () {
            return { cards: deck().cards, settings: settings(), stats: deck().stats };
          });
        }
        promise.then(function (result) {
          closeModal();
          renderBackupStatus();
          var s = b.getStatus().serverPath;
          if (s && settings().autoBackup) {
            b.saveToServer({ cards: deck().cards, settings: settings(), stats: deck().stats })
              .then(function () { renderBackupStatus(); }).catch(function () { /* tenta depois */ });
          }
          toast('Pasta alterada! ' + (result.copiedFiles || 0) + ' arquivo(s) copiado(s).');
        }).catch(function (err) {
          toast('Não foi possível mudar a pasta: ' + err.message);
        });
      };
    };

    $('btn-backup-save').onclick = function () {
      var b = globalBackup();
      if (!b) return;
      if (b.getStatus().serverPath) {
        b.saveToServer({ cards: deck().cards, settings: settings(), stats: deck().stats })
          .then(function () { renderBackupStatus(); toast('Backup salvo em ' + b.getStatus().serverPath); })
          .catch(function (err) { toast('Falha ao salvar: ' + err.message); });
        return;
      }
      b.saveNow(deck(), true).then(function () {
        deck().lastBackup = new Date().toISOString();
        save(); renderBackupStatus();
        toast('Backup do deck salvo na pasta escolhida.');
      }).catch(function (err) {
        toast('Falha ao salvar: ' + err.message);
      });
    };
    $('btn-backup-restore').onclick = function () {
      var b = globalBackup();
      if (!b) return;
      b.readFromFolder().then(restoreBackup).catch(function (err) {
        toast('Não foi possível ler o backup: ' + err.message);
        $('backup-file').click();
      });
    };
    $('backup-file').onchange = function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) file.text().then(restoreBackup);
      e.target.value = '';
    };
    $('btn-backup-download').onclick = exportCards;

    $('btn-test-voice').onclick = function () {
      TTS.speak('Hello! This is the voice of American English.', {
        lang: 'en', rate: settings().rate
      }).then(function (result) {
        toast(result.ok
          ? 'Voz reproduzida (' + (result.via === 'local' ? 'arquivo salvo' :
              (result.via === 'google' || result.via === 'proxy' ? 'Google Tradutor' : 'navegador')) + ').'
          : 'Não foi possível reproduzir a voz.');
      });
    };

    $('btn-reset').onclick = function () {
      if (!confirm('Isso apaga TODOS os cartões e estatísticas do deck "' + deck().name + '". Continuar?')) return;
      deck().cards = SEED_DECK.map(function (item) {
        return SRS.newCard(uid(), item.front, item.back, item.notes || '');
      });
      deck().stats = { totalReviews: 0, history: {} };
      save(); renderDeckSwitcher(); renderCards(); renderStats();
      session = null; startSession(settings().free, true);
      toast('Deck restaurado às frases iniciais.');
    };

    document.addEventListener('keydown', function (e) {
      if ($('modal-root').firstChild) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (currentScreen !== 'study') return;

      var key = e.key;
      if (key === 'r' || key === 'R') { speakCurrent(); return; }
      if (!session || !session.queue.length) return;
      var flipped = $('flashcard').classList.contains('flipped');

      if (key === ' ' || key === 'Enter') {
        // Com o foco num botão, o navegador já gera o clique; ignorar evita duplo disparo.
        if (tag === 'button') return;
        e.preventDefault();
        if (flipped) rate('good'); else flip();
        return;
      }
      if (flipped && ['1', '2', '3', '4'].indexOf(key) >= 0) {
        rate({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }[key]);
      }
    });
  }

  /* ------------------ Init ------------------ */

  Decks.load();
  bindEvents();
  renderDeckSwitcher();
  renderSettings();
  renderCards();
  renderStats();
  startSession(settings().free);
  if (globalBackup()) {
    globalBackup().init().then(function () {
      return globalBackup().countAudios(deck());
    }).then(function () {
      renderBackupStatus();
      syncAudios();
    });
  }
})();
