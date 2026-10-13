(function () {
  'use strict';
  var section = document.querySelector('.error[data-pages-previews="true"]');
  var home = document.querySelector('[data-error-home]');
  if (!section || !home) return;
  var base = new URL(home.href, location.href);
  if (!location.pathname.startsWith(base.pathname)) return;
  var match = location.pathname.slice(base.pathname.length).match(/^pr-preview\/pr-\d+(?:\/|$)/);
  if (!match) return;
  var previewPath = base.pathname + match[0].replace(/\/$/, '') + '/';
  if (previewPath === base.pathname || !previewPath.startsWith(base.pathname)) return;
  window.FTSK404Ready = fetch(previewPath + 'pr-preview-head.txt', { method: 'HEAD', cache: 'no-store' }).then(function (response) {
    if (!response.ok) return;
    document.querySelectorAll('a[href], [data-search-index]').forEach(function (element) {
      ['href', 'data-search-index'].forEach(function (attribute) {
        var value = element.getAttribute(attribute);
        if (!value || value.startsWith('#')) return;
        var target = new URL(value, location.href);
        if (target.origin !== location.origin || !target.pathname.startsWith(base.pathname) || target.pathname.startsWith(previewPath)) return;
        target.pathname = previewPath + target.pathname.slice(base.pathname.length);
        element.setAttribute(attribute, target.pathname + target.search + target.hash);
      });
    });
  }).catch(function () {});
  return window.FTSK404Ready;
}());