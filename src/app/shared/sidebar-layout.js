'use strict';

const SIDEBAR_WIDTH_RATIO = 0.3;
/** 主窗口底部标签栏占用高度（与 app-shell.css 视觉高度对齐）。 */
const SHELL_TAB_BAR_HEIGHT = 41;

/**
 * @param {unknown} value
 */
function positiveWidth(value) {
  const width = Math.floor(Number(value));
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * @param {{
 *   contentWidth?: number,
 *   isVisible?: boolean,
 *   isMaximized?: boolean,
 *   currentWidth?: number,
 *   normalWindowWidth?: number,
 * }} options
 */
function resolveSidebarWidth({
  contentWidth,
  isVisible = true,
  isMaximized = false,
  currentWidth = 0,
  normalWindowWidth = 0,
} = /** @type {Parameters<typeof resolveSidebarWidth>[0]} */ ({})) {
  const availableWidth = positiveWidth(contentWidth);
  if (!isVisible || availableWidth === 0) return 0;
  if (isMaximized) {
    const retainedWidth = positiveWidth(currentWidth);
    if (retainedWidth > 0 && retainedWidth < availableWidth) return retainedWidth;
    const normalWidth = positiveWidth(normalWindowWidth);
    if (normalWidth > 0) {
      return Math.max(1, Math.min(availableWidth, Math.floor(normalWidth * SIDEBAR_WIDTH_RATIO)));
    }
  }
  return Math.max(1, Math.floor(availableWidth * SIDEBAR_WIDTH_RATIO));
}

/**
 * 标签栏固定在底部时的主内容区（浏览器 / 侧栏）bounds。
 * @param {{
 *   contentWidth?: number,
 *   contentHeight?: number,
 *   sideViewWidth?: number,
 * }} options
 */
function resolveShellContentBounds({
  contentWidth = 0,
  contentHeight = 0,
  sideViewWidth = 0,
} = {}) {
  const width = Math.max(0, positiveWidth(contentWidth) - Math.max(0, Math.floor(Number(sideViewWidth) || 0)));
  const height = Math.max(0, positiveWidth(contentHeight) - SHELL_TAB_BAR_HEIGHT);
  return {
    x: 0,
    y: 0,
    width,
    height,
    tabBarHeight: SHELL_TAB_BAR_HEIGHT,
  };
}

module.exports = {
  SHELL_TAB_BAR_HEIGHT,
  resolveSidebarWidth,
  resolveShellContentBounds,
};
