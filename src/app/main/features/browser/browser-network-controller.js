'use strict';

const {
  getClashMiniStatus,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
} = require('../network/clash-mini-control-runtime');
const { appContext } = require('../../runtime/app-context');
const { buildAppliedBrowserEnvironment } = require('./browser-environment');
const { callOptional, firstText } = require('../../../shared/safe-values');

function getBrowserProxyEndpoint() {
  const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
  const coreDir = firstText(
    clashMiniStatus && clashMiniStatus.coreDir,
    typeof getClashMiniRuntimeRoot === 'function' ? getClashMiniRuntimeRoot() : '',
  );
  if (!coreDir) return null;
  const endpoint = typeof getClashMiniProxyEndpoint === 'function' ? getClashMiniProxyEndpoint(coreDir) : null;
  if (!endpoint || !Number.isFinite(Number(endpoint.port))) return null;
  const host = firstText(endpoint.host, '127.0.0.1').trim();
  return {
    enabled: true,
    server: `http://${host || '127.0.0.1'}:${Number(endpoint.port)}`,
    bypassRules: '<local>;127.0.0.1;localhost;::1',
  };
}

function isTabMagicSelected(tab) {
  return Boolean(tab && tab.browserSettings && tab.browserSettings.proxy
    && tab.browserSettings.proxy.mode === 'magic');
}

function getChromiumInstance(runtimeManager, tabId) {
  const chromium = runtimeManager && runtimeManager.chromium;
  const instances = chromium && chromium.instances;
  return instances && typeof instances.get === 'function' ? instances.get(String(tabId)) : null;
}

function profileRuntimeChanged(previousProfile, resolvedProfile) {
  return ['region', 'locale', 'timezoneId', 'acceptLanguage']
    .some((key) => firstText(previousProfile[key]) !== firstText(resolvedProfile[key]));
}

function applyResolvedProfile(instance, tab, resolvedProfile) {
  tab.browserProfile = resolvedProfile;
  instance.profile.locale = firstText(resolvedProfile.locale, instance.profile.locale);
  instance.profile.acceptLanguage = firstText(resolvedProfile.acceptLanguage, instance.profile.acceptLanguage);
  instance.profile.timezoneId = firstText(resolvedProfile.timezoneId, instance.profile.timezoneId);
  instance.profile.userAgent = firstText(resolvedProfile.userAgent, instance.profile.userAgent);
  instance.profile.browserEnvironment = buildAppliedBrowserEnvironment(resolvedProfile);
}

function proxySettingsChanged(profile, server, bypassList) {
  return firstText(profile.proxyServer) !== server || firstText(profile.proxyBypassList) !== bypassList;
}

function runtimeRestartRequired(proxyChanged, profileChanged) {
  return proxyChanged || profileChanged;
}

async function refreshTabBrowserProfile(deps, tab, instance, options) {
  const { proxyChanged, forceProfileRefresh, nextProxyServer } = options;
  if (typeof deps.resolveTabBrowserProfile !== 'function' || (!proxyChanged && !forceProfileRefresh)) return false;
  const previousProfile = tab.browserProfile && typeof tab.browserProfile === 'object' ? tab.browserProfile : {};
  const resolvedProfile = await deps.resolveTabBrowserProfile({
    browserSettings: tab.browserSettings || {},
    httpGetUniversal: deps.httpGetUniversal,
    logger: deps.logger || console,
    geoProxyServer: nextProxyServer,
    forceGeoLookup: true,
  });
  const profileUsable = resolvedProfile && (!nextProxyServer || resolvedProfile.proxyExitVerified !== false);
  if (profileUsable) {
    const changed = profileRuntimeChanged(previousProfile, resolvedProfile);
    applyResolvedProfile(instance, tab, resolvedProfile);
    return changed;
  }
  if (resolvedProfile && resolvedProfile.proxyExitVerified === false) {
    callOptional(
      deps.logger || console,
      'warn',
      `[ChromiumRuntime] 标签 ${tab.id} 的代理出口地区探测失败，保留当前浏览器环境且不因本次探测重启`,
    );
  }
  return false;
}

async function applyProxyToTab(deps, tab, context) {
  const { enabled, browserProxy, forceProfileRefresh, failures } = context;
  try {
    const tabProxy = enabled ? (browserProxy || { enabled: false }) : { enabled: false };
    const instance = getChromiumInstance(deps.browserRuntimeManager, tab.id);
    if (!instance || !instance.profile) {
      tab.networkMagicApplied = false;
      return false;
    }
    const nextProxyServer = tabProxy.enabled ? firstText(tabProxy.server) : '';
    const nextProxyBypassList = tabProxy.enabled ? firstText(tabProxy.bypassRules) : '';
    const proxyChanged = proxySettingsChanged(instance.profile, nextProxyServer, nextProxyBypassList);
    const runtimeProfileChanged = await refreshTabBrowserProfile(deps, tab, instance, {
      proxyChanged, forceProfileRefresh, nextProxyServer,
    });
    if (!runtimeRestartRequired(proxyChanged, runtimeProfileChanged)) {
      tab.networkMagicApplied = enabled && Boolean(nextProxyServer);
      return false;
    }
    instance.profile.proxyServer = nextProxyServer;
    instance.profile.proxyBypassList = nextProxyBypassList;
    if (appContext.isShuttingDown()) return false;
    const runtimeState = await deps.browserRuntimeManager.restart(tab.id);
    tab.runtimeStatus = firstText(runtimeState && runtimeState.status, tab.runtimeStatus);
    tab.networkMagicApplied = enabled && Boolean(nextProxyServer);
    return true;
  } catch (error) {
    tab.networkMagicApplied = false;
    const failure = { tabId: firstText(tab.id), message: firstText(error && error.message, error) };
    failures.push(failure);
    callOptional(deps.logger || console, 'warn', `[ChromiumRuntime] 网络魔法代理切换后重启失败 ${failure.tabId}:`, failure.message);
    return false;
  }
}

function getPreviousProxy(tab) {
  const settings = tab && tab.browserSettings;
  const proxy = settings && settings.proxy;
  return proxy && typeof proxy === 'object' ? proxy : {};
}

function isMagicRunning(status) {
  return Boolean(status && status.running === true && status.enabled === true);
}

function shouldDeferMagicChange(magicRunning, enabled, wasMagicApplied) {
  return !magicRunning && (enabled || !wasMagicApplied);
}

function getMagicChangeFailure(result, enabled) {
  const firstFailure = result && Array.isArray(result.failures) ? result.failures[0] : null;
  return firstText(firstFailure && firstFailure.message, enabled ? '应用魔法代理失败' : '关闭魔法代理失败');
}

async function applyClashMiniBrowserProxy(deps, enabled = true, options = {}) {
  const targetTabId = firstText(options && options.onlyTabId).trim();
  const entries = Array.from(deps.resolveTabs().values()).filter((tab) => (
    targetTabId ? firstText(tab && tab.id) === targetTabId : isTabMagicSelected(tab)
  ));
  const failures = [];
  if (appContext.isShuttingDown()) {
    return { ok: true, enabled: false, updated: 0, total: entries.length, failures, skipped: true };
  }
  const context = {
    enabled: enabled === true,
    browserProxy: getBrowserProxyEndpoint(),
    forceProfileRefresh: Boolean(options && options.forceProfileRefresh === true),
    failures,
  };
  const results = await Promise.all(entries.map((tab) => applyProxyToTab(deps, tab, context)));
  deps.updateTabs(true);
  return {
    ok: failures.length === 0,
    enabled: Boolean(enabled),
    updated: results.filter(Boolean).length,
    total: entries.length,
    failures,
  };
}

async function applyNetworkMagicToTab(deps, tabId, enabled = true) {
  const tabs = deps.resolveTabs();
  const tab = tabs.get(firstText(tabId));
  if (!tab) return { ok: false, error: '浏览器窗口不存在' };
  const previousProxy = getPreviousProxy(tab);
  const wasMagicApplied = tab.networkMagicApplied === true;
  tab.browserSettings = {
    ...(tab.browserSettings || {}),
    proxy: { ...previousProxy, mode: enabled ? 'magic' : 'default' },
  };
  tabs.set(tab.id, tab);
  const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
  const magicRunning = isMagicRunning(clashMiniStatus);
  if (shouldDeferMagicChange(magicRunning, enabled, wasMagicApplied)) {
    tab.networkMagicApplied = false;
    deps.updateTabs(true);
    return { ok: true, magicRunning: false, restarted: false };
  }
  const result = await applyClashMiniBrowserProxy(deps, enabled, { onlyTabId: tab.id });
  if (!result || result.ok !== true) {
    return { ok: false, magicRunning, error: getMagicChangeFailure(result, enabled) };
  }
  return { ok: true, magicRunning, restarted: Number(firstText(result.updated, 0)) > 0 };
}

function createBrowserNetworkController(deps = {}) {
  return {
    applyClashMiniBrowserProxy: (enabled, options) => applyClashMiniBrowserProxy(deps, enabled, options),
    applyNetworkMagicToTab: (tabId, enabled) => applyNetworkMagicToTab(deps, tabId, enabled),
    getBrowserProxyEndpoint,
  };
}

module.exports = { createBrowserNetworkController };
