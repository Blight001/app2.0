'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { contextIsolation: true },
  });
  const html = `<!doctype html><html><head><style>
    body { font: 16px sans-serif; }
    button, p { display: block; margin: 8px; }
  </style></head><body>
    <button id="first">第一个按钮</button>
    <button id="second">第二个按钮</button>
    <button id="third">第三个按钮</button>
    <p>第一段页面文字</p><p>第二段页面文字</p><p>第三段页面文字</p>
  </body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const contentRoot = path.join(__dirname, '..', '..', '..', 'src', 'assets', 'extensions', 'browser_automation', 'content');
  for (const name of ['fx.js', 'observe.js', 'observe-targets.js', 'observe-records.js', 'observe-actions.js']) {
    const source = fs.readFileSync(path.join(contentRoot, name), 'utf8');
    await win.webContents.executeJavaScript(`${source}\n;undefined`);
  }

  await win.webContents.executeJavaScript(`
    window.__resolvedClickCount = 0;
    document.querySelector('#first').addEventListener('click', () => { window.__resolvedClickCount += 1; });
  `);
  const resolvedClick = await win.webContents.executeJavaScript(
    'window.__hsObserve.resolveClick({ selector: "#first" }, "left")',
  );
  assert.equal(resolvedClick.success, true);
  assert.equal(resolvedClick.input.inputType, 'mouse');
  assert.equal(resolvedClick.input.action, 'click');
  assert.ok(resolvedClick.input.x > 0 && resolvedClick.input.x < resolvedClick.input.viewportWidth);
  assert.ok(resolvedClick.input.y > 0 && resolvedClick.input.y < resolvedClick.input.viewportHeight);
  assert.equal(await win.webContents.executeJavaScript('window.__resolvedClickCount'), 0,
    '坐标解析阶段不能提前触发 DOM 合成点击');

  const truncated = await win.webContents.executeJavaScript(
    'window.__hsObserve.scan({ limit: 2, max_items: 3, text_limit: 10, mark: false })',
  );
  assert.equal(truncated.success, true);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.tooMany, false);
  assert.equal(truncated.items.length, 3);
  assert.ok(truncated.items.some((item) => item.kind === 'interactive'), '截断结果仍应包含可交互元素');
  assert.ok(truncated.items.some((item) => item.kind === 'text'), '截断结果仍应包含页面文本');
  assert.ok(truncated.matchedItemCount > truncated.itemCount);

  const strictOverflow = await win.webContents.executeJavaScript(
    'window.__hsObserve.scan({ limit: 2, max_items: 3, text_limit: 10, allow_truncate: false, mark: false })',
  );
  assert.equal(strictOverflow.tooMany, true);
  assert.deepEqual(strictOverflow.items, []);

  console.log('browser_observe overflow checks passed');
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
