(function () {
  'use strict';

  var nextId = 0;

  function create(options) {
    var section = document.createElement('section');
    section.className = 'poi-selector';
    var header = document.createElement('div');
    header.className = 'poi-selector-header';
    var title = document.createElement('h2');
    title.textContent = 'Subject';
    header.appendChild(title);
    var feedback = document.createElement('span');
    feedback.className = 'poi-feedback';
    feedback.setAttribute('role', 'status');
    var lastResult = null;
    header.appendChild(feedback);

    function iconButton(icon, label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary poi-icon-button';
      button.title = label;
      button.setAttribute('aria-label', label);
      var symbol = document.createElement('i');
      symbol.className = 'ph ph-' + icon;
      symbol.setAttribute('aria-hidden', 'true');
      button.appendChild(symbol);
      return button;
    }

    var open = iconButton('crosshair', 'Select subject on full photo');
    var clear = iconButton('arrow-counter-clockwise', 'Reset point of interest to center');
    header.appendChild(open);
    header.appendChild(clear);
    var coordinates = document.createElement('div');
    coordinates.className = 'poi-coordinates';
    var inputs = {};
    ['x', 'y'].forEach(function (axis) {
      var label = document.createElement('label');
      label.textContent = 'Source ' + axis.toUpperCase() + '%';
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.step = '0.1';
      input.setAttribute('aria-label', 'Point of interest ' + axis.toUpperCase() + ' percent');
      input.addEventListener('change', function () {
        var poi = Object.assign({ x: 50, y: 50 }, options.get());
        var value = Number(input.value);
        poi[axis] = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
        options.set(poi);
        update();
      });
      inputs[axis] = input;
      label.appendChild(input);
      coordinates.appendChild(label);
    });

    var dialog = document.createElement('dialog');
    dialog.className = 'poi-dialog';
    var dialogHeader = document.createElement('div');
    dialogHeader.className = 'poi-dialog-header';
    var dialogTitle = document.createElement('h2');
    dialogTitle.id = 'poi-title-' + (++nextId);
    dialogTitle.textContent = 'Point of interest';
    dialog.setAttribute('aria-labelledby', dialogTitle.id);
    dialogHeader.appendChild(dialogTitle);
    var zoom = document.createElement('select');
    zoom.setAttribute('aria-label', 'Source photo zoom');
    [['fit', 'Fit photo'], ['1', '100%'], ['2', '200%']].forEach(function (pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      zoom.appendChild(option);
    });
    dialogHeader.appendChild(zoom);
    var close = iconButton('x', 'Close full photo');
    dialogHeader.appendChild(close);
    var viewport = document.createElement('div');
    viewport.className = 'poi-source-viewport';
    var canvas = document.createElement('div');
    canvas.className = 'poi-source-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', 'Select subject on original photo; arrow keys adjust the point');
    var source = document.createElement('img');
    source.src = options.src;
    source.alt = 'Original unmirrored photo';
    source.draggable = false;
    var marker = document.createElement('div');
    marker.className = 'poi-source-marker';
    marker.setAttribute('aria-hidden', 'true');
    canvas.appendChild(source);
    canvas.appendChild(marker);
    viewport.appendChild(canvas);
    dialog.appendChild(dialogHeader);
    dialog.appendChild(viewport);
    section.appendChild(header);
    section.appendChild(coordinates);
    section.appendChild(dialog);

    function fit() {
      if (!source.naturalWidth || !dialog.open) return;
      var scale = zoom.value === 'fit' ? Math.min(1, (viewport.clientWidth - 16) / source.naturalWidth, (viewport.clientHeight - 16) / source.naturalHeight) : Number(zoom.value);
      canvas.style.width = source.naturalWidth * scale + 'px';
      canvas.style.height = source.naturalHeight * scale + 'px';
    }

    function update(result) {
      if (arguments.length) lastResult = result;
      result = lastResult;
      var poi = options.get() || { x: 50, y: 50 };
      marker.style.left = poi.x + '%';
      marker.style.top = poi.y + '%';
      if (document.activeElement !== inputs.x) inputs.x.value = poi.x;
      if (document.activeElement !== inputs.y) inputs.y.value = poi.y;
      clear.disabled = poi.x === 50 && poi.y === 50;
      var status = !result ? 'Subject selected' : !result.poiVisible ? 'Subject outside this crop' : result.constrained ? 'Subject visible · edge-limited framing' : 'Subject visible';
      if (feedback.textContent !== status) feedback.textContent = status;
      feedback.classList.toggle('is-warning', !!result && (!result.poiVisible || result.constrained));
    }

    function choose(clientX, clientY) {
      var rectangle = source.getBoundingClientRect();
      if (!rectangle.width || !rectangle.height) return;
      options.set({
        x: Math.round(Math.max(0, Math.min(100, (clientX - rectangle.left) / rectangle.width * 100)) * 10) / 10,
        y: Math.round(Math.max(0, Math.min(100, (clientY - rectangle.top) / rectangle.height * 100)) * 10) / 10
      });
      update();
    }

    canvas.addEventListener('click', function (event) { choose(event.clientX, event.clientY); });
    canvas.addEventListener('keydown', function (event) {
      var directions = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', -1], ArrowDown: ['y', 1] };
      var direction = directions[event.key];
      if (!direction && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      var poi = Object.assign({ x: 50, y: 50 }, options.get());
      if (direction) poi[direction[0]] = Math.round(Math.max(0, Math.min(100, poi[direction[0]] + direction[1] * (event.shiftKey ? 5 : 0.5))) * 10) / 10;
      options.set(poi);
      update();
    });
    open.addEventListener('click', function () {
      dialog.showModal();
      fit();
      canvas.focus();
    });
    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dialog.close();
      }
    });
    clear.addEventListener('click', function () { options.set({ x: 50, y: 50 }); update(); });
    zoom.addEventListener('change', fit);
    source.addEventListener('load', fit);
    var observer = new ResizeObserver(fit);
    observer.observe(viewport);
    update();
    return { element: section, update: update, cleanup: function () { dialog.close(); observer.disconnect(); } };
  }

  function renderPreview(input) {
    var image = input.image;
    if (!image.naturalWidth) return null;
    var movement = window.FTSKHeroFraming.motion(input.settings, input.timeline);
    var result = window.FTSKHeroFraming.frame(Object.assign({}, input.settings, movement, {
      width: input.container.clientWidth,
      height: input.container.clientHeight,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      poi: input.poi || { x: 50, y: 50 }
    }));
    image.style.width = image.naturalWidth + 'px';
    image.style.height = image.naturalHeight + 'px';
    image.style.maxWidth = 'none';
    image.style.transformOrigin = '0 0';
    image.style.transform = result.transform;
    input.marker.style.left = result.poiX / input.container.clientWidth * 100 + '%';
    input.marker.style.top = result.poiY / input.container.clientHeight * 100 + '%';
    return result;
  }

  window.FTSKHeroPOI = { create: create, renderPreview: renderPreview };
}());