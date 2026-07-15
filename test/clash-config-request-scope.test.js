const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulesRoot = path.join(
  __dirname,
  '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules',
);

const vpnSource = fs.readFileSync(path.join(modulesRoot, 'vpn.js'), 'utf8');
const licenseSource = fs.readFileSync(path.join(modulesRoot, 'license.js'), 'utf8');

function functionSource(source, name, nextName) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `缺少函数 ${name}`);
  assert.notEqual(end, -1, `无法确定函数 ${name} 的范围`);
  return source.slice(start, end);
}

test('Clash 配置只在网络魔法启动流程中请求', () => {
  const ensureCalls = vpnSource.match(/ensureClashMiniConfigPreheated\s*\(/g) || [];

  // 一处是函数定义，另一处必须是网络魔法启动流程中的唯一调用。
  assert.equal(ensureCalls.length, 2);
  assert.doesNotMatch(vpnSource, /warmupClashMiniProcess|clashMiniWarmupState/);
  assert.doesNotMatch(licenseSource, /warmupClashMiniProcess/);

  const startFlow = functionSource(vpnSource, 'startClashMiniFlowOnce', 'toggleClashMini');
  assert.match(startFlow, /if \(fetchConfig\)[\s\S]*ensureClashMiniConfigPreheated\(\{ force: true, key, deviceId \}\)/);
});

test('自动恢复魔法也通过启动流程拉取配置，不在状态恢复阶段预热', () => {
  const autoStart = functionSource(vpnSource, 'autoStartNetworkMagicIfEligible', 'bindClashMiniControls');

  assert.match(autoStart, /accountCenterPopup[\s\S]*return;/);
  assert.doesNotMatch(autoStart, /ensureClashMiniConfigPreheated/);
  assert.match(autoStart, /startClashMiniFlow\(\{ startBtn, vpnBtn, fetchConfig: true, key, deviceId \}\)/);
});
