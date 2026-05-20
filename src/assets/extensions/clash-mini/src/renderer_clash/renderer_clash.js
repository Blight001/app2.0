// UI utility functions
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>'"/]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  }[c]));
}

function log(msg) {
  const statusEl = $('#status');
  if (!statusEl) return;
  const now = new Date();
  const MAX_LINE_LEN = 200; // 单行最大显示长度，避免撑开
  let line = `[${now.toLocaleTimeString()}] ${msg}`;
  if (line.length > MAX_LINE_LEN) line = line.slice(0, MAX_LINE_LEN) + '…';

  const existing = statusEl.textContent ? statusEl.textContent.split('\n') : [];
  existing.push(line);
  const MAX_LINES = 300; // 最多保留最近 300 行
  const sliced = existing.length > MAX_LINES ? existing.slice(existing.length - MAX_LINES) : existing;
  statusEl.textContent = sliced.join('\n');
  statusEl.scrollTop = statusEl.scrollHeight;
}

function renderManualDropdown(nodesCache, coreType) {
  const sel = $('#manual-node-select');
  if (!sel) return;

  const currentValue = sel.value;

  if (!nodesCache || nodesCache.length === 0) {
    sel.innerHTML = '';
    return;
  }

  const items = nodesCache.map(n => {
    const d = (n.delay == null) ? (coreType === 'singbox' ? '' : '-') : `${Math.round(n.delay)}ms`;
    return `<option value="${escapeHtml(n.name)}">${escapeHtml(n.name)}${d ? ' ｜ ' + d : ''}</option>`;
  }).join('');

  sel.innerHTML = items;

  if (currentValue) {
    try {
      sel.value = currentValue;
    } catch (e) {}
  }
}

/**
 * 锁定或解锁界面内的交互控件（用于长时操作期间禁止用户交互）
 * 仅会作用于 `.container` 内的 button/input/select/textarea 元素，窗口控制按钮不受影响。
 */
let uiLockCount = 0;
function setUiLocked(lock) {
  try {
    if (lock) uiLockCount = Math.max(0, uiLockCount) + 1;
    else uiLockCount = Math.max(0, uiLockCount - 1);

    const locked = uiLockCount > 0;
    const selector = '.container button, .container input, .container select, .container textarea';
    const els = document.querySelectorAll(selector);
    els.forEach(el => {
      try {
        el.disabled = !!locked;
      } catch (_) {}
    });
    // 为用户提示，调整容器透明度/指针事件（可视化锁定）
    const container = document.querySelector('.container');
    if (container) {
      container.style.pointerEvents = locked ? 'none' : '';
      container.style.opacity = locked ? '0.85' : '';
    }
  } catch (e) {
    // 忽略
  }
}

// Application logic
let nodesCache = [];
let coreType = 'mihomo'; // 默认值
// 重载配置按钮冷却状态
let refreshCooldownTimer = null;
let refreshCooldownRemaining = 0;

const PREFERRED_REGION_REGEX = /(香港|台灣|台湾|日本|hk|jp|tw|HK|JP|TW)/i;
function isPreferredNodeName(name) {
  if (!name) return false;
  try {
    const result = PREFERRED_REGION_REGEX.test(String(name));
    // 添加调试输出
    console.log(`[DEBUG] 节点 "${name}" 匹配结果: ${result}`);
    return result;
  } catch (_) {
    return false;
  }
}

// 测试正则表达式匹配的调试函数
function debugRegexMatch(name) {
  const matched = PREFERRED_REGION_REGEX.test(String(name));
  console.log(`[DEBUG] 节点 "${name}" 匹配结果: ${matched}`);
  return matched;
}

// 根据首选地区（日本/台湾/香港）筛选节点（接受字符串数组或对象数组）
function filterPreferredNodes(list) {
  if (!list || !Array.isArray(list)) return [];
  return list.filter(item => {
    const name = (typeof item === 'string') ? item : (item && item.name);
    return !!name && isPreferredNodeName(name);
  });
}

function sortNodesByPreference(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const nameA = (typeof a === 'string') ? a : (a && a.name) || '';
    const nameB = (typeof b === 'string') ? b : (b && b.name) || '';
    const prefA = isPreferredNodeName(nameA) ? 0 : 1;
    const prefB = isPreferredNodeName(nameB) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;

    const delayA = typeof a?.delay === 'number' ? a.delay : Number.POSITIVE_INFINITY;
    const delayB = typeof b?.delay === 'number' ? b.delay : Number.POSITIVE_INFINITY;
    if (delayA !== delayB) return delayA - delayB;

    return String(nameA).localeCompare(String(nameB), 'zh-Hans-CN');
  });
}

// 停止重载配置冷却
function stopRefreshCooldown() {
  if (refreshCooldownTimer) {
    clearInterval(refreshCooldownTimer);
    refreshCooldownTimer = null;
    refreshCooldownRemaining = 0;

    // 恢复按钮状态
    const btn = document.querySelector('#btn-refresh-provider');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '重载配置';
      btn.classList.remove('disabled');
    }
  }
}

// 开始重载配置按钮冷却
function startRefreshCooldown() {
  const btn = document.querySelector('#btn-refresh-provider');
  if (!btn) return;

  refreshCooldownRemaining = 10; // 10秒冷却时间
  btn.disabled = true;
  btn.textContent = `重载配置 (${refreshCooldownRemaining}s)`;
  btn.classList.add('disabled');

  refreshCooldownTimer = setInterval(() => {
    refreshCooldownRemaining--;
    if (refreshCooldownRemaining > 0) {
      btn.textContent = `重载配置 (${refreshCooldownRemaining}s)`;
    } else {
      // 冷却结束
      clearInterval(refreshCooldownTimer);
      refreshCooldownTimer = null;
      btn.disabled = false;
      btn.textContent = '重载配置';
      btn.classList.remove('disabled');
    }
  }, 1000);
}

// Helper: run async function while UI is locked (supports nesting via ui.setUiLocked reference count)
async function withUiLock(fn) {
  setUiLocked(true);
  try {
    return await fn();
  } finally {
    setUiLocked(false);
  }
}

async function loadNodes(showLog = true) {
  return await withUiLock(async () => {
    try {
      console.log('[DEBUG] 开始调用 getProxies API');
      const res = await window.api.getProxies();
      console.log('[DEBUG] getProxies API响应:', res);
      if (res?.ok) {
        let names = [];
        const data = res.data || {};
        console.log('[DEBUG] API响应数据:', data);
        if (Array.isArray(data.all)) {
          names = data.all;
          console.log('[DEBUG] 使用 data.all，获取到', names.length, '个节点');
        }
        else if (Array.isArray(data.nodes)) {
          names = data.nodes;
          console.log('[DEBUG] 使用 data.nodes，获取到', names.length, '个节点');
        }
        else if (Array.isArray(data.proxies)) {
          names = data.proxies.map(p => typeof p === 'string' ? p : p?.name).filter(Boolean);
          console.log('[DEBUG] 使用 data.proxies，获取到', names.length, '个节点');
        }
        else if (Array.isArray(res.all)) {
          names = res.all;
          console.log('[DEBUG] 使用 res.all，获取到', names.length, '个节点');
        } else {
          console.log('[DEBUG] 无法找到节点数组');
        }
        nodesCache = (names || []).map(n => ({ name: n, delay: null }));
        console.log(`[DEBUG] 获取到 ${nodesCache.length} 个节点:`, nodesCache.map(n => n.name));
        // 只排序：日本/台湾/香港节点排前面，其余节点保留
        const beforeCount = nodesCache.length;
        const preferredNodes = filterPreferredNodes(nodesCache);
        nodesCache = sortNodesByPreference(nodesCache);
        console.log(`[DEBUG] 筛选后剩余 ${nodesCache.length} 个节点:`, nodesCache.map(n => n.name));
        console.log('[DEBUG] 手动节点下拉即将渲染，数量=', nodesCache.length);
        if (showLog) {
          if (preferredNodes.length > 0) {
            log(`已获取节点，首选节点 ${preferredNodes.length} 个，已排序展示`);
          } else {
            log(`未匹配到首选地区节点，已显示全部 ${beforeCount} 个节点`);
          }
        }
        renderManualDropdown(nodesCache, coreType);
      } else {
        log('获取节点失败: ' + (res?.error || '未知错误'));
      }
    } catch (e) {
      log('获取节点异常: ' + (e?.message || e));
    }
  });
}

async function autoSelectBestNode() {
  if (coreType === 'singbox') return;
  if (!nodesCache.length) {
    log('无节点可测，请先重载配置');
    return;
  }

  setUiLocked(true);
  log('正在测试所有节点延时并选择最佳路线...');
  try {
    const names = nodesCache.map(n => n.name);
    const res = await window.api.testProxies(names, 'http://cp.cloudflare.com/generate_204', 5000);
    if (res?.ok) {
      const map = res.data || {};
      nodesCache = nodesCache.map(n => {
        const v = map[n.name];
        const delay = (typeof v === 'number' && v > 0) ? v : null; // 过滤无效/负数/0 延时
        return { name: n.name, delay };
      });
      // 只排序：日本/台湾/香港节点排前面，其余节点保留
      {
        const beforeCount3 = nodesCache.length;
        const preferredNodes3 = filterPreferredNodes(nodesCache);
        nodesCache = sortNodesByPreference(nodesCache);
        console.log(`[DEBUG] 自动选择前排序，${beforeCount3} -> ${nodesCache.length}`);
        if (!preferredNodes3.length) {
          log('自动选择前未匹配到首选地区节点，仍保留全部节点并排序');
        }
      }
      renderManualDropdown(nodesCache, coreType);

      const validNodes = nodesCache.filter(n => typeof n.delay === 'number' && n.delay > 0).sort((a, b) => a.delay - b.delay);
      if (validNodes.length > 0) {
        const bestNode = validNodes[0];
        log(`找到最佳节点: ${bestNode.name} (延时: ${Math.round(bestNode.delay)}ms)`);
        const selectRes = await window.api.selectProxy(bestNode.name);
        if (selectRes?.ok) {
          const sel = document.querySelector('#manual-node-select');
          if (sel) sel.value = bestNode.name;
          log(`已自动选择最佳节点: ${bestNode.name}`);
        }
      } else {
        log('自动选择节点：没有可用的有效延时结果，已跳过');
      }
    }
  } catch (e) {
    log('自动测试延时异常: ' + (e?.message || e));
  } finally {
    setUiLocked(false);
  }
}

async function ensureCoreStartedIfPossible() {
  try {
    const res = await window.api.getInitialState();
    const state = res && res.ok ? res.data : null;
    if (!state) return;
    if (state.coreRunning) return;

    if (!state.hasRuntimeConfig && !state.hasSelfConfig) {
      log('未找到可用配置，请先导入配置文件。');
      return;
    }

    log('检测到可用配置，尝试自动启动内核...');
    const r = await withUiLock(() => window.api.startCore());
    if (r?.ok) {
      log('内核启动成功');
      setTimeout(async () => {
        await loadNodes(true);
      }, 1000);
    } else {
      log('自动启动内核失败: ' + (r?.error || '未知错误'));
    }
  } catch (e) {
    // 忽略
  }
}

async function init() {
  log('正在初始化应用...');
  try {
      const res = await window.api.getInitialState();
    if (res.ok) {
      const state = res.data;
      coreType = state.coreType || 'mihomo';
      if (state.activeConfig?.configName) {
        log(`当前配置: ${state.activeConfig.configName}`);
      }
      log('应用已就绪');

      if (state.coreRunning) {
        log('内核正在运行');
        await loadNodes(false);
      } else {
        // 尝试自动启动内核（若有本地配置）——缩短等待时间以加快初始化
        setTimeout(ensureCoreStartedIfPossible, 300);
      }
    } else {
      log(`初始化失败: ${res.error}`);
    }
  } catch (e) {
    log('初始化异常: ' + (e?.message || e));
  }
}

function registerApiListeners() {
  if (window.api.onCoreStatusChanged) {
    window.api.onCoreStatusChanged(async (data) => {
      if (data.running) {
        log('内核已启动');
        (async () => {
          await loadNodes(true);
        })();
      } else if (data.error) {
        log('内核启动失败: ' + data.error);
      }
    });
  }

  if (window.api.onSubscriptionUpdated) {
    window.api.onSubscriptionUpdated(async () => {
      log('本地配置已更新，正在刷新节点列表...');
      // 立即刷新节点，随后根据路由类型尽快触发自动选择
      await loadNodes(true);
    });
  }

  if (window.api.onRefreshProviderProgress) {
    window.api.onRefreshProviderProgress((data) => {
      if (data?.message) log(data.message);
      if (data.status === 'complete') {
        loadNodes(false).then(() => {
          log(`配置已重载，共获取 ${nodesCache.length} 个节点`);
        });
      }
    });
  }

  // API 请求简述：每次主进程要向后端发请求时在状态窗口打印一行
  if (window.api.onApiRequestBrief) {
    window.api.onApiRequestBrief(({ method, url, note }) => {
      const brief = `[API] ${method} ${url}${note ? ' - ' + note : ''}`;
      log(brief);
    });
  }
  // 监听后端 API 请求开始/结束，用于在任意请求（非仅 UI 发起）期间锁定界面
  if (window.api.onApiRequestStart && window.api.onApiRequestEnd) {
    const lockUrls = ['/configs', '/proxies', '/providers/proxies', '/connections'];
    window.api.onApiRequestStart(({ method, url }) => {
      try {
        const short = (url || '').split('?')[0];
        if (lockUrls.includes(short)) {
          setUiLocked(true);
        }
      } catch (_) {}
    });
    window.api.onApiRequestEnd(({ method, url }) => {
      try {
        const short = (url || '').split('?')[0];
        if (lockUrls.includes(short)) {
          setUiLocked(false);
        }
      } catch (_) {}
    });
  }
}

function registerEventListeners() {
  // Window controls
  document.querySelector('#btn-minimize')?.addEventListener('click', () => window.api.minimizeWindow());
  document.querySelector('#btn-maximize')?.addEventListener('click', () => window.api.maximizeWindow());
  document.querySelector('#btn-close')?.addEventListener('click', () => {
    stopRefreshCooldown(); // 停止刷新冷却
    window.api.closeWindow();
  });
  document.querySelector('#btn-quit')?.addEventListener('click', () => {
    stopRefreshCooldown(); // 停止刷新冷却
    window.api.quitApp();
  });


  // 自动滚动条：仅在滚动时显示半透明，停止后隐藏
  const enableAutoScrollIndicator = (el) => {
    if (!el) return;
    let t;
    const onScroll = () => {
      el.classList.add('scrolling');
      if (t) clearTimeout(t);
      t = setTimeout(() => el.classList.remove('scrolling'), 700);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
  };
  enableAutoScrollIndicator(document.querySelector('.container'));
  enableAutoScrollIndicator(document.querySelector('#status'));

  const refreshBtn = document.querySelector('#btn-refresh-provider');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (refreshCooldownRemaining > 0) {
        log('重载配置正在冷却中，请等待 ' + refreshCooldownRemaining + ' 秒');
        return;
      }
      await withUiLock(async () => {
        log('开始重载当前配置并执行完整启动流程...');
        try {
          const initRes = await window.api.getInitialState();
          const hasRuntimeConfig = initRes?.ok ? !!initRes.data.hasRuntimeConfig : false;
          const hasSelfConfig = initRes?.ok ? !!initRes.data.hasSelfConfig : false;

          if (!hasRuntimeConfig && !hasSelfConfig) {
            log('未找到可用配置，无法继续重载流程');
            return;
          }
          log('读取到当前配置文件');

          const startRes = await window.api.startCore();
          if (!startRes?.ok) {
            log('重启内核失败: ' + (startRes?.error || '未知错误'));
            return;
          }
          log('内核重启成功');

          await new Promise(resolve => setTimeout(resolve, 1000));
          log('获取节点列表...');
          await loadNodes(true);
          log('选择最优节点...');
          await autoSelectBestNode();
        } catch (e) {
          log('一键流程发生异常: ' + (e?.message || e));
        }
      });
    });
  }

  const testBtn = document.querySelector('#btn-test-delay');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      await autoSelectBestNode();
    });
  }

  const importBtn = document.querySelector('#btn-import-config');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      await withUiLock(async () => {
        log('正在选择并导入配置文件...');
        const r = await window.api.pickAndImportConfig();
        if (r?.ok) {
          const name = r.data?.configName || '配置文件';
          log(`已导入配置: ${name}`);
          await window.api.startCore().catch(() => null);
          await loadNodes(true).catch(() => null);
        } else if (r?.error && r.error !== '已取消选择') {
          log('导入配置失败: ' + r.error);
        }
      });
    });
  }

  const manualSel = document.querySelector('#manual-node-select');
  if (manualSel) {
    manualSel.addEventListener('change', async (e) => {
      await withUiLock(async () => {
        const name = e.target.value;
        if (!name) return;
        log('切换到手动节点: ' + name + ' ...');
        const r = await window.api.selectProxy(name);
        if (!r?.ok) {
          log('切换节点失败: ' + (r?.error || '未知错误'));
        }
      });
    });
  }
}

// Application entry point
document.addEventListener('DOMContentLoaded', () => {
  init();
  registerApiListeners();
  registerEventListeners();
});
