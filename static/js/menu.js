(function (root) {
  'use strict';

  var HOLD_CLASS = 'ftsk-menu-closed';
  var GUARD_KEY = 'ftsk-menu-guard';
  var HOLD_MS = 3000;
  var GUARD_MS = 5000;

  // Where a menu link leads relative to the page being viewed.
  function classify(href, here) {
    var target;
    try { target = new URL(href, here.href); } catch (error) { return 'external'; }
    if (target.origin !== here.origin) return 'external';
    var trim = function (path) { return path.replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1'); };
    if (trim(target.pathname) !== trim(here.pathname) || target.search !== here.search) return 'other-page';
    return target.hash && target.hash !== '#' ? 'anchor' : 'same-page';
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { classify: classify };
  if (!root.document) return;

  var doc = root.document;
  var bar = doc.getElementById('mainnavigationBar');
  if (!bar) return;
  var panel = doc.getElementById('navbarSupportedContent');
  var compact = root.matchMedia('(max-width: 1199.98px)');
  var items = Array.prototype.slice.call(bar.querySelectorAll('.nav-item.dropdown'));

  // A dropdown that opens on hover keeps opening while the pointer rests on it, so
  // after a choice it is held shut until the pointer leaves (or briefly after a reload).
  function hold(item, limited) {
    if (!item || compact.matches) return;
    item.classList.add(HOLD_CLASS);
    var release = function () {
      item.classList.remove(HOLD_CLASS);
      item.removeEventListener('mouseleave', release);
      root.clearTimeout(timer);
    };
    var timer = limited ? root.setTimeout(release, HOLD_MS) : 0;
    item.addEventListener('mouseleave', release);
  }

  function closeSubmenus() {
    items.forEach(function (item) {
      item.classList.remove('show');
      var menu = item.querySelector('.dropdown-menu');
      var link = item.querySelector('.dropdown-link');
      if (menu) menu.classList.remove('show');
      if (link) link.setAttribute('aria-expanded', 'false');
    });
  }

  function closeMenus() {
    closeSubmenus();
    if (compact.matches && panel && panel.classList.contains('show')) {
      var Collapse = root.bootstrap && root.bootstrap.Collapse;
      if (Collapse) (Collapse.getInstance(panel) || new Collapse(panel, { toggle: false })).hide();
      else panel.classList.remove('show');
    }
  }

  function remember(item) {
    try { root.sessionStorage.setItem(GUARD_KEY, JSON.stringify({ index: items.indexOf(item), time: Date.now() })); }
    catch (error) { /* Private browsing: the menu then simply behaves like any hover menu. */ }
  }

  bar.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link || !bar.contains(link)) return;
    var item = link.closest('.nav-item.dropdown');

    // On the collapsed layout, a dropdown title only opens or closes its submenu.
    if (compact.matches && link.classList.contains('dropdown-link')) {
      event.preventDefault();
      var opening = !item.classList.contains('show');
      closeSubmenus();
      if (opening) {
        item.classList.add('show');
        item.querySelector('.dropdown-menu').classList.add('show');
        link.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    var kind = classify(link.href, root.location);
    var plain = !event.defaultPrevented && event.button === 0 && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) &&
      (!link.target || link.target === '_self');
    if (kind === 'same-page' && plain) {
      event.preventDefault();
      root.scrollTo({ top: 0, behavior: 'smooth' });
    }
    closeMenus();
    if (item && item.matches(':hover')) hold(item, false);
    if (kind === 'other-page' && plain && item) remember(item);
  });

  doc.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = items.filter(function (item) { return item.classList.contains('show') || item.matches(':hover') || item.contains(doc.activeElement); });
    closeMenus();
    open.forEach(function (item) { hold(item, true); });
    if (open.length && open[0].contains(doc.activeElement)) doc.activeElement.blur();
  });

  try {
    var guard = JSON.parse(root.sessionStorage.getItem(GUARD_KEY) || 'null');
    root.sessionStorage.removeItem(GUARD_KEY);
    if (guard && Date.now() - guard.time < GUARD_MS && items[guard.index]) hold(items[guard.index], true);
  } catch (error) { /* No stored navigation state. */ }
}(typeof window !== 'undefined' ? window : globalThis));
