/*
 * Mantém o tema do webapp sincronizado com o Omarchy.
 *
 * O hook ~/.config/omarchy/hooks/theme-set.d/anki-webapp-theme-sync reescreve
 * theme.css e theme-meta.json a cada troca de tema. Aqui apenas trocamos a URL
 * da folha de estilo (com cache-bust) quando a geração muda, sem recarregar a
 * página — assim cartões e sessão de estudo não são perdidos.
 */
(function () {
  'use strict';

  var link = document.getElementById('app-theme');
  if (!link) return;

  var current = link.getAttribute('href') || 'theme.css';

  function apply(meta) {
    var generation = meta && meta.generation ? meta.generation : '1';
    var href = 'theme.css?v=' + encodeURIComponent(generation);
    if (href === current) return;
    current = href;
    link.setAttribute('href', href);
  }

  function check() {
    if (document.visibilityState === 'hidden') return;
    fetch('theme-meta.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (meta) { if (meta) apply(meta); })
      .catch(function () { /* servidor estático sem os arquivos: silêncio */ });
  }

  check();
  setInterval(check, 5000);
})();
