/*
 * Repetição espaçada — variante simplificada do SM-2 (algoritmo usado pelo Anki).
 * Mantido sem dependências e exportável em Node para poder testar a lógica.
 */
(function (global) {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var MINUTE = 60 * 1000;
  var MIN_EF = 1.3;
  var MAX_EF = 3.0;

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function newCard(id, front, back, notes) {
    var now = Date.now();
    return {
      id: id,
      front: front,
      back: back,
      notes: notes || '',
      reps: 0,
      interval: 0,       // dias
      ef: 2.5,           // fator de facilidade
      due: now,          // cartão novo já está disponível
      lapses: 0,
      created: now,
      lastReviewed: null
    };
  }

  /*
   * Avalia o cartão. Retorna { card, requeue }.
   * ratings: 'again' | 'hard' | 'good' | 'easy'
   */
  function schedule(card, rating, now) {
    now = now || Date.now();
    var c = Object.assign({}, card);
    c.lastReviewed = now;
    var requeue = false;

    switch (rating) {
      case 'again':
        // Esqueceu: volta para a fila da sessão e reaparece em ~1 minuto.
        c.lapses += 1;
        c.reps = 0;
        c.interval = 0;
        c.ef = clamp(c.ef - 0.20, MIN_EF, 2.5);
        c.due = now + MINUTE;
        requeue = true;
        break;

      case 'hard':
        // Lembrou com esforço: avança pouco, mas ainda conta como revisão.
        c.interval = Math.max(1, Math.round((c.interval > 0 ? c.interval : 1) * 1.2));
        c.ef = clamp(c.ef - 0.15, MIN_EF, 2.5);
        c.reps += 1;
        c.due = now + c.interval * DAY;
        break;

      case 'good':
        // Sequência clássica 1 dia -> 6 dias -> intervalo * ef.
        if (c.reps === 0) c.interval = 1;
        else if (c.reps === 1) c.interval = 6;
        else c.interval = Math.max(1, Math.round(c.interval * c.ef));
        c.reps += 1;
        c.due = now + c.interval * DAY;
        break;

      case 'easy':
        // Salto maior para quem já domina o cartão: sempre maior que "good".
        if (c.reps === 0) c.interval = 4;
        else if (c.reps === 1) c.interval = Math.round(6 * 1.3);
        else c.interval = Math.max(1, Math.round(c.interval * c.ef * 1.3));
        c.ef = clamp(c.ef + 0.15, MIN_EF, MAX_EF);
        c.reps += 1;
        c.due = now + c.interval * DAY;
        break;

      default:
        throw new Error('Avaliação inválida: ' + rating);
    }

    return { card: c, requeue: requeue };
  }

  function formatInterval(card, rating, now) {
    if (rating === 'again') return '1 min';
    // Completa campos ausentes para evitar NaN com cartões de versões antigas.
    var full = Object.assign(newCard('preview', '', ''), card);
    if (typeof full.reps !== 'number') full.reps = 0;
    if (typeof full.interval !== 'number') full.interval = 0;
    if (typeof full.ef !== 'number') full.ef = 2.5;
    var days = schedule(full, rating, now || Date.now()).card.interval;
    if (days <= 1) return '1 dia';
    if (days < 30) return days + ' dias';
    var months = Math.round(days / 30);
    return months <= 1 ? '1 mês' : months + ' meses';
  }

  var api = {
    DAY: DAY,
    MINUTE: MINUTE,
    newCard: newCard,
    schedule: schedule,
    formatInterval: formatInterval
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SRS = api;
})(typeof window !== 'undefined' ? window : globalThis);
