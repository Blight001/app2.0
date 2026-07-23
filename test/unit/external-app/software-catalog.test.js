'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SoftwareCatalog } = require('../../../src/app/main/features/external-app/software-catalog');

test('软件目录不显示尚未打开的内置软件', () => {
  const catalog = new SoftwareCatalog({
    listVisibleWindows: () => [],
  });

  assert.deepEqual(catalog.listAvailable(), []);
  assert.equal(catalog.getLaunchDefinition('notepad'), null);
  assert.equal(catalog.getLaunchDefinition('../arbitrary.exe'), null);
});

test('软件目录枚举桌面上已打开的窗口且不向渲染进程暴露 HWND/PID', () => {
  const windows = [{
    hwnd: '456789',
    pid: 321,
    title: '项目说明.txt - 记事本',
    processName: 'Notepad.exe',
  }];
  const catalog = new SoftwareCatalog({
    fs: { existsSync: () => false },
    listVisibleWindows: () => windows,
  });

  const [entry] = catalog.listAvailable();
  assert.match(entry.id, /^window-[a-f0-9]{20}$/);
  assert.equal(entry.name, '项目说明.txt - 记事本');
  assert.equal(entry.description, '已打开窗口 · Notepad.exe');
  assert.equal(entry.running, true);
  assert.equal('hwnd' in entry, false);
  assert.equal('pid' in entry, false);
  assert.equal('existingWindowHwnd' in entry, false);

  const launch = catalog.getLaunchDefinition(entry.id);
  assert.equal(launch.existingWindowHwnd, '456789');
  assert.equal(launch.existingWindowPid, 321);
  assert.equal(catalog.getLaunchDefinition('window-arbitrary'), null);
});

test('软件目录忽略无效窗口并按 HWND/PID 去重', () => {
  const catalog = new SoftwareCatalog({
    fs: { existsSync: () => false },
    listVisibleWindows: () => [
      { hwnd: '100', pid: 20, title: '计算器', processName: 'CalculatorApp.exe' },
      { hwnd: '100', pid: 20, title: '重复项', processName: 'CalculatorApp.exe' },
      { hwnd: 'bad', pid: 21, title: '无效 HWND' },
      { hwnd: '200', pid: 0, title: '无效 PID' },
      { hwnd: '300', pid: 30, title: '   ' },
    ],
  });

  assert.equal(catalog.listAvailable().length, 1);
});
