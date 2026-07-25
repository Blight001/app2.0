'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createSoftwareAutomationBridge,
} = require(path.join(
  projectRoot,
  'src/app/main/features/external-app/software-automation-bridge.js',
));

function runtimeFixture(actions) {
  const target = {
    profileId: 'software-1',
    hwnd: '1234',
    pid: 42,
    name: 'Fixture',
  };
  return {
    externalApp: {
      listAutomationTargets: () => [target],
    },
    windowBridge: {
      captureExternalWindow: async (input) => {
        actions.push(input);
        return {
          dataUrl: 'data:image/png;base64,AA==',
          width: 1,
          height: 1,
          visual_candidates: [],
        };
      },
      performExternalWindowAction: async (input) => {
        actions.push(input);
        return { ok: true };
      },
    },
  };
}

test('Software 卡片独立落盘、强制 domain 并只在软件目标执行', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-software-cards-'));
  const actions = [];
  try {
    const bridge = createSoftwareAutomationBridge({
      browserRuntimeManager: runtimeFixture(actions),
      cardCacheDir: directory,
    });
    bridge.setCardCacheState({
      selectedId: 'card-1',
      items: [{
        id: 'card-1',
        cardName: '聚焦软件',
        cardData: {
          domain: 'software',
          name: '聚焦软件',
          steps: [{ type: 'observe' }],
        },
      }],
    });

    const result = await bridge.dispatch(
      'software-1',
      'manage_card',
      { action: 'run', id: 'card-1' },
    );

    assert.deepEqual(result, { completed: true, steps: 1 });
    assert.equal(actions.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(bridge.cardCacheFilePath, 'utf8')).domain, 'software');
    assert.throws(() => bridge.setCardCacheState({
      items: [{
        id: 'browser-card',
        cardData: { domain: 'browser', name: '错误域', steps: [] },
      }],
    }), /拒绝非 software 卡片/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Software 自动化 dispose 只取消本域运行表且不创建浏览器连接', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-software-dispose-'));
  try {
    const bridge = createSoftwareAutomationBridge({
      browserRuntimeManager: runtimeFixture([]),
      cardCacheDir: directory,
    });
    const connections = bridge.listConnections();
    assert.deepEqual(connections.map((item) => item.profileId), ['software-1']);
    assert.equal(connections[0].tools[0].name, 'manage_card');
    assert.equal(bridge.dispose(), 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
