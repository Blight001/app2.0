'use strict';

async function notifyPluginState(deps, payload, warning) {
  if (typeof deps.onPluginStateChanged !== 'function') return null;
  try {
    return await deps.onPluginStateChanged(payload);
  } catch (error) {
    deps.logger.warn?.(warning, error?.message || error);
    return { ok: false, message: error?.message || String(error) };
  }
}

async function setPluginEnabled(deps, pluginId, enabled) {
  const plugin = deps.getPluginById(pluginId);
  if (!plugin) return { ok: false, message: '插件不存在', state: deps.getPublicState() };
  if (plugin.missing === true && enabled === true) {
    return { ok: false, message: '插件目录不存在，请重新导入', state: deps.getPublicState() };
  }
  plugin.enabled = enabled === true;
  plugin.updatedAt = new Date().toISOString();
  deps.persistState();
  if (plugin.enabled) await deps.loadPluginIntoAllCurrentSessions(plugin);
  else await deps.unloadPluginFromAllSessions(plugin);
  const browserRefresh = await notifyPluginState(deps, {
    plugin: deps.toPublicPlugin(plugin), enabled: plugin.enabled,
  }, '[Extensions] 插件状态已更新，但浏览器刷新失败:');
  deps.syncLegacyTranslateSetting();
  return { ok: true, plugin: deps.toPublicPlugin(plugin), state: deps.getPublicState(), browserRefresh };
}

/** @param {Record<string, any>} [deps] */
function createExtensionMutationService(deps = {}) {
  const runtime = /** @type {Record<string, any>} */ ({ ...deps, logger: deps.logger || console });
  return {
    setPluginEnabled: (id, enabled) => setPluginEnabled(runtime, id, enabled),
    isPluginEnabled: (id) => runtime.getPluginById(id)?.enabled === true,
  };
}

module.exports = { createExtensionMutationService };
