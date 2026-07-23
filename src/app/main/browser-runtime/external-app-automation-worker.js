'use strict';

const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');

const binding = require(workerData.bindingPath);
const ALLOWED_METHODS = new Set([
  'captureExternalWindow',
  'observeExternalWindowUi',
  'performExternalWindowUiAction',
]);

function boundedDimension(value, fallback) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? Math.min(2560, Math.max(320, Math.round(number)))
    : fallback;
}

async function encodeCapture(result, options) {
  const sourceWidth = Number(result?.width || 0);
  const sourceHeight = Number(result?.height || 0);
  const pixels = Buffer.from(result?.pixels || []);
  if (!sourceWidth || !sourceHeight || pixels.length !== sourceWidth * sourceHeight * 4) {
    throw new Error('Windows 截图返回了无效的像素数据');
  }
  const maxWidth = boundedDimension(options.maxWidth, 1600);
  const maxHeight = boundedDimension(options.maxHeight, 1000);
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  let image = sharp(pixels, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
  });
  if (width !== sourceWidth || height !== sourceHeight) {
    image = image.resize(width, height, { fit: 'fill' });
  }
  const png = await image.png({ compressionLevel: 6 }).toBuffer();
  const { pixels: _pixels, ...metadata } = result;
  return {
    ...metadata,
    sourceWidth,
    sourceHeight,
    width,
    height,
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
  };
}

async function execute(method, options = {}) {
  if (!ALLOWED_METHODS.has(method) || typeof binding[method] !== 'function') {
    throw new Error(`原生软件自动化方法不可用: ${method}`);
  }
  const result = binding[method](options);
  return method === 'captureExternalWindow'
    ? encodeCapture(result, options)
    : result;
}

parentPort.on('message', async (message) => {
  const id = Number(message?.id || 0);
  try {
    const result = await execute(String(message?.method || ''), message?.options || {});
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: {
        message: String(error?.message || error || '软件自动化失败'),
        code: String(error?.code || ''),
      },
    });
  }
});
