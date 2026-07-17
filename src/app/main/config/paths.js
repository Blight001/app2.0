// 集中路径解析（阶段 2D-3，方案 §3.3）——散落在 bootstrap 的特殊路径推导收敛于此。
// 常规 userData 子路径仍用 app.getPath('userData') 现场拼接；这里只放
// 有非平凡判断逻辑的路径。
'use strict';

const path = require('path');

// 开发环境下 process.resourcesPath 指向 node_modules/electron/dist/resources，
// 而不是本应用的 resources 目录；打包版则把 Chromium fork 直接放在
// process.resourcesPath/chromium。
function resolveChromiumResourcesPath(app) {
  return app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '../../../..', 'resources');
}

// 卡片库属于软件级数据，放在 userData/extensions 下，不随任一 Chromium Profile
// 或注入用的扩展副本一起删除。
function resolveAutomationCardCacheDir(app) {
  return path.join(app.getPath('userData'), 'extensions', 'browser_automation');
}

module.exports = { resolveChromiumResourcesPath, resolveAutomationCardCacheDir };
