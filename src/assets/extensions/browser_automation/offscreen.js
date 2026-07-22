// offscreen.js - keepalive pacemaker for the MV3 service worker.
//
// Chrome can tear down an idle service worker after roughly 30 seconds. This
// offscreen document survives that idle cycle and pings the worker frequently
// enough to keep the AI-FREE local bridge connection healthy while Chrome is
// minimized or the popup is closed.

const PING_INTERVAL_MS = 20000;

function ping() {
    try {
        chrome.runtime.sendMessage({ type: 'offscreen:keepalive', at: Date.now() }).catch(() => {});
    } catch (_error) {}
}

ping();
setInterval(ping, PING_INTERVAL_MS);

function loadScreenshotImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('截图分片图片解码失败'));
        image.src = dataUrl;
    });
}

async function drawScreenshotTile(context, tile, outputScale) {
    const image = await loadScreenshotImage(tile.dataUrl);
    const sourceScaleX = image.naturalWidth / tile.viewportWidth;
    const sourceScaleY = image.naturalHeight / tile.viewportHeight;
    context.drawImage(image,
        tile.sx * sourceScaleX, tile.sy * sourceScaleY,
        tile.sw * sourceScaleX, tile.sh * sourceScaleY,
        tile.dx * outputScale, tile.dy * outputScale,
        tile.sw * outputScale, tile.sh * outputScale);
}

async function composeScreenshot(payload = {}) {
    const scale = Number(payload.scale || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(Number(payload.width) * scale));
    canvas.height = Math.max(1, Math.ceil(Number(payload.height) * scale));
    const context = canvas.getContext('2d');
    for (const tile of payload.tiles || []) await drawScreenshotTile(context, tile, scale);
    const format = ['jpeg', 'webp'].includes(payload.format) ? payload.format : 'png';
    const quality = Number.isFinite(Number(payload.quality)) ? Number(payload.quality) / 100 : undefined;
    return canvas.toDataURL(`image/${format}`, quality);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'screenshot:compose') return false;
    composeScreenshot(message.payload)
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
});
