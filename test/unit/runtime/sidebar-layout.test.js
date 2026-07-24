'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SHELL_TAB_BAR_HEIGHT,
  resolveSidebarWidth,
  resolveShellContentBounds,
} = require('../../../src/app/shared/sidebar-layout');

test('普通窗口按内容宽度计算侧栏宽度', () => {
  assert.equal(resolveSidebarWidth({ contentWidth: 1200 }), 360);
});

test('主内容区从顶部铺满并在底部预留标签栏高度', () => {
  assert.deepEqual(resolveShellContentBounds({
    contentWidth: 1920,
    contentHeight: 1040,
    sideViewWidth: 360,
  }), {
    x: 0,
    y: 0,
    width: 1560,
    height: 1040 - SHELL_TAB_BAR_HEIGHT,
    tabBarHeight: SHELL_TAB_BAR_HEIGHT,
  });
});

test('最大化窗口保留侧栏当前像素宽度', () => {
  assert.equal(resolveSidebarWidth({
    contentWidth: 1920,
    isMaximized: true,
    currentWidth: 360,
    normalWindowWidth: 1200,
  }), 360);
});

test('首次以最大化状态启动时按普通窗口宽度恢复侧栏', () => {
  assert.equal(resolveSidebarWidth({
    contentWidth: 1920,
    isMaximized: true,
    normalWindowWidth: 1440,
  }), 432);
});

test('隐藏侧栏不占用内容宽度', () => {
  assert.equal(resolveSidebarWidth({
    contentWidth: 1920,
    isVisible: false,
    isMaximized: true,
    currentWidth: 360,
  }), 0);
});
