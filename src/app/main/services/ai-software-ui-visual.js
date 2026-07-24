'use strict';

const MAX_CANDIDATES = 24;
const MIN_AREA = 300;
const MAX_AREA_RATIO = 0.4;
const MIN_EDGE = 18;

function luminance(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function sampleGray(pixels, width, height, x, y) {
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
  const index = (sy * width + sx) * 4;
  return luminance(pixels[index], pixels[index + 1], pixels[index + 2]);
}

function edgeStrength(pixels, width, height, x, y) {
  const center = sampleGray(pixels, width, height, x, y);
  const right = sampleGray(pixels, width, height, x + 1, y);
  const down = sampleGray(pixels, width, height, x, y + 1);
  return Math.abs(center - right) + Math.abs(center - down);
}

function mergeClose(boxes) {
  const merged = [];
  for (const box of boxes) {
    let absorbed = false;
    for (const existing of merged) {
      const gapX = Math.max(existing.x, box.x)
        - Math.min(existing.x + existing.width, box.x + box.width);
      const gapY = Math.max(existing.y, box.y)
        - Math.min(existing.y + existing.height, box.y + box.height);
      if (gapX <= 10 && gapY <= 10) {
        const x1 = Math.min(existing.x, box.x);
        const y1 = Math.min(existing.y, box.y);
        const x2 = Math.max(existing.x + existing.width, box.x + box.width);
        const y2 = Math.max(existing.y + existing.height, box.y + box.height);
        existing.x = x1;
        existing.y = y1;
        existing.width = x2 - x1;
        existing.height = y2 - y1;
        existing.score = Math.max(existing.score, box.score);
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push({ ...box });
  }
  return merged;
}

function isUsefulBox(box, maxArea) {
  const area = box.width * box.height;
  if (area < MIN_AREA || area > maxArea) return false;
  const ratio = box.width / Math.max(1, box.height);
  return ratio >= 0.12 && ratio <= 10;
}

function floodEdgeBox(pixels, width, height, startX, startY, step, visited, colCount) {
  const stack = [[startX, startY]];
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;
  let count = 0;
  const cellKey = (x, y) => Math.floor(y / step) * colCount + Math.floor(x / step);
  while (stack.length && count < 30000) {
    const point = stack.pop();
    const x = point[0];
    const y = point[1];
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const key = cellKey(x, y);
    if (visited[key] || edgeStrength(pixels, width, height, x, y) < MIN_EDGE) continue;
    visited[key] = 1;
    count += 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    stack.push(
      [x + step, y], [x - step, y], [x, y + step], [x, y - step],
      [x + step, y + step], [x - step, y - step],
    );
  }
  if (count < 4) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(step, maxX - minX + step),
    height: Math.max(step, maxY - minY + step),
    score: count,
  };
}

function collectEdgeBoxes(pixels, width, height, step, maxArea) {
  const visited = new Uint8Array(Math.ceil(width / step) * Math.ceil(height / step));
  const colCount = Math.ceil(width / step);
  const raw = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const key = Math.floor(y / step) * colCount + Math.floor(x / step);
      if (visited[key] || edgeStrength(pixels, width, height, x, y) < MIN_EDGE) continue;
      const box = floodEdgeBox(pixels, width, height, x, y, step, visited, colCount);
      if (box && isUsefulBox(box, maxArea)) raw.push(box);
      if (raw.length > 100) return raw;
    }
  }
  return raw;
}

function detectVisualCandidates(pixels, width, height, options = {}) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  const buffer = Buffer.isBuffer(pixels) ? pixels : Buffer.from(pixels || []);
  if (w < 8 || h < 8 || buffer.length < w * h * 4) return [];

  const step = Math.max(1, Math.round(Math.min(w, h) / 160));
  const maxArea = Math.round(w * h * MAX_AREA_RATIO);
  const limit = Math.min(
    MAX_CANDIDATES,
    Math.max(1, Math.round(Number(options.limit) || MAX_CANDIDATES)),
  );
  const merged = mergeClose(collectEdgeBoxes(buffer, w, h, step, maxArea))
    .sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height))
    .slice(0, limit);

  return merged.map((box, index) => ({
    vref: `v:${index}`,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    cx: box.x + Math.floor(box.width / 2),
    cy: box.y + Math.floor(box.height / 2),
  }));
}

module.exports = {
  MAX_CANDIDATES,
  detectVisualCandidates,
};
