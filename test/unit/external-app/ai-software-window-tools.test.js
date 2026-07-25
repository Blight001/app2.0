'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createAiSoftwareWindowTools,
} = require(path.join(
  projectRoot,
  'src/app/main/features/external-app/ai-software-window-tools.js',
));

test('Software AI 只通过 Software application contract 管理软件实例', async () => {
  const calls = [];
  const tools = createAiSoftwareWindowTools({
    ui: {
      listAvailableSoftware: async () => [{ id: 'notepad', name: '记事本' }],
      openExternalApp: async (id) => {
        calls.push(['open', id]);
        return 'software-1';
      },
      switchTab: async (id) => calls.push(['switch', id]),
      closeTab: async (id) => calls.push(['close', id]),
    },
  });

  assert.deepEqual(await tools.execute('software_app', { action: 'list' }), {
    items: [{ id: 'notepad', name: '记事本' }],
  });
  assert.deepEqual(await tools.execute('software_app', {
    action: 'open',
    software_id: 'notepad',
  }), { tabId: 'software-1' });
  await tools.execute('software_app', { action: 'switch', tab_id: 'software-1' });
  await tools.execute('software_app', { action: 'close', tab_id: 'software-1' });
  assert.deepEqual(calls, [
    ['open', 'notepad'],
    ['switch', 'software-1'],
    ['close', 'software-1'],
  ]);
});

test('Software AI 拒绝缺少目标和未知动作', async () => {
  const tools = createAiSoftwareWindowTools({ ui: {} });
  await assert.rejects(
    tools.execute('software_app', { action: 'open' }),
    /software_id/,
  );
  await assert.rejects(
    tools.execute('software_app', { action: 'unknown' }),
    /不支持/,
  );
});
