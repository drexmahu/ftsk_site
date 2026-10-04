(function (root, factory) {
   if (typeof module === 'object' && module.exports) {
      module.exports = factory();
   } else {
      root.FTSKHeroFraming = factory();
   }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
   'use strict';

   function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
   }

   function number(value, fallback) {
      if (value === null || value === undefined || value === '') return fallback;
      var parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
   }

   function focus(value) {
      var parts = String(value || '50% 50%').split(/\s+/);
      return { x: clamp(parseFloat(parts[0]) || 0, 0, 100), y: clamp(parseFloat(parts[1]) || 0, 0, 100) };
   }

   function settings(slide, tier) {
      var start = slide.start || {};
      var animation = slide.animation || {};
      var override = slide[tier] || {};
      var composition = focus(override.focus === undefined ? start.focus : override.focus);
      var type = override.type || animation.type || 'pan';
      var defaultAmount = type === 'pan' ? 6 : type === 'tilt' ? 2 : type === 'none' ? 0 : 0.15;
      return {
         zoom: number(override.zoom === undefined ? start.zoom : override.zoom, 1.35),
         focusX: composition.x,
         focusY: composition.y,
         type: type,
         direction: override.direction || animation.direction || 'right',
         amount: number(override.amount === undefined ? animation.amount : override.amount, defaultAmount),
         duration: Math.max(0.1, number(override.duration === undefined ? animation.duration : override.duration, 12)),
         mirrorX: slide.mirror === 'horizontal' || slide.mirror === 'both' ? -1 : 1,
         mirrorY: slide.mirror === 'vertical' || slide.mirror === 'both' ? -1 : 1
      };
   }

   function motion(config, progress) {
      var phase = clamp(number(progress, 0), 0, 1);
      phase = 0.5 - 0.5 * Math.cos(Math.PI * phase);
      var sweep = phase * 2 - 1;
      var zoom = Math.max(1, number(config.zoom, 1.35));
      var amount = Math.max(0, number(config.amount, 6));
      var panX = 0;
      var panY = 0;
      var rotation = 0;
      if (config.type === 'zoom-in') zoom += amount * phase;
      if (config.type === 'zoom-out') zoom = Math.max(1, zoom - amount * phase);
      if (config.type === 'pan') {
         var sign = config.direction === 'left' || config.direction === 'up' ? -1 : 1;
         if (config.direction === 'up' || config.direction === 'down') panY = sweep * amount * sign;
         else panX = sweep * amount * sign;
      }
      if (config.type === 'tilt') rotation = sweep * amount * (config.direction === 'left' ? -1 : 1);
      return { zoom: zoom, panX: panX, panY: panY, rotation: rotation };
   }

   function clip(polygon, axis, bound, keepGreater) {
      var result = [];
      polygon.forEach(function (current, index) {
         var previous = polygon[(index + polygon.length - 1) % polygon.length];
         var currentInside = keepGreater ? current[axis] >= bound : current[axis] <= bound;
         var previousInside = keepGreater ? previous[axis] >= bound : previous[axis] <= bound;
         if (currentInside !== previousInside) {
            var ratio = (bound - previous[axis]) / (current[axis] - previous[axis]);
            result.push({ x: previous.x + ratio * (current.x - previous.x), y: previous.y + ratio * (current.y - previous.y) });
         }
         if (currentInside) result.push(current);
      });
      return result;
   }

   function nearest(polygon, desired) {
      var inside = polygon.length >= 3;
      var closest = polygon[0];
      var bestDistance = Infinity;
      polygon.forEach(function (start, index) {
         var end = polygon[(index + 1) % polygon.length];
         var deltaX = end.x - start.x;
         var deltaY = end.y - start.y;
         var length = deltaX * deltaX + deltaY * deltaY;
         if (length && (deltaX * (desired.y - start.y) - deltaY * (desired.x - start.x)) / Math.sqrt(length) < -0.0000001) inside = false;
         var ratio = length ? clamp(((desired.x - start.x) * deltaX + (desired.y - start.y) * deltaY) / length, 0, 1) : 0;
         var point = { x: start.x + deltaX * ratio, y: start.y + deltaY * ratio };
         var distance = Math.pow(point.x - desired.x, 2) + Math.pow(point.y - desired.y, 2);
         if (distance < bestDistance) {
            closest = point;
            bestDistance = distance;
         }
      });
      return inside ? desired : closest;
   }

   function frame(input) {
      var width = Math.max(1, number(input.width, 1));
      var height = Math.max(1, number(input.height, 1));
      var imageWidth = Math.max(1, number(input.imageWidth, 1));
      var imageHeight = Math.max(1, number(input.imageHeight, 1));
      var radians = number(input.rotation, 0) * Math.PI / 180;
      var cosine = Math.cos(radians);
      var sine = Math.sin(radians);
      var cover = Math.max(width / imageWidth, height / imageHeight);
      var rotatedCover = Math.max((Math.abs(cosine) * width + Math.abs(sine) * height) / imageWidth, (Math.abs(sine) * width + Math.abs(cosine) * height) / imageHeight);
      var scale = Math.max(cover * Math.max(1, number(input.zoom, 1.35)), rotatedCover) * (1 + 1e-8);
      var mirrorX = input.mirrorX === -1 ? -1 : 1;
      var mirrorY = input.mirrorY === -1 ? -1 : 1;
      var matrixA = scale * cosine * mirrorX;
      var matrixB = scale * sine * mirrorX;
      var matrixC = -scale * sine * mirrorY;
      var matrixD = scale * cosine * mirrorY;
      var poi = input.poi || { x: 50, y: 50 };
      var sourceX = clamp(number(poi.x, 50), 0, 100) * imageWidth / 100;
      var sourceY = clamp(number(poi.y, 50), 0, 100) * imageHeight / 100;
      var offsetX = matrixA * (sourceX - imageWidth / 2) + matrixC * (sourceY - imageHeight / 2);
      var offsetY = matrixB * (sourceX - imageWidth / 2) + matrixD * (sourceY - imageHeight / 2);
      var targetX = clamp(number(input.focusX, 50) + number(input.panX, 0), 10, 90) * width / 100;
      var targetY = clamp(number(input.focusY, 50) + number(input.panY, 0), 10, 90) * height / 100;
      var desired = { x: targetX - offsetX, y: targetY - offsetY };
      var roomX = Math.max(0, (scale * imageWidth - Math.abs(cosine) * width - Math.abs(sine) * height) / 2);
      var roomY = Math.max(0, (scale * imageHeight - Math.abs(sine) * width - Math.abs(cosine) * height) / 2);
      var coverage = [[-roomX, -roomY], [roomX, -roomY], [roomX, roomY], [-roomX, roomY]].map(function (point) {
         return { x: width / 2 + cosine * point[0] - sine * point[1], y: height / 2 + sine * point[0] + cosine * point[1] };
      });
      var visible = clip(coverage, 'x', -offsetX, true);
      visible = clip(visible, 'x', width - offsetX, false);
      visible = clip(visible, 'y', -offsetY, true);
      visible = clip(visible, 'y', height - offsetY, false);
      var center = nearest(visible.length ? visible : coverage, desired);
      var centerOffsetX = center.x - width / 2;
      var centerOffsetY = center.y - height / 2;
      var centerHorizontal = clamp(cosine * centerOffsetX + sine * centerOffsetY, -roomX, roomX);
      var centerVertical = clamp(-sine * centerOffsetX + cosine * centerOffsetY, -roomY, roomY);
      center = { x: width / 2 + cosine * centerHorizontal - sine * centerVertical, y: height / 2 + sine * centerHorizontal + cosine * centerVertical };
      var translateX = center.x - matrixA * imageWidth / 2 - matrixC * imageHeight / 2;
      var translateY = center.y - matrixB * imageWidth / 2 - matrixD * imageHeight / 2;
      var poiX = center.x + offsetX;
      var poiY = center.y + offsetY;
      return {
         matrix: [matrixA, matrixB, matrixC, matrixD, translateX, translateY],
         transform: 'matrix(' + [matrixA, matrixB, matrixC, matrixD, translateX, translateY].join(',') + ')',
         poiX: poiX,
         poiY: poiY,
         poiVisible: poiX >= -0.00001 && poiX <= width + 0.00001 && poiY >= -0.00001 && poiY <= height + 0.00001,
         constrained: Math.hypot(center.x - desired.x, center.y - desired.y) > 0.5,
         scale: scale
      };
   }

   function attach(slideshow) {
      var slides = Array.from(slideshow.querySelectorAll('[data-hero-config]')).map(function (element) {
         return { element: element, image: element.querySelector('img'), config: JSON.parse(element.dataset.heroConfig), elapsed: 0, last: null };
      });
      if (!slides.length) return;
      var dimensions = { width: slideshow.clientWidth, height: slideshow.clientHeight };
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      var inView = true;
      var animationFrame = null;

      function draw(timestamp) {
         animationFrame = null;
         var tier = window.innerWidth < 768 ? 'mobile' : window.innerWidth < 992 ? 'tablet' : 'desktop';
         var moving = false;
         slides.forEach(function (slide) {
            if (!slide.image.naturalWidth) return;
            var config = settings(slide.config, tier);
            var active = slide.element.classList.contains('is-active') && slide.element.offsetWidth > 0;
            var running = active && !reduced.matches && !document.hidden && inView && config.type !== 'none';
            if (running && slide.last !== null) slide.elapsed += Math.min(100, timestamp - slide.last) / 1000;
            slide.last = running ? timestamp : null;
            var progress = reduced.matches ? 0 : (slide.elapsed / config.duration) % 2;
            if (progress > 1) progress = 2 - progress;
            var movement = motion(config, progress);
            var result = frame(Object.assign({}, dimensions, config, movement, {
               imageWidth: slide.image.naturalWidth,
               imageHeight: slide.image.naturalHeight,
               poi: slide.config.poi
            }));
            slide.image.style.width = slide.image.naturalWidth + 'px';
            slide.image.style.height = slide.image.naturalHeight + 'px';
            slide.image.style.transform = result.transform;
            if (!slide.element.classList.contains('is-poi-framed')) slide.element.classList.add('is-poi-framed');
            slide.element.dataset.poiVisible = String(result.poiVisible);
            slide.element.dataset.framingConstrained = String(result.constrained);
            moving = moving || running;
         });
         if (moving) schedule();
      }

      function schedule() {
         if (animationFrame === null) animationFrame = requestAnimationFrame(draw);
      }

      slides.forEach(function (slide) { slide.image.addEventListener('load', schedule); });
      new ResizeObserver(function () {
         dimensions = { width: slideshow.clientWidth, height: slideshow.clientHeight };
         schedule();
      }).observe(slideshow);
      new MutationObserver(schedule).observe(slideshow, { attributes: true, attributeFilter: ['class'], subtree: true });
      new IntersectionObserver(function (entries) {
         inView = entries[0].isIntersecting;
         schedule();
      }).observe(slideshow);
      document.addEventListener('visibilitychange', schedule);
      reduced.addEventListener('change', schedule);
      window.addEventListener('resize', schedule);
      schedule();
   }

   return { frame: frame, motion: motion, settings: settings, attach: attach };
}));