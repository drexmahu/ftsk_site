/*
 * Media pages (layouts/media/*): scrolling photo reels, the full-screen viewer for photos
 * and videos, and the in-place video showcase. Items come from the JSON payload that
 * layouts/media/single.html writes into #ftsk-media-data; every thumbnail is also a
 * normal link, so the page still works (and can be opened in a new tab) without this
 * script. Videos load only after a click: YouTube through youtube-nocookie.com, direct
 * files through a <video> element.
 */
(function (root) {
  'use strict';

  /* ---------- pure helpers (unit tested in tests/js/test_site_media.js) ---------- */

  function youtubeId(text) {
    var value = String(text || '').trim();
    var match = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/i.exec(value);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';
  }

  // What the reel's arrows and progress line should show for a scroll position.
  function reelState(scrollLeft, clientWidth, scrollWidth) {
    var max = Math.max(0, scrollWidth - clientWidth);
    var scrollable = max > 2;
    var size = scrollable ? Math.max(8, Math.min(100, (clientWidth / scrollWidth) * 100)) : 100;
    var progress = scrollable ? Math.max(0, Math.min(1, scrollLeft / max)) : 0;
    return {
      scrollable: scrollable,
      hasPrev: scrollable && scrollLeft > 2,
      hasNext: scrollable && scrollLeft < max - 2,
      size: Math.round(size * 100) / 100,
      pos: Math.round((100 - size) * progress * 100) / 100
    };
  }

  // -1 (previous), 1 (next) or 0 for a horizontal swipe; vertical drags are ignored.
  function swipeDirection(dx, dy, elapsed) {
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5 || elapsed > 900) return 0;
    return dx < 0 ? 1 : -1;
  }

  function idFromHash(hash, known) {
    var id = String(hash || '').replace(/^#/, '');
    try { id = decodeURIComponent(id); } catch (error) { return ''; }
    return known && Object.prototype.hasOwnProperty.call(known, id) ? id : '';
  }

  function counter(index, total) { return (index + 1) + ' / ' + total; }

  function creditLine(item) {
    return item && item.credit ? (item.label || 'Fotó') + ': ' + item.credit : '';
  }

  function embedUrl(item, autoplay) {
    var base = item.embed + '?rel=0&modestbranding=1&playsinline=1';
    return autoplay ? base + '&autoplay=1' : base;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { youtubeId: youtubeId, reelState: reelState, swipeDirection: swipeDirection,
      idFromHash: idFromHash, counter: counter, creditLine: creditLine, embedUrl: embedUrl };
  }
  if (!root.document) return;

  /* ---------- page behaviour ---------- */

  var doc = root.document;
  var html = doc.documentElement;
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function make(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function frame(callback) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      root.requestAnimationFrame(function () { queued = false; callback(); });
    };
  }

  /* A video, built only when asked for (autoplay needs the user's click). */
  function videoPlayer(item, autoplay) {
    if (item.provider === 'youtube') {
      var iframe = make('iframe');
      iframe.src = embedUrl(item, autoplay);
      iframe.title = item.title || item.alt || 'Videó';
      iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      return iframe;
    }
    var video = make('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (item.poster) video.poster = item.poster;
    var source = make('source');
    source.src = item.src;
    source.type = item.mime || 'video/mp4';
    video.appendChild(source);
    video.setAttribute('aria-label', item.title || item.alt || 'Videó');
    if (autoplay) {
      var started = video.play && video.play();
      if (started && started.catch) started.catch(function () { /* the controls remain for a manual start */ });
    }
    return video;
  }

  function posterButton(item, onPlay) {
    var wrap = make('div', 'ftsk-viewer-video');
    wrap.style.setProperty('--ratio', String(item.ratio || 1.7778));
    if (item.thumb) {
      var image = make('img');
      image.src = item.thumb;
      image.alt = '';
      if (item.provider === 'youtube') image.referrerPolicy = 'no-referrer';
      wrap.appendChild(image);
    }
    var button = make('button', 'ftsk-viewer-playbutton');
    button.type = 'button';
    button.setAttribute('aria-label', (item.title || 'Videó') + ' – lejátszás');
    button.innerHTML = '<span class="ftsk-media-play ftsk-media-play--large" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" focusable="false"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg></span>';
    button.addEventListener('click', onPlay);
    wrap.appendChild(button);
    return wrap;
  }

  /* ---------- reels ---------- */

  function initReel(reel) {
    var track = reel.querySelector('[data-reel-track]');
    var prev = reel.querySelector('[data-reel-prev]');
    var next = reel.querySelector('[data-reel-next]');
    var bar = reel.querySelector('[data-reel-progress]');
    if (!track) return;

    var update = frame(function () {
      var state = reelState(track.scrollLeft, track.clientWidth, track.scrollWidth);
      prev.disabled = !state.hasPrev;
      next.disabled = !state.hasNext;
      reel.classList.toggle('has-prev', state.hasPrev);
      reel.classList.toggle('has-next', state.hasNext);
      bar.style.setProperty('--p-size', state.size + '%');
      bar.style.setProperty('--p-pos', state.pos + '%');
      bar.parentNode.classList.toggle('is-static', !state.scrollable);
    });
    track.addEventListener('scroll', update, { passive: true });
    root.addEventListener('resize', update);
    if (root.ResizeObserver) new root.ResizeObserver(update).observe(track);
    update();

    function page(direction) {
      track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
    }
    prev.addEventListener('click', function () { page(-1); });
    next.addEventListener('click', function () { page(1); });
    track.addEventListener('keydown', function (event) {
      if (event.target !== track) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); page(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); page(-1); }
    });

    // Mouse drag-to-scroll. Touch and trackpads already scroll natively.
    var drag = null;
    track.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { x: event.clientX, left: track.scrollLeft, moved: false, id: event.pointerId };
    });
    track.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) {
        drag.moved = true;
        track.classList.add('is-dragging');
        try { track.setPointerCapture(event.pointerId); } catch (error) { /* capture is optional */ }
      }
      if (drag.moved) track.scrollLeft = drag.left - dx;
    });
    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      var moved = drag.moved;
      drag = null;
      track.classList.remove('is-dragging');
      if (moved) {
        var swallow = function (click) { click.preventDefault(); click.stopPropagation(); };
        track.addEventListener('click', swallow, { capture: true, once: true });
        root.setTimeout(function () { track.removeEventListener('click', swallow, true); }, 0);
      }
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('dragstart', function (event) { event.preventDefault(); });
  }

  /* ---------- video showcase ---------- */

  function initShowcase(box, byId, openViewer) {
    var player = box.querySelector('[data-showcase-player]');
    var info = box.querySelector('[data-showcase-info]');
    var links = [].slice.call(box.querySelectorAll('[data-showcase-item]'));
    var current = links[0] ? byId[links[0].getAttribute('data-media-id')] : null;

    function showInfo(item) {
      info.textContent = '';
      if (item.title) info.appendChild(make('h3', '', item.title));
      if (item.credit) info.appendChild(make('p', 'ftsk-media-credit', creditLine(item)));
      if (item.text) {
        var text = make('div', 'ftsk-media-text');
        text.innerHTML = item.text;
        info.appendChild(text);
      }
    }

    function poster(item) {
      player.textContent = '';
      player.style.setProperty('--ratio', String(item.ratio || 1.7778));
      var link = make('a', 'ftsk-showcase-open');
      link.href = item.watch || item.src;
      link.setAttribute('data-media-id', item.id);
      link.setAttribute('data-showcase-open', '');
      link.setAttribute('aria-label', (item.title || item.alt || '') + (item.type === 'video' ? ' – lejátszás' : ' – nagyobb nézet'));
      if (item.thumb) {
        var image = make('img');
        image.src = item.thumb;
        image.alt = '';
        if (item.provider === 'youtube') image.referrerPolicy = 'no-referrer';
        link.appendChild(image);
      }
      if (item.type === 'video') {
        var badge = make('span', 'ftsk-media-play ftsk-media-play--large');
        badge.setAttribute('aria-hidden', 'true');
        badge.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" focusable="false"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg>';
        link.appendChild(badge);
      }
      player.appendChild(link);
    }

    function select(item) {
      current = item;
      links.forEach(function (link) {
        var active = link.getAttribute('data-media-id') === item.id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
      });
      poster(item);
      showInfo(item);
    }

    box.addEventListener('click', function (event) {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var listed = event.target.closest('[data-showcase-item]');
      if (listed) {
        event.preventDefault();
        select(byId[listed.getAttribute('data-media-id')]);
        return;
      }
      var open = event.target.closest('[data-showcase-open]');
      if (!open || !current) return;
      event.preventDefault();
      if (current.type === 'video') {
        player.textContent = '';
        var element = videoPlayer(current, true);
        player.appendChild(element);
        element.focus && element.focus();
      } else openViewer(current.id, open);
    });

    var hashed = idFromHash(root.location.hash, byId);
    if (hashed && links.some(function (link) { return link.getAttribute('data-media-id') === hashed; })) select(byId[hashed]);
  }

  /* ---------- full-screen viewer ---------- */

  function initViewer(viewer, bySection, byId) {
    var stage = viewer.querySelector('[data-viewer-stage]');
    var countNode = viewer.querySelector('[data-viewer-count]');
    var sectionNode = viewer.querySelector('[data-viewer-section]');
    var titleNode = viewer.querySelector('[data-viewer-title]');
    var creditNode = viewer.querySelector('[data-viewer-credit]');
    var textNode = viewer.querySelector('[data-viewer-text]');
    var prev = viewer.querySelector('[data-viewer-prev]');
    var next = viewer.querySelector('[data-viewer-next]');
    var close = viewer.querySelector('[data-viewer-close]');
    var state = null;             // { list, index, trigger }
    var inerted = [];

    function preload(item) {
      if (!item || item.type !== 'photo') return;
      var image = new root.Image();
      image.src = item.src;
    }

    function render(direction, autoplay) {
      var list = state.list;
      var item = list[state.index];
      viewer.classList.toggle('is-forward', direction > 0);
      viewer.classList.toggle('is-backward', direction < 0);
      countNode.textContent = counter(state.index, list.length);
      sectionNode.textContent = item.sectionTitle || '';
      titleNode.textContent = item.title || '';
      creditNode.textContent = creditLine(item);
      textNode.innerHTML = item.text || '';
      prev.disabled = state.index === 0;
      next.disabled = state.index === list.length - 1;
      prev.hidden = next.hidden = list.length < 2;

      stage.textContent = '';
      if (item.type === 'video') {
        var mount = function (play) {
          stage.textContent = '';
          var box = make('div', 'ftsk-viewer-video');
          box.style.setProperty('--ratio', String(item.ratio || 1.7778));
          box.appendChild(videoPlayer(item, play));
          stage.appendChild(box);
        };
        if (autoplay) mount(true);
        else stage.appendChild(posterButton(item, function () { mount(true); }));
      } else {
        var image = make('img');
        image.alt = item.alt || item.title || '';
        image.draggable = false;
        // Show the already-loaded thumbnail at once, then swap in the full-size photo.
        image.src = item.thumb || item.src;
        stage.appendChild(image);
        if (item.thumb && item.thumb !== item.src) {
          var full = new root.Image();
          full.onload = function () { if (image.parentNode === stage) image.src = item.src; };
          full.src = item.src;
        }
      }
      preload(list[state.index + 1]);
      preload(list[state.index - 1]);
      try { root.history.replaceState(root.history.state, '', '#' + item.id); } catch (error) { /* file:// previews */ }
    }

    function go(step) {
      if (!state) return;
      var target = state.index + step;
      if (target < 0 || target >= state.list.length) return;
      state.index = target;
      render(step, true);
    }

    function setInert(on) {
      if (on) {
        inerted = [].slice.call(doc.body.children).filter(function (node) {
          return node !== viewer && node.nodeName !== 'SCRIPT' && !node.hasAttribute('inert');
        });
        inerted.forEach(function (node) { node.setAttribute('inert', ''); });
      } else {
        inerted.forEach(function (node) { node.removeAttribute('inert'); });
        inerted = [];
      }
    }

    function open(id, trigger, options) {
      var item = byId[id];
      if (!item) return;
      var list = bySection[item.section];
      state = { list: list, index: list.indexOf(item), trigger: trigger || null, pushed: false };
      viewer.hidden = false;
      html.classList.add('ftsk-viewer-open');
      setInert(true);
      // The history entry comes first, so render()'s hash update lands on it and the page's own entry stays clean.
      if (!(options && options.deepLink)) {
        try { root.history.pushState({ ftskViewer: true }, '', '#' + id); state.pushed = true; } catch (error) { /* ignore */ }
      }
      render(0, !(options && options.deepLink));
      root.requestAnimationFrame(function () { viewer.classList.add('is-open'); });
      close.focus();
    }

    function finish() {
      if (!state) return;
      var item = state.list[state.index];
      var trigger = state.trigger;
      state = null;
      stage.textContent = '';
      [sectionNode, titleNode, creditNode, textNode, countNode].forEach(function (node) { node.textContent = ''; });
      viewer.classList.remove('is-open');
      viewer.hidden = true;
      html.classList.remove('ftsk-viewer-open');
      setInert(false);
      // Bring the reel back to the photo that was last on screen and focus its card.
      var card = doc.querySelector('[data-media-id="' + item.id + '"]');
      var target = card || trigger;
      if (target) {
        try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); }
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
      }
    }

    function dismiss() {
      if (!state) return;
      if (state.pushed && root.history.state && root.history.state.ftskViewer) {
        root.history.back();        // popstate finishes the job, so Back and × behave alike
      } else {
        finish();
        try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (error) { /* ignore */ }
      }
    }

    root.addEventListener('popstate', function () {
      if (state && !(root.history.state && root.history.state.ftskViewer)) finish();
    });

    close.addEventListener('click', dismiss);
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    // A click on the dark backdrop (not the media or text) closes, as people expect.
    viewer.addEventListener('click', function (event) {
      if (event.target === viewer || event.target === stage || event.target.classList.contains('ftsk-viewer-main')) dismiss();
    });

    doc.addEventListener('keydown', function (event) {
      if (!state) return;
      var typing = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.nodeName);
      var onVideo = event.target && event.target.nodeName === 'VIDEO';
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      else if (!typing && !onVideo && event.key === 'ArrowRight') { event.preventDefault(); go(1); }
      else if (!typing && !onVideo && event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
      else if (!typing && !onVideo && event.key === 'Home') { event.preventDefault(); go(-state.index); }
      else if (!typing && !onVideo && event.key === 'End') { event.preventDefault(); go(state.list.length - 1 - state.index); }
      else if (event.key === 'Tab') {
        var focusable = [].slice.call(viewer.querySelectorAll('button:not([disabled]):not([hidden]), iframe, video[controls], a[href], [tabindex="0"]'))
          .filter(function (node) { return node.offsetParent !== null || node === doc.activeElement; });
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !viewer.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !viewer.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });

    // Swipe between photos on touch screens.
    var touch = null;
    stage.addEventListener('touchstart', function (event) {
      var point = event.changedTouches[0];
      touch = event.touches.length === 1 && event.target.nodeName === 'IMG' ? { x: point.clientX, y: point.clientY, t: Date.now() } : null;
    }, { passive: true });
    stage.addEventListener('touchend', function (event) {
      if (!touch) return;
      var point = event.changedTouches[0];
      var step = swipeDirection(point.clientX - touch.x, point.clientY - touch.y, Date.now() - touch.t);
      touch = null;
      if (step) go(step);
    }, { passive: true });

    return { open: open, isOpen: function () { return Boolean(state); } };
  }

  /* ---------- start-up ---------- */

  function init() {
    var node = doc.getElementById('ftsk-media-data');
    var viewer = doc.getElementById('ftsk-viewer');
    if (!node || !viewer) return;
    var items;
    try { items = JSON.parse(node.textContent); } catch (error) { return; }
    var byId = {}, bySection = {};
    items.forEach(function (item) {
      byId[item.id] = item;
      (bySection[item.section] = bySection[item.section] || []).push(item);
    });

    [].forEach.call(doc.querySelectorAll('[data-media-reel]'), initReel);
    var controller = initViewer(viewer, bySection, byId);
    [].forEach.call(doc.querySelectorAll('[data-media-showcase]'), function (box) {
      initShowcase(box, byId, function (id, trigger) { controller.open(id, trigger); });
    });

    doc.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest && event.target.closest('a[data-media-id]');
      if (!link || link.hasAttribute('data-showcase-item') || link.hasAttribute('data-showcase-open')) return;
      if (!byId[link.getAttribute('data-media-id')]) return;
      event.preventDefault();
      controller.open(link.getAttribute('data-media-id'), link);
    });

    // A shared link such as /media/fotok/#gortani-expedicio-3 opens that photo directly.
    var hashed = idFromHash(root.location.hash, byId);
    if (hashed && !doc.querySelector('[data-showcase-item][data-media-id="' + hashed + '"]')) controller.open(hashed, null, { deepLink: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
}(typeof window !== 'undefined' ? window : globalThis));
