const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { postEventStream } = require('../src/app/main/lib/http');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('流式 AI 请求可由 AbortSignal 立即停止', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('event: reasoning_delta\ndata: {"delta":"正在思考"}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const controller = new AbortController();
  const request = postEventStream(
    `http://127.0.0.1:${server.address().port}/chat`,
    {},
    () => controller.abort(),
    5000,
    { signal: controller.signal },
  );

  await assert.rejects(request, (error) => error?.name === 'AbortError');
});

test('圆形发送按钮在生成时切换为停止按钮，同时保留 Enter 插入消息', () => {
  const html = read('src/app/sidebar/index.html');
  const css = read('src/app/sidebar/client/app/side/styles/modules/ai-control.css');
  const renderer = read('src/app/sidebar/client/app/side/controllers/pages/ai-control.js');
  const lifecycle = read('src/app/main/services/app-lifecycle.js');

  assert.doesNotMatch(html, /id="ai-chat-stop"/);
  assert.match(html, /id="ai-chat-send"/);
  assert.match(css, /\.ai-chat-composer button[\s\S]*?border-radius:\s*50%/);
  assert.match(renderer, /SEND_BUTTON_ICONS/);
  assert.match(renderer, /send\.innerHTML\s*=\s*SEND_BUTTON_ICONS\[iconMode\]/);
  assert.match(renderer, /if \(state\.loading\) stopAIOutput\(\)/);
  assert.match(renderer, /ai-control-chat-insert/);
  assert.match(renderer, /ai-control-chat-stop/);
  assert.match(lifecycle, /type:\s*'user_inserted'/);
  assert.match(lifecycle, /controller\.abort\(\)/);
});
