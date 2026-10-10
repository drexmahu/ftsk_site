const assert = require('node:assert/strict');
const framing = require('../../static/js/hero-framing.js');

function assertCoverage(input, result) {
  const [matrixA, matrixB, matrixC, matrixD, translateX, translateY] = result.matrix;
  const determinant = matrixA * matrixD - matrixB * matrixC;
  for (const [targetX, targetY] of [[0, 0], [input.width, 0], [0, input.height], [input.width, input.height]]) {
    const sourceX = (matrixD * (targetX - translateX) - matrixC * (targetY - translateY)) / determinant;
    const sourceY = (-matrixB * (targetX - translateX) + matrixA * (targetY - translateY)) / determinant;
    assert(sourceX >= -0.001 && sourceX <= input.imageWidth + 0.001, JSON.stringify(input));
    assert(sourceY >= -0.001 && sourceY <= input.imageHeight + 0.001, JSON.stringify(input));
  }
  if (result.poiVisible) {
    assert(result.poiX >= -0.001 && result.poiX <= input.width + 0.001);
    assert(result.poiY >= -0.001 && result.poiY <= input.height + 0.001);
  }
}

let checks = 0;
for (const [width, height] of [[1440, 700], [390, 844], [834, 700], [2560, 700]]) {
  for (const [imageWidth, imageHeight] of [[1600, 1067], [1200, 1600]]) {
    for (const rotation of [0, -8, 8]) {
      for (const zoom of [1, 1.35, 2.5]) {
        for (const [mirrorX, mirrorY] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          for (const poi of [{ x: 50, y: 50 }, { x: 0, y: 0 }, { x: 98, y: 5 }]) {
            const input = { width, height, imageWidth, imageHeight, rotation, zoom, mirrorX, mirrorY, poi, focusX: 75, focusY: 50, panX: 20, panY: -20 };
            const result = framing.frame(input);
            assertCoverage(input, result);
            if (rotation === 0) assert(result.poiVisible, 'An unrotated POI can always remain visible');
            checks++;
          }
        }
      }
    }
  }
}

for (const type of ['pan', 'zoom-in', 'zoom-out', 'tilt', 'none']) {
  for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
    const config = framing.settings({ poi: { x: 0, y: 50 }, animation: { type, amount: type === 'tilt' ? 15 : type === 'pan' ? 20 : 0.6 } }, 'mobile');
    const input = Object.assign({ width: 390, height: 600, imageWidth: 1600, imageHeight: 1067, poi: { x: 0, y: 50 } }, config, framing.motion(config, progress));
    assertCoverage(input, framing.frame(input));
    checks++;
  }
}

const inherited = framing.settings({ start: { focus: '0% 80%', zoom: 1.4 }, animation: { amount: 0 }, mobile: { focus: '70% 40%' }, mirror: 'both' }, 'mobile');
assert.equal(inherited.zoom, 1.4);
assert.equal(inherited.focusX, 70);
assert.equal(inherited.focusY, 40);
assert.equal(inherited.amount, 0);
assert.equal(inherited.mirrorX, -1);
assert.equal(inherited.mirrorY, -1);
console.log('PASS: ' + checks + ' geometry/motion combinations, edge POIs, mirror variants, and breakpoint inheritance.');