/*
 * Utilitários de texto formatado para os cartões.
 * O editor salva HTML simples (negrito, itálico, sublinhado, cor).
 * Tudo é sanitizado antes de ser salvo/exibido, e convertido em texto puro
 * para busca, voz (TTS) e mensagens.
 */
(function (global) {
  'use strict';

  var ALLOWED = {
    B: true, STRONG: true, I: true, EM: true, U: true, S: true,
    STRIKE: true, SPAN: true, BR: true, DIV: true, P: true,
    SUB: true, SUP: true, MARK: true
  };
  var BLOCK = { DIV: true, P: true, BR: true };

  function parse(html) {
    var doc = new DOMParser().parseFromString(
      '<div id="anki-root">' + (html == null ? '' : String(html)) + '</div>', 'text/html'
    );
    return doc.getElementById('anki-root');
  }

  function validColor(value) {
    if (!value) return null;
    var v = String(value).trim().toLowerCase();
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(v)) return v;
    if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v)) return v;
    var named = {
      black: '#000', white: '#fff', red: 'red', blue: 'blue', green: 'green',
      orange: 'orange', purple: 'purple', yellow: 'yellow', gray: 'gray',
      grey: 'gray', pink: 'pink', brown: 'brown', cyan: 'cyan', teal: 'teal'
    };
    return named[v] || null;
  }

  function clean(node) {
    var out = document.createDocumentFragment();
    Array.prototype.forEach.call(node.childNodes || [], function (child) {
      if (child.nodeType === 3) { // texto
        out.appendChild(document.createTextNode(child.nodeValue));
        return;
      }
      if (child.nodeType !== 1) return; // ignora comentários etc.

      var tag = child.tagName.toUpperCase();
      // Tags perigosas são descartadas por completo (inclusive o conteúdo).
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' ||
          tag === 'EMBED' || tag === 'SVG' || tag === 'LINK' || tag === 'META') {
        return;
      }
      var target;

      if (tag === 'FONT') { // execCommand(foreColor) gera <font> em alguns navegadores
        target = document.createElement('span');
        var c = validColor(child.getAttribute('color'));
        if (c) target.style.color = c;
      } else if (ALLOWED[tag]) {
        target = document.createElement(tag.toLowerCase());
      } else {
        // tag não permitida: mantém o conteúdo, descarta a tag
        out.appendChild(clean(child));
        if (BLOCK[tag]) out.appendChild(document.createTextNode(' '));
        return;
      }

      if (tag === 'SPAN' || tag === 'FONT') {
        var style = child.getAttribute('style') || '';
        var m = style.match(/color\s*:\s*([^;]+)/i);
        var color = validColor(m ? m[1] : null);
        if (!color) {
          var fontColor = validColor(child.getAttribute('color'));
          if (fontColor) color = fontColor;
        }
        if (color) target.style.color = color;
      }

      while (target.firstChild) target.removeChild(target.firstChild);
      target.appendChild(clean(child));
      out.appendChild(target);
      if (BLOCK[tag]) out.appendChild(document.createTextNode(' '));
    });
    return out;
  }

  function sanitize(html) {
    var holder = document.createElement('div');
    holder.appendChild(clean(parse(html)));
    return holder.innerHTML;
  }

  function strip(html) {
    var root = parse(html);
    function textOf(node) {
      var s = '';
      Array.prototype.forEach.call(node.childNodes || [], function (child) {
        if (child.nodeType === 3) { s += child.nodeValue; return; }
        if (child.nodeType !== 1) return;
        if (BLOCK[child.tagName.toUpperCase()]) s += ' ';
        s += textOf(child);
        if (BLOCK[child.tagName.toUpperCase()]) s += ' ';
      });
      return s;
    }
    return textOf(root).replace(/\s+/g, ' ').trim();
  }

  var api = { sanitize: sanitize, strip: strip, validColor: validColor };
  global.RichText = api;
})(typeof window !== 'undefined' ? window : globalThis);
