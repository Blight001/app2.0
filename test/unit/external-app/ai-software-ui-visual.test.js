'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  detectVisualCandidates,
} = require('../../../src/app/main/services/ai-software-ui-visual');

function solidRgba(width, height, r, g, b) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function drawRect(pixels, width, x, y, w, h, r, g, b) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      if (px < 0 || py < 0 || px >= width) continue;
      const offset = (py * width + px) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
}

test('视觉候选在纯色背景上返回空列表', () => {
  const pixels = solidRgba(120, 80, 240, 240, 240);
  assert.deepEqual(detectVisualCandidates(pixels, 120, 80), []);
});

test('视觉候选能发现高对比矩形区域并生成 vref', () => {
  const width = 200;
  const height = 120;
  const pixels = solidRgba(width, height, 245, 245, 245);
  drawRect(pixels, width, 20, 30, 80, 28, 20, 20, 20);
  drawRect(pixels, width, 110, 70, 60, 24, 10, 90, 200);
  const candidates = detectVisualCandidates(pixels, width, height);
  assert.ok(candidates.length >= 1);
  assert.match(candidates[0].vref, /^v:\d+$/);
  assert.ok(Number.isFinite(candidates[0].cx));
  assert.ok(Number.isFinite(candidates[0].cy));
});
