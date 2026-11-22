/*
 * Gerenciamento de decks.
 * O estado global fica em localStorage: { decks: [...], activeDeckId, settings }.
 * Cada deck guarda seus próprios cartões, estatísticas e pasta de backup.
 */
(function (global) {
  'use strict';

  var KEY = 'anki-ingles-v2';
  var LEGACY_KEY = 'anki-ingles-v1';
  var DB_NAME = 'anki-ingles-backup';

  var state = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newDeck(name) {
    return {
      id: uid(),
      name: name,
      cards: [],
      stats: { totalReviews: 0, history: {} },
      folderName: null,
      lastBackup: null,
      audioCount: 0,
      created: Date.now()
    };
  }

  function makeSeedCards() {
    return SEED_DECK.map(function (item) {
      return SRS.newCard(uid(), item.front, item.back, item.notes || '');
    });
  }

  function defaultSettings() {
    return { autoplay: true, rate: 1, dailyLimit: 30, newPerDay: 10, free: false, autoBackup: true };
  }

  function normalizeCard(c) {
    return {
      id: c.id || uid(),
      front: c.front,
      back: c.back,
      notes: c.notes || '',
      reps: typeof c.reps === 'number' ? c.reps : 0,
      interval: typeof c.interval === 'number' ? c.interval : 0,
      ef: typeof c.ef === 'number' ? c.ef : 2.5,
      due: typeof c.due === 'number' ? c.due : Date.now(),
      lapses: typeof c.lapses === 'number' ? c.lapses : 0,
      created: c.created || Date.now(),
      lastReviewed: c.lastReviewed || null
    };
  }

  function normalizeDeck(d) {
    d = d || {};
    var stats = d.stats || {};
    return {
      id: d.id || uid(),
      name: d.name || 'Meu deck',
      cards: (d.cards || []).filter(function (c) { return c && c.front && c.back; }).map(normalizeCard),
      stats: {
        totalReviews: stats.totalReviews || 0,
        history: stats.history || {}
      },
      folderName: d.folderName || null,
      lastBackup: d.lastBackup || null,
      audioCount: d.audioCount || 0,
      created: d.created || Date.now()
    };
  }

  function migrateLegacy() {
    var raw;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch (err) { return null; }
    if (!raw) return null;
    try {
      var old = JSON.parse(raw);
      if (!old || !Array.isArray(old.cards)) return null;
      var deck = newDeck('Meu deck');
      deck.cards = old.cards.map(normalizeCard);
      deck.stats = old.stats || deck.stats;
      return {
        decks: [deck],
        activeDeckId: deck.id,
        settings: Object.assign(defaultSettings(), old.settings || {})
      };
    } catch (err) {
      return null;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.decks) && parsed.decks.length) {
          state = {
            decks: parsed.decks.map(normalizeDeck),
            activeDeckId: parsed.activeDeckId,
            settings: Object.assign(defaultSettings(), parsed.settings || {})
          };
          if (!getActive()) state.activeDeckId = state.decks[0].id;
          return state;
        }
      }
    } catch (err) { /* continua para migração/estado novo */ }

    state = migrateLegacy();
    if (!state) {
      var deck = newDeck('Inglês básico');
      deck.cards = makeSeedCards();
      state = { decks: [deck], activeDeckId: deck.id, settings: defaultSettings() };
    }
    save();
    return state;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Não foi possível salvar os decks:', err);
    }
  }

  function getState() { return state; }

  function getDecks() { return state ? state.decks : []; }

  function getActive() {
    if (!state) return null;
    for (var i = 0; i < state.decks.length; i++) {
      if (state.decks[i].id === state.activeDeckId) return state.decks[i];
    }
    return null;
  }

  function setActive(id) {
    if (!getDeck(id)) return false;
    state.activeDeckId = id;
    save();
    return true;
  }

  function getDeck(id) {
    for (var i = 0; i < state.decks.length; i++) {
      if (state.decks[i].id === id) return state.decks[i];
    }
    return null;
  }

  function createDeck(name, withSeed) {
    var clean = String(name || '').trim();
    if (!clean) throw new Error('Informe um nome para o deck.');
    if (state.decks.some(function (d) { return d.name.toLowerCase() === clean.toLowerCase(); })) {
      throw new Error('Já existe um deck com esse nome.');
    }
    var deck = newDeck(clean);
    if (withSeed) deck.cards = makeSeedCards();
    state.decks.push(deck);
    state.activeDeckId = deck.id;
    save();
    return deck;
  }

  function renameDeck(id, name) {
    var clean = String(name || '').trim();
    if (!clean) throw new Error('Informe um nome para o deck.');
    if (state.decks.some(function (d) { return d.id !== id && d.name.toLowerCase() === clean.toLowerCase(); })) {
      throw new Error('Já existe um deck com esse nome.');
    }
    var deck = getDeck(id);
    if (!deck) throw new Error('Deck não encontrado.');
    deck.name = clean;
    save();
    return deck;
  }

  function deleteDeck(id) {
    if (state.decks.length <= 1) throw new Error('Não é possível excluir o único deck.');
    var deck = getDeck(id);
    if (!deck) throw new Error('Deck não encontrado.');
    state.decks = state.decks.filter(function (d) { return d.id !== id; });
    if (state.activeDeckId === id) state.activeDeckId = state.decks[0].id;
    save();
    return deck;
  }

  function importDeck(data, name) {
    var deck = newDeck(name);
    var cards = Array.isArray(data.cards) ? data.cards : data;
    if (!Array.isArray(cards)) throw new Error('Arquivo inválido.');
    deck.cards = cards.filter(function (c) { return c && c.front && c.back; }).map(normalizeCard);
    if (!deck.cards.length) throw new Error('Nenhum cartão válido no arquivo.');
    if (data.stats) deck.stats = { totalReviews: data.stats.totalReviews || 0, history: data.stats.history || {} };
    if (state.decks.some(function (d) { return d.name.toLowerCase() === deck.name.toLowerCase(); })) {
      deck.name = deck.name + ' (' + new Date().toLocaleDateString('pt-BR') + ')';
    }
    state.decks.push(deck);
    state.activeDeckId = deck.id;
    save();
    return deck;
  }

  var api = {
    KEY: KEY,
    uid: uid,
    load: load,
    save: save,
    getState: getState,
    getDecks: getDecks,
    getActive: getActive,
    getDeck: getDeck,
    setActive: setActive,
    createDeck: createDeck,
    renameDeck: renameDeck,
    deleteDeck: deleteDeck,
    importDeck: importDeck,
    newDeck: newDeck,
    defaultSettings: defaultSettings,
    normalizeCard: normalizeCard
  };
  global.Decks = api;
})(typeof window !== 'undefined' ? window : globalThis);
