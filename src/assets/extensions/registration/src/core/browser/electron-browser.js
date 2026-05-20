const fs = require('fs-extra');
const os = require('os');
const path = require('path');

function loadPlaywrightElectron() {
    const candidates = [
        'playwright',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright') : null,
        'playwright-core',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright-core') : null
    ].filter(Boolean);

    const errors = [];

    for (const candidate of candidates) {
        try {
            const mod = require(candidate);
            if (mod && mod._electron) {
                return mod._electron;
            }
        } catch (error) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    throw new Error(`无法加载 Playwright Electron: ${errors.join(' | ')}`);
}

function resolveBuiltinElectronHelperMainPath() {
    return path.join(__dirname, 'electron-helper', 'main.js');
}

function resolveBuiltinElectronLaunchCommandPath() {
    return path.join(__dirname, 'electron-helper', 'launch.cmd');
}

function resolvePlaywrightElectronLoaderPath() {
    try {
        const playwrightCorePackagePath = require.resolve('playwright-core/package.json');
        const playwrightCoreRoot = path.dirname(playwrightCorePackagePath);
        const loaderPath = path.join(playwrightCoreRoot, 'lib', 'server', 'electron', 'loader.js');
        if (fs.existsSync(loaderPath)) {
            return loaderPath;
        }
    } catch (_error) {
    }

    try {
        const playwrightPackagePath = require.resolve('playwright/package.json');
        const playwrightRoot = path.dirname(playwrightPackagePath);
        const loaderPath = path.join(playwrightRoot, 'node_modules', 'playwright-core', 'lib', 'server', 'electron', 'loader.js');
        if (fs.existsSync(loaderPath)) {
            return loaderPath;
        }
    } catch (_error) {
    }

    throw new Error('无法解析 Playwright Electron loader 路径');
}

function buildElectronLaunchArgs(browserProfile = {}, helperMainPath = '', playwrightLoaderPath = '', windowWidth = 1366, windowHeight = 768, headless = false, browserOptions = {}) {
    const launchArgs = [
        '-r',
        playwrightLoaderPath,
        helperMainPath,
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--password-store=basic',
        '--force-color-profile=srgb',
        '--disable-blink-features=AutomationControlled',
        `--lang=${String(browserProfile.locale || 'en-US')}`,
        `--window-size=${windowWidth},${windowHeight}`
    ];

    if (headless) {
        launchArgs.push('--disable-gpu');
    }

    if (process.platform === 'linux') {
        launchArgs.unshift('--no-sandbox');
    }

    if (Array.isArray(browserOptions.args) && browserOptions.args.length > 0) {
        launchArgs.push(...browserOptions.args.map(arg => String(arg)));
    }

    return launchArgs;
}

function patchPageContext(page, contextAdapter) {
    if (!page || typeof page !== 'object') {
        return;
    }

    try {
        Object.defineProperty(page, 'context', {
            value: () => contextAdapter,
            configurable: true
        });
        return;
    } catch (_error) {
    }

    try {
        page.context = () => contextAdapter;
    } catch (_error) {
    }
}

function isHttpLikeUrl(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return false;
    }

    try {
        const parsed = new URL(text);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
        return false;
    }
}

function normalizeElectronCookie(cookie = {}, fallbackUrl = '') {
    const domain = String(cookie.domain || '').trim();
    const pathValue = String(cookie.path || '/').trim() || '/';
    const explicitUrl = String(cookie.url || '').trim();
    const sameSiteText = String(cookie.sameSite || '').trim().toLowerCase();
    let secure = cookie.secure === true || sameSiteText === 'none' || sameSiteText === 'no_restriction';
    let url = explicitUrl;
    const isLocalNetworkHost = (hostname = '') => {
        const host = String(hostname || '').trim().toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(host);
    };
    const preferHttpsForHost = (hostname = '') => !isLocalNetworkHost(hostname);

    const applySecureScheme = (inputUrl = '') => {
        const text = String(inputUrl || '').trim();
        if (!text) {
            return text;
        }

        try {
            const parsed = new URL(text);
            if (parsed.protocol === 'http:' && preferHttpsForHost(parsed.hostname)) {
                parsed.protocol = 'https:';
                secure = true;
            } else if (secure && parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }
            return parsed.toString();
        } catch (_error) {
            return text;
        }
    };

    if (url && !isHttpLikeUrl(url)) {
        url = '';
    } else if (url) {
        url = applySecureScheme(url);
    }

    if (!url && domain) {
        const normalizedDomain = domain.startsWith('.') ? domain.slice(1) : domain;
        const useHttps = preferHttpsForHost(normalizedDomain) || secure;
        if (useHttps) {
            secure = true;
        }
        url = `${useHttps ? 'https' : 'http'}://${normalizedDomain}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
    }

    if (!url && fallbackUrl && isHttpLikeUrl(fallbackUrl)) {
        try {
            const parsed = new URL(fallbackUrl);
            if (parsed.protocol === 'http:' && preferHttpsForHost(parsed.hostname)) {
                parsed.protocol = 'https:';
                secure = true;
            } else if (secure && parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }
            url = `${parsed.protocol}//${parsed.hostname}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
        } catch (_error) {
        }
    }

    if (!url) {
        return null;
    }

    const normalized = {
        name: String(cookie.name || '').trim(),
        value: String(cookie.value || ''),
        url,
        secure,
        httpOnly: cookie.httpOnly === true
    };
    if (domain) {
        normalized.domain = domain;
    }
    if (pathValue) {
        normalized.path = pathValue;
    }

    if (cookie.expires !== undefined && cookie.expires !== null) {
        const rawExpires = Number(cookie.expires);
        if (Number.isFinite(rawExpires) && rawExpires > 0) {
            const expirationDate = rawExpires > 1e12 ? Math.floor(rawExpires / 1000) : Math.floor(rawExpires);
            if (expirationDate <= Math.floor(Date.now() / 1000)) {
                return null;
            }
            normalized.expirationDate = expirationDate;
        }
    }

    if (sameSiteText === 'lax') {
        normalized.sameSite = 'lax';
    } else if (sameSiteText === 'strict') {
        normalized.sameSite = 'strict';
    } else if (sameSiteText === 'none' || sameSiteText === 'no_restriction') {
        normalized.sameSite = 'no_restriction';
    } else if (sameSiteText === 'unspecified') {
        normalized.sameSite = 'unspecified';
    }

    return normalized;
}

function buildBuiltinBrowserToolbarInitScript() {
    return `
(() => {
  if (window.__builtinBrowserToolbarInstalled) {
    return;
  }

  const TOOLBAR_ID = '__builtin_browser_toolbar__';
  const TOOLBAR_HEIGHT = 56;
  const ROOT_GAP_ATTRIBUTE = 'data-builtin-browser-root-gap';

  const normalizeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(raw)) {
      return raw;
    }

    return 'https://' + raw.replace(/^\\/+/, '');
  };

  const ensureVisible = (element) => {
    if (!element) {
      return;
    }

    try {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_error) {
    }
  };

  const install = () => {
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) {
      return existing;
    }

    const host = document.createElement('div');
    host.id = TOOLBAR_ID;
    host.style.cssText = [
      'position: sticky',
      'top: 0',
      'left: 0',
      'right: 0',
      'height: ' + TOOLBAR_HEIGHT + 'px',
      'z-index: 2147483647',
      'pointer-events: auto',
      'display: block',
      'width: 100%',
      'box-sizing: border-box'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<style>',
      ':host { all: initial; }',
      '.browser-toolbar {',
      '  height: ' + TOOLBAR_HEIGHT + 'px;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  box-sizing: border-box;',
      '  padding: 8px 10px;',
      '  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 248, 252, 0.97));',
      '  border-bottom: 1px solid rgba(110, 126, 156, 0.24);',
      '  backdrop-filter: blur(14px);',
      '  -webkit-backdrop-filter: blur(14px);',
      '  color: #1f2937;',
      '  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      '.browser-toolbar button {',
      '  appearance: none;',
      '  border: 1px solid rgba(120, 136, 160, 0.28);',
      '  background: rgba(255, 255, 255, 0.92);',
      '  color: inherit;',
      '  width: 34px;',
      '  height: 34px;',
      '  border-radius: 10px;',
      '  font-size: 16px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;',
      '}',
      '.browser-toolbar button:hover:not(:disabled) {',
      '  background: rgba(243, 246, 250, 1);',
      '  border-color: rgba(88, 102, 126, 0.42);',
      '  transform: translateY(-1px);',
      '}',
      '.browser-toolbar button:disabled {',
      '  opacity: 0.42;',
      '  cursor: not-allowed;',
      '}',
      '.browser-toolbar .browser-url {',
      '  flex: 1;',
      '  min-width: 0;',
      '  height: 34px;',
      '  border-radius: 10px;',
      '  border: 1px solid rgba(120, 136, 160, 0.28);',
      '  background: rgba(255, 255, 255, 0.98);',
      '  color: inherit;',
      '  padding: 0 12px;',
      '  font-size: 14px;',
      '  outline: none;',
      '  box-sizing: border-box;',
      '}',
      '.browser-toolbar .browser-url:focus {',
      '  border-color: rgba(59, 130, 246, 0.55);',
      '  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);',
      '}',
      '.browser-toolbar .browser-go {',
      '  width: auto;',
      '  min-width: 56px;',
      '  padding: 0 14px;',
      '  font-size: 13px;',
      '  font-weight: 600;',
      '}',
      '</style>',
      '<div class="browser-toolbar">',
      '<button type="button" class="browser-back" title="后退" aria-label="后退">←</button>',
      '<button type="button" class="browser-forward" title="前进" aria-label="前进">→</button>',
      '<button type="button" class="browser-reload" title="刷新" aria-label="刷新">↻</button>',
      '<input class="browser-url" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="输入网址并回车打开">',
      '<button type="button" class="browser-go">打开</button>',
      '</div>'
    ].join('');

    const backBtn = shadow.querySelector('.browser-back');
    const forwardBtn = shadow.querySelector('.browser-forward');
    const reloadBtn = shadow.querySelector('.browser-reload');
    const urlInput = shadow.querySelector('.browser-url');
    const goBtn = shadow.querySelector('.browser-go');

    const syncState = () => {
      try {
        if (urlInput) {
          urlInput.value = String(window.location.href || '');
        }
        if (backBtn) {
          backBtn.disabled = !(window.history && window.history.length > 1);
        }
        if (forwardBtn) {
          forwardBtn.disabled = false;
        }
      } catch (_error) {
      }
    };

    const navigate = (value) => {
      const nextUrl = normalizeUrl(value);
      if (!nextUrl) {
        return;
      }

      try {
        window.location.href = nextUrl;
      } catch (_error) {
      }
    };

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        try {
          window.history.back();
        } catch (_error) {
        }
      });
    }

    if (forwardBtn) {
      forwardBtn.addEventListener('click', () => {
        try {
          window.history.forward();
        } catch (_error) {
        }
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        try {
          window.location.reload();
        } catch (_error) {
        }
      });
    }

    const triggerNavigate = () => {
      navigate(urlInput ? urlInput.value : '');
      ensureVisible(urlInput);
    };

    if (urlInput) {
      urlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          triggerNavigate();
        }
      });
    }

    if (goBtn) {
      goBtn.addEventListener('click', triggerNavigate);
    }

    window.addEventListener('hashchange', syncState, true);
    window.addEventListener('pageshow', syncState, true);
    window.addEventListener('popstate', syncState, true);
    window.addEventListener('load', syncState, true);

    document.addEventListener('DOMContentLoaded', () => {
      syncState();
    }, { once: true });

    syncState();

    window.__builtinBrowserToolbarInstalled = true;
    window.__builtinBrowserToolbarSyncState = syncState;
    window.__builtinBrowserToolbarNavigate = navigate;

    return host;
  };

  const reserveRootGap = () => {
    const root = document.body || document.documentElement;
    if (!root) {
      return;
    }

    try {
      const marker = root.getAttribute(ROOT_GAP_ATTRIBUTE);
      if (marker === String(TOOLBAR_HEIGHT)) {
        return;
      }

      const computedStyle = typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(root)
        : null;
      const currentPaddingBottom = computedStyle ? parseFloat(computedStyle.paddingBottom || '0') || 0 : 0;
      const currentMinHeight = computedStyle ? parseFloat(computedStyle.minHeight || '0') || 0 : 0;

      root.style.boxSizing = 'border-box';
      root.style.paddingBottom = String(currentPaddingBottom + TOOLBAR_HEIGHT) + 'px';
      root.style.minHeight = 'calc(' + (currentMinHeight > 0 ? String(currentMinHeight) + 'px' : '100%') + ' + ' + TOOLBAR_HEIGHT + 'px)';
      root.setAttribute(ROOT_GAP_ATTRIBUTE, String(TOOLBAR_HEIGHT));
    } catch (_error) {
    }
  };

  const attach = () => {
    const host = install();
    reserveRootGap();
    const parent = document.body || document.documentElement;
    if (host && !host.isConnected && parent) {
      if (parent.firstChild) {
        parent.insertBefore(host, parent.firstChild);
      } else {
        parent.appendChild(host);
      }
    }
    if (typeof window.__builtinBrowserToolbarSyncState === 'function') {
      window.__builtinBrowserToolbarSyncState();
    }
  };

  if (document.documentElement) {
    attach();
  } else {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
})();
    `;
}

function buildBuiltinElementInspectorInitScript() {
    return `
(() => {
  if (window.__builtinElementInspectorInstalled) {
    return;
  }

  const INSPECTOR_WINDOW_NAME = '__builtin_element_inspector__';
  const INSPECTOR_WINDOW_WIDTH = 1180;
  const INSPECTOR_WINDOW_HEIGHT = 780;
  const HISTORY_LIMIT = 120;
  const state = {
    enabled: false,
    windowRef: null,
    rows: [],
    index: 0
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const escapeCss = (value) => {
    try {
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        return CSS.escape(String(value || ''));
      }
    } catch (_error) {
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };

  const cleanText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

  const buildSelector = (element) => {
    if (!element || element.nodeType !== 1) {
      return '';
    }

    if (element.id) {
      return '#' + escapeCss(element.id);
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const tagName = String(current.tagName || '').toLowerCase();
      if (!tagName) {
        break;
      }

      let selector = tagName;
      const classList = Array.from(current.classList || []).slice(0, 3).filter(Boolean);
      if (classList.length > 0) {
        selector += '.' + classList.map((item) => escapeCss(item)).join('.');
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children || []).filter((child) => String(child.tagName || '').toLowerCase() === tagName);
        if (sameTagSiblings.length > 1) {
          selector += ':nth-of-type(' + (sameTagSiblings.indexOf(current) + 1) + ')';
        }
      }

      parts.unshift(selector);
      if (current.id) {
        break;
      }
      current = current.parentElement;
    }

    return parts.join(' > ');
  };

  const buildStableSelector = (element) => {
    if (!element || element.nodeType !== 1) {
      return '';
    }

    const tagName = String(element.tagName || '').toLowerCase();
    const text = cleanText(
      element?.innerText
      || element?.textContent
      || element?.value
      || element?.getAttribute?.('aria-label')
      || element?.getAttribute?.('placeholder')
      || ''
    );
    const quotedText = text ? '"' + String(text).replace(/"/g, '\\"').slice(0, 80) + '"' : '';
    const stableAttributes = [
      ['data-testid', element?.getAttribute?.('data-testid') || ''],
      ['data-test', element?.getAttribute?.('data-test') || ''],
      ['data-qa', element?.getAttribute?.('data-qa') || ''],
      ['data-cy', element?.getAttribute?.('data-cy') || ''],
      ['name', element?.getAttribute?.('name') || ''],
      ['aria-label', element?.getAttribute?.('aria-label') || ''],
      ['title', element?.getAttribute?.('title') || ''],
      ['placeholder', element?.getAttribute?.('placeholder') || '']
    ];

    if (element.id) {
      return '#' + escapeCss(element.id);
    }

    for (const [attrName, attrValue] of stableAttributes) {
      const value = cleanText(attrValue);
      if (!value) {
        continue;
      }
      return tagName
        ? tagName + '[' + attrName + '="' + String(value).replace(/"/g, '\\"') + '"]'
        : '[' + attrName + '="' + String(value).replace(/"/g, '\\"') + '"]';
    }

    if (tagName === 'button' || tagName === 'a' || tagName === 'label' || tagName === 'div' || tagName === 'span') {
      if (quotedText) {
        return tagName + ':has-text(' + quotedText + ')';
      }
    }

    if (tagName === 'input' || tagName === 'textarea') {
      const value = cleanText(element?.getAttribute?.('value') || element?.value || '');
      if (value) {
        return tagName + '[value="' + String(value).replace(/"/g, '\\"') + '"]';
      }
    }

    return buildSelector(element);
  };

  const buildXPath = (element) => {
    if (!element || element.nodeType !== 1) {
      return '';
    }

    if (element.id) {
      return '//*[@id="' + String(element.id).replace(/"/g, '\\"') + '"]';
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === 1) {
      const tagName = String(current.tagName || '').toLowerCase();
      if (!tagName) {
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (String(sibling.tagName || '').toLowerCase() === tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }

      parts.unshift(tagName + '[' + index + ']');
      current = current.parentElement;
    }

    return '/' + parts.join('/');
  };

  const describeElement = (element) => {
    const tagName = String(element?.tagName || '').toLowerCase();
    const text = cleanText(
      element?.innerText
      || element?.textContent
      || element?.value
      || element?.getAttribute?.('aria-label')
      || element?.getAttribute?.('placeholder')
      || ''
    );
    const rect = element && typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;

    return {
      index: ++state.index,
      eventType: 'click',
      tagName: tagName || '-',
      text: text || '-',
      selector: buildSelector(element) || '-',
      stableSelector: buildStableSelector(element) || '-',
      xpath: buildXPath(element) || '-',
      id: cleanText(element?.id || ''),
      className: cleanText(element?.className || ''),
      href: cleanText(element?.href || ''),
      title: cleanText(element?.getAttribute?.('title') || ''),
      name: cleanText(element?.getAttribute?.('name') || ''),
      role: cleanText(element?.getAttribute?.('role') || ''),
      value: cleanText(element?.value || element?.getAttribute?.('value') || ''),
      coordinates: rect ? Math.round(rect.left) + ', ' + Math.round(rect.top) : '-',
      size: rect ? Math.round(rect.width) + ' × ' + Math.round(rect.height) : '-',
      timestamp: new Date().toLocaleTimeString()
    };
  };

  const buildInspectorHtml = () => [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>元素获取窗口</title>',
    '<style>',
    'html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0f172a; color: #e5eefc; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }',
    'body { display: flex; flex-direction: column; }',
    '.header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; background: linear-gradient(180deg, rgba(19, 28, 48, 0.98), rgba(15, 23, 42, 0.96)); border-bottom: 1px solid rgba(148, 163, 184, 0.18); }',
    '.title h1 { margin: 0; font-size: 18px; font-weight: 700; }',
    '.title .subtitle { margin-top: 4px; font-size: 12px; color: #94a3b8; }',
    '.status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(34, 197, 94, 0.12); color: #86efac; font-size: 12px; font-weight: 600; white-space: nowrap; }',
    '.content { flex: 1; display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 14px; padding: 14px; min-height: 0; box-sizing: border-box; }',
    '.panel { background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 16px; box-shadow: 0 16px 44px rgba(15, 23, 42, 0.24); min-height: 0; overflow: hidden; }',
    '.panel-head { padding: 14px 16px 10px; border-bottom: 1px solid rgba(148, 163, 184, 0.12); color: #cbd5e1; font-weight: 700; font-size: 14px; }',
    '.panel-body { padding: 14px 16px; overflow: auto; height: calc(100% - 47px); box-sizing: border-box; }',
    '.detail-grid { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px 12px; font-size: 13px; }',
    '.detail-key { color: #94a3b8; }',
    '.detail-value { color: #f8fafc; word-break: break-all; }',
    '.detail-empty { color: #64748b; }',
    '.history-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }',
    '.history-table th, .history-table td { border-bottom: 1px solid rgba(148, 163, 184, 0.12); padding: 8px 8px; vertical-align: top; text-align: left; word-break: break-all; }',
    '.history-table th { position: sticky; top: 0; background: rgba(15, 23, 42, 0.98); color: #cbd5e1; z-index: 1; }',
    '.history-index { width: 52px; color: #93c5fd; font-weight: 700; }',
    '.history-time { width: 88px; color: #94a3b8; }',
    '.history-event { width: 72px; color: #fda4af; }',
    '.history-row.current { background: rgba(59, 130, 246, 0.12); }',
    '.history-empty { padding: 18px 0; color: #64748b; text-align: center; }',
    '.hint { color: #94a3b8; font-size: 12px; margin-top: 10px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="header">',
    '<div class="title">',
    '<h1>元素获取窗口</h1>',
    '<div class="subtitle">按 F12 开启或关闭抓取，点击网页内容后这里会按列追加点击流程</div>',
    '</div>',
    '<div id="builtin-element-inspector-status" class="status">未开启抓取</div>',
    '</div>',
    '<div class="content">',
    '<section class="panel">',
    '<div class="panel-head">当前点击元素</div>',
    '<div class="panel-body" id="builtin-element-current">等待第一次点击</div>',
    '</section>',
    '<section class="panel">',
    '<div class="panel-head">点击流程</div>',
    '<div class="panel-body" style="padding:0;">',
    '<table class="history-table">',
    '<thead><tr>',
    '<th class="history-index">序号</th>',
    '<th class="history-time">时间</th>',
    '<th class="history-event">操作</th>',
    '<th>标签</th>',
    '<th>文本</th>',
    '<th>通用选择器</th>',
    '<th>选择器</th>',
    '<th>XPath</th>',
    '<th>坐标</th>',
    '<th>尺寸</th>',
    '</tr></thead>',
    '<tbody id="builtin-element-history"></tbody>',
    '</table>',
    '</div>',
    '</section>',
    '</div>',
    '</body>',
    '</html>'
  ].join('');

  const renderState = () => {
    const win = state.windowRef;
    if (!win || win.closed) {
      state.windowRef = null;
      return;
    }

    try {
      const doc = win.document;
      if (!doc || !doc.body) {
        return;
      }

      const current = state.rows[state.rows.length - 1] || null;
      const currentContainer = doc.getElementById('builtin-element-current');
      const historyBody = doc.getElementById('builtin-element-history');
      const status = doc.getElementById('builtin-element-inspector-status');

      if (status) {
        status.textContent = state.enabled ? '抓取中' : '已暂停';
      }

      if (currentContainer) {
        if (!current) {
          currentContainer.innerHTML = '<div class="detail-empty">等待第一次点击</div>';
        } else {
          currentContainer.innerHTML = [
            '<div class="detail-grid">',
            '<div class="detail-key">序号</div><div class="detail-value">#' + current.index + '</div>',
            '<div class="detail-key">时间</div><div class="detail-value">' + escapeHtml(current.timestamp) + '</div>',
            '<div class="detail-key">操作</div><div class="detail-value">' + escapeHtml(current.eventType) + '</div>',
            '<div class="detail-key">标签</div><div class="detail-value">' + escapeHtml(current.tagName) + '</div>',
            '<div class="detail-key">文本</div><div class="detail-value">' + escapeHtml(current.text) + '</div>',
            '<div class="detail-key">通用选择器</div><div class="detail-value">' + escapeHtml(current.stableSelector) + '</div>',
            '<div class="detail-key">选择器</div><div class="detail-value">' + escapeHtml(current.selector) + '</div>',
            '<div class="detail-key">XPath</div><div class="detail-value">' + escapeHtml(current.xpath) + '</div>',
            '<div class="detail-key">ID</div><div class="detail-value">' + escapeHtml(current.id || '-') + '</div>',
            '<div class="detail-key">Class</div><div class="detail-value">' + escapeHtml(current.className || '-') + '</div>',
            '<div class="detail-key">名称</div><div class="detail-value">' + escapeHtml(current.name || '-') + '</div>',
            '<div class="detail-key">角色</div><div class="detail-value">' + escapeHtml(current.role || '-') + '</div>',
            '<div class="detail-key">值</div><div class="detail-value">' + escapeHtml(current.value || '-') + '</div>',
            '<div class="detail-key">坐标</div><div class="detail-value">' + escapeHtml(current.coordinates || '-') + '</div>',
            '<div class="detail-key">尺寸</div><div class="detail-value">' + escapeHtml(current.size || '-') + '</div>',
            '</div>',
            '<div class="hint">元素信息会随着每次点击持续追加到右侧流程表中。</div>'
          ].join('');
        }
      }

      if (historyBody) {
        if (!state.rows.length) {
          historyBody.innerHTML = '<tr><td colspan="10"><div class="history-empty">暂无点击记录</div></td></tr>';
        } else {
          historyBody.innerHTML = state.rows.map((record) => [
            '<tr class="history-row' + (current && current.index === record.index ? ' current' : '') + '">',
            '<td class="history-index">#' + record.index + '</td>',
            '<td class="history-time">' + escapeHtml(record.timestamp) + '</td>',
            '<td class="history-event">' + escapeHtml(record.eventType) + '</td>',
            '<td>' + escapeHtml(record.tagName) + '</td>',
            '<td>' + escapeHtml(record.text) + '</td>',
            '<td>' + escapeHtml(record.stableSelector) + '</td>',
            '<td>' + escapeHtml(record.selector) + '</td>',
            '<td>' + escapeHtml(record.xpath) + '</td>',
            '<td>' + escapeHtml(record.coordinates) + '</td>',
            '<td>' + escapeHtml(record.size) + '</td>',
            '</tr>'
          ].join('')).join('');
        }
      }
    } catch (_error) {
    }
  };

  const openInspectorWindow = () => {
    try {
      if (state.windowRef && !state.windowRef.closed) {
        state.windowRef.focus();
        renderState();
        return true;
      }
    } catch (_error) {
      state.windowRef = null;
    }

    try {
      const nextWindow = window.open('', INSPECTOR_WINDOW_NAME, 'width=' + INSPECTOR_WINDOW_WIDTH + ',height=' + INSPECTOR_WINDOW_HEIGHT + ',resizable=yes,scrollbars=yes,noopener=no');
      if (!nextWindow) {
        return false;
      }

      state.windowRef = nextWindow;
      nextWindow.document.open();
      nextWindow.document.write(buildInspectorHtml());
      nextWindow.document.close();
      nextWindow.focus();
      nextWindow.addEventListener('beforeunload', () => {
        state.enabled = false;
        state.windowRef = null;
      }, { once: true });

      renderState();
      return true;
    } catch (_error) {
      state.windowRef = null;
      return false;
    }
  };

  const closeInspectorWindow = () => {
    try {
      if (state.windowRef && !state.windowRef.closed) {
        state.windowRef.close();
      }
    } catch (_error) {
    }
    state.windowRef = null;
  };

  const recordClick = (event) => {
    if (!state.enabled) {
      return;
    }

    const target = event && event.target && event.target.nodeType === 1
      ? event.target
      : event && event.target && event.target.parentElement
        ? event.target.parentElement
        : null;

    if (!target) {
      return;
    }

    state.rows.push(describeElement(target));
    if (state.rows.length > HISTORY_LIMIT) {
      state.rows.splice(0, state.rows.length - HISTORY_LIMIT);
    }

    openInspectorWindow();
    renderState();
  };

  const handleKeydown = (event) => {
    if (String(event?.key || '').toLowerCase() !== 'f12') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    state.enabled = !state.enabled;
    if (state.enabled) {
      openInspectorWindow();
    } else {
      closeInspectorWindow();
    }

    renderState();
  };

  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', recordClick, true);
  window.addEventListener('beforeunload', () => {
    state.enabled = false;
    state.windowRef = null;
  });

  window.__builtinElementInspectorInstalled = true;
})();
    `;
}

class BuiltinElectronBrowserContextAdapter {
    constructor(options = {}) {
        this._electronApp = options.electronApp || null;
        this._actualContext = options.actualContext || null;
        this._logger = options.logger || console;
        this._userDataDir = String(options.userDataDir || '').trim();
        this._launchTimeout = Number.isFinite(parseInt(options.launchTimeout, 10))
            ? Math.max(0, parseInt(options.launchTimeout, 10))
            : 30000;
        this._windowWidth = Number.isFinite(parseInt(options.windowWidth, 10))
            ? Math.max(320, parseInt(options.windowWidth, 10))
            : 1366;
        this._windowHeight = Number.isFinite(parseInt(options.windowHeight, 10))
            ? Math.max(240, parseInt(options.windowHeight, 10))
            : 768;
        this._visible = options.visible !== false;
        this._offscreen = options.offscreen === true;
        this._browserId = String(options.browserId || '').trim();
        this._browserKind = String(options.browserKind || '').trim().toLowerCase();
        this._closed = false;
        this._pages = new Set();
        this._pageOrder = [];

        if (this._electronApp && typeof this._electronApp.on === 'function') {
            this._electronApp.on('window', (page) => {
                this._registerPage(page);
            });

            this._electronApp.on('close', () => {
                this._closed = true;
            });
        }

        if (this._actualContext && typeof this._actualContext.on === 'function') {
            this._actualContext.on('page', (page) => {
                this._registerPage(page);
            });

            this._actualContext.on('close', () => {
                this._closed = true;
            });
        }
    }

    isClosed() {
        return this._closed === true;
    }

    _registerPage(page) {
        if (!page || this._pages.has(page)) {
            return page || null;
        }

        this._pages.add(page);
        this._pageOrder = this._pageOrder.filter(item => item && item !== page);
        this._pageOrder.push(page);
        patchPageContext(page, this);

        if (typeof page.on === 'function') {
            page.on('close', () => {
                this._pages.delete(page);
                this._pageOrder = this._pageOrder.filter(item => item && item !== page);
                if (this._pageOrder.length === 0 && this._logger && typeof this._logger.debug === 'function') {
                    this._logger.debug(`Electron 内置浏览器页面已全部关闭${this._browserId ? `: ${this._browserId}` : ''}`);
                }
            });
        }

        return page;
    }

    _collectPages() {
        const pages = [];
        const seen = new Set();
        const pushPage = (page) => {
            if (!page || seen.has(page)) {
                return;
            }

            seen.add(page);
            if (typeof page.isClosed === 'function' && page.isClosed()) {
                return;
            }

            pages.push(page);
            this._registerPage(page);
        };

        if (this._actualContext && typeof this._actualContext.pages === 'function') {
            try {
                for (const page of this._actualContext.pages()) {
                    pushPage(page);
                }
            } catch (_error) {
            }
        }

        for (const page of this._pageOrder) {
            pushPage(page);
        }

        return pages;
    }

    pages() {
        return this._collectPages();
    }

    async newPage(options = {}) {
        if (this.isClosed()) {
            throw new Error('内置 Electron 浏览器上下文已关闭');
        }

        if (this._actualContext && typeof this._actualContext.newPage === 'function') {
            const page = await this._actualContext.newPage(options);
            return this._registerPage(page);
        }

        if (!this._electronApp || typeof this._electronApp.evaluate !== 'function') {
            throw new Error('Electron 浏览器无法创建新页面');
        }

        const waitForWindow = typeof this._electronApp.waitForEvent === 'function'
            ? this._electronApp.waitForEvent('window', { timeout: this._launchTimeout })
            : Promise.reject(new Error('Electron 浏览器无法监听新窗口'));

        await this._electronApp.evaluate(({ BrowserWindow }, payload) => {
            const win = new BrowserWindow({
                width: payload.width,
                height: payload.height,
                x: payload.offscreen ? -32000 : undefined,
                y: payload.offscreen ? -32000 : undefined,
                show: payload.visible !== false,
                skipTaskbar: payload.offscreen === true,
                autoHideMenuBar: true,
                backgroundColor: '#ffffff',
                devTools: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false,
                    nativeWindowOpen: true
                }
            });

            if (win && win.webContents && typeof win.webContents.on === 'function') {
                win.webContents.on('before-input-event', (event, input) => {
                    const key = String(input?.key || '').toLowerCase();
                    const isF12Shortcut = key === 'f12';
                    const isDevToolsShortcut =
                        isF12Shortcut ||
                        ((input.control || input.meta) && input.shift && key === 'i');

                    if (!isDevToolsShortcut) {
                        return;
                    }

                    try {
                        if (win.webContents.isDevToolsOpened()) {
                            win.webContents.closeDevTools();
                        } else {
                            win.webContents.openDevTools({ mode: 'bottom' });
                        }
                    } catch (_error) {
                    }

                    if (!isF12Shortcut) {
                        event.preventDefault();
                    }
                });
            }

            win.loadURL('about:blank').catch(() => {});
        }, {
            width: Number.isFinite(options.width) ? options.width : this._windowWidth,
            height: Number.isFinite(options.height) ? options.height : this._windowHeight,
            visible: this._visible,
            offscreen: this._offscreen
        });

        const page = await waitForWindow;
        return this._registerPage(page);
    }

    async cookies(urls) {
        if (this._browserKind === 'electron' && this._electronApp && typeof this._electronApp.evaluate === 'function') {
            try {
                return await this._electronApp.evaluate(async ({ session }, inputUrls) => {
                    const targetSession = session && session.defaultSession ? session.defaultSession : session;
                    if (!targetSession || !targetSession.cookies || typeof targetSession.cookies.get !== 'function') {
                        return [];
                    }

                    if (!Array.isArray(inputUrls) || inputUrls.length === 0) {
                        return await targetSession.cookies.get({});
                    }

                    const collected = [];
                    const seen = new Set();
                    for (const inputUrl of inputUrls) {
                        const normalizedUrl = String(inputUrl || '').trim();
                        if (!normalizedUrl) {
                            continue;
                        }
                        const items = await targetSession.cookies.get({ url: normalizedUrl });
                        for (const item of Array.isArray(items) ? items : []) {
                            const cookieKey = `${item.name || ''}||${item.domain || ''}||${item.path || ''}`;
                            if (seen.has(cookieKey)) {
                                continue;
                            }
                            seen.add(cookieKey);
                            collected.push(item);
                        }
                    }
                    return collected;
                }, Array.isArray(urls) ? urls : []);
            } catch (error) {
                this._logger?.warning?.(`读取内置 Electron 浏览器 Cookie 失败: ${error.message}`);
                return [];
            }
        }

        if (!this._actualContext || typeof this._actualContext.cookies !== 'function') {
            return [];
        }

        return await this._actualContext.cookies(urls);
    }

    async addCookies(cookies = []) {
        if (!Array.isArray(cookies) || cookies.length === 0) {
            return true;
        }

        if (this._browserKind === 'electron' && this._electronApp && typeof this._electronApp.evaluate === 'function') {
            const fallbackUrl = this._pageOrder.length > 0 && typeof this._pageOrder[0]?.url === 'function'
                ? this._pageOrder[0].url()
                : '';

            try {
                const normalizedCookies = cookies
                    .map(cookie => normalizeElectronCookie(cookie, fallbackUrl))
                    .filter(Boolean);

                if (normalizedCookies.length === 0) {
                    this._logger?.warning?.('内置 Electron 浏览器没有可注入的有效 Cookie');
                    return false;
                }

                await this._electronApp.evaluate(async ({ session }, payload) => {
                    const targetSession = session && session.defaultSession ? session.defaultSession : session;
                    if (!targetSession || !targetSession.cookies || typeof targetSession.cookies.set !== 'function') {
                        throw new Error('Electron session 不支持 Cookie 注入');
                    }

                    const cloneForRetry = (cookie, dropSameSite = false, dropExpirationDate = false) => {
                        const cloned = { ...cookie };
                        if (dropSameSite) {
                            delete cloned.sameSite;
                        }
                        if (dropExpirationDate) {
                            delete cloned.expirationDate;
                        }
                        return cloned;
                    };

                    const setCookieWithRetry = async (cookie) => {
                        const attempts = [
                            cookie,
                            cloneForRetry(cookie, true, false),
                            cloneForRetry(cookie, true, true)
                        ];

                        let lastError = null;
                        for (const attempt of attempts) {
                            try {
                                const candidate = { ...attempt };
                                if (candidate.sameSite === undefined) {
                                    delete candidate.sameSite;
                                }
                                if (candidate.expirationDate === undefined) {
                                    delete candidate.expirationDate;
                                }
                                await targetSession.cookies.set(candidate);
                                return true;
                            } catch (error) {
                                lastError = error;
                            }
                        }

                        const cookieSummary = [
                            `name=${cookie.name || ''}`,
                            `domain=${cookie.domain || ''}`,
                            `path=${cookie.path || ''}`,
                            `url=${cookie.url || ''}`,
                            `sameSite=${cookie.sameSite || ''}`,
                            `secure=${cookie.secure === true ? 'true' : 'false'}`
                        ].join(', ');
                        const detailError = new Error(`Electron cookie 写入失败: ${cookieSummary}`);
                        detailError.cause = lastError || null;
                        throw detailError;
                    };

                    for (const cookie of Array.isArray(payload.cookies) ? payload.cookies : []) {
                        if (!cookie || !cookie.name) {
                            continue;
                        }
                        await setCookieWithRetry(cookie);
                    }
                }, {
                    cookies: normalizedCookies
                });
                return true;
            } catch (error) {
                this._logger?.warning?.(`内置 Electron 浏览器 Cookie 注入失败: ${error.message}`);
                return false;
            }
        }

        if (!this._actualContext || typeof this._actualContext.addCookies !== 'function') {
            return false;
        }

        await this._actualContext.addCookies(cookies);
        return true;
    }

    async addInitScript(script = {}) {
        if (!this._actualContext || typeof this._actualContext.addInitScript !== 'function') {
            return false;
        }

        await this._actualContext.addInitScript(script);
        return true;
    }

    async route(url, handler) {
        if (!this._actualContext || typeof this._actualContext.route !== 'function') {
            return false;
        }

        await this._actualContext.route(url, handler);
        return true;
    }

    async newCDPSession(page) {
        if (!this._actualContext || typeof this._actualContext.newCDPSession !== 'function') {
            throw new Error('内置 Electron 浏览器当前上下文不支持 CDP 会话');
        }

        return await this._actualContext.newCDPSession(page);
    }

    on(event, listener) {
        if (!this._actualContext || typeof this._actualContext.on !== 'function') {
            return this;
        }

        this._actualContext.on(event, listener);
        return this;
    }

    off(event, listener) {
        if (!this._actualContext || typeof this._actualContext.off !== 'function') {
            return this;
        }

        this._actualContext.off(event, listener);
        return this;
    }

    removeListener(event, listener) {
        if (!this._actualContext || typeof this._actualContext.removeListener !== 'function') {
            return this;
        }

        this._actualContext.removeListener(event, listener);
        return this;
    }

    async close() {
        if (this._closed) {
            return true;
        }

        this._closed = true;

        try {
            if (this._electronApp && typeof this._electronApp.close === 'function') {
                await this._electronApp.close();
                return true;
            }
        } catch (error) {
            this._logger?.warning?.(`关闭内置 Electron 浏览器失败: ${error.message}`);
        } finally {
            if (this._userDataDir) {
                try {
                    await fs.remove(this._userDataDir);
                } catch (cleanupError) {
                    this._logger?.warning?.(`清理内置 Electron 浏览器目录失败: ${cleanupError.message}`);
                }
            }
        }

        return false;
    }
}

async function launchBuiltinElectronBrowser(options = {}) {
    const {
        browserId = '',
        browserProfile = {},
        browserSettings = {},
        browserOptions = {},
        logger = console,
        headless = false,
        visible = undefined,
        offscreen = false,
        launchTimeout = 30000
    } = options;

    const playwrightElectron = loadPlaywrightElectron();
    const helperMainPath = resolveBuiltinElectronHelperMainPath();
    const launcherCommandPath = resolveBuiltinElectronLaunchCommandPath();
    const playwrightLoaderPath = resolvePlaywrightElectronLoaderPath();
    const windowWidth = Number.isFinite(parseInt(browserProfile.viewport?.width, 10))
        ? Math.max(320, parseInt(browserProfile.viewport.width, 10))
        : 1366;
    const windowHeight = Number.isFinite(parseInt(browserProfile.viewport?.height, 10))
        ? Math.max(240, parseInt(browserProfile.viewport.height, 10))
        : 768;
    const userDataDir = String(browserOptions.userDataDir || '').trim()
        || fs.mkdtempSync(path.join(os.tmpdir(), 'ai-register-electron-'));
    const windowVisible = visible !== undefined ? visible !== false : headless !== true;

    const env = {
        ...process.env,
        ...(browserOptions.env && typeof browserOptions.env === 'object' ? browserOptions.env : {}),
        BUILTIN_ELECTRON_USER_DATA_DIR: userDataDir,
        BUILTIN_ELECTRON_WINDOW_WIDTH: String(windowWidth),
        BUILTIN_ELECTRON_WINDOW_HEIGHT: String(windowHeight),
        BUILTIN_ELECTRON_WINDOW_VISIBLE: windowVisible ? '1' : '0',
        BUILTIN_ELECTRON_WINDOW_OFFSCREEN: offscreen ? '1' : '0',
        BUILTIN_ELECTRON_BROWSER_ID: browserId,
        BUILTIN_ELECTRON_BROWSER_TYPE: String(browserSettings.browser_type || browserSettings.browserType || 'electron').trim(),
        BUILTIN_ELECTRON_BROWSER_LOCALE: String(browserProfile.locale || '').trim(),
        BUILTIN_ELECTRON_BROWSER_TIMEZONE: String(browserProfile.timezoneId || '').trim(),
        BUILTIN_ELECTRON_REMOTE_DEBUGGING_PORT: '0'
    };

    const watermarkExtensionEnabled = false;
    const watermarkExtensionPath = '';
    env.BUILTIN_ELECTRON_EXTENSION_ENABLED = '0';

    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;

    const launchArgs = buildElectronLaunchArgs(
        browserProfile,
        helperMainPath,
        playwrightLoaderPath,
        windowWidth,
        windowHeight,
        headless,
        browserOptions
    );

    const electronLaunchOptions = {
        args: launchArgs,
        env,
        timeout: Number.isFinite(parseInt(launchTimeout, 10)) ? Math.max(0, parseInt(launchTimeout, 10)) : 30000,
        chromiumSandbox: false
    };
    electronLaunchOptions.executablePath = launcherCommandPath;

    if (browserOptions.artifactsDir) {
        electronLaunchOptions.artifactsDir = String(browserOptions.artifactsDir);
    }

    const electronApp = await playwrightElectron.launch(electronLaunchOptions);
    const actualContext = typeof electronApp.context === 'function' ? electronApp.context() : null;
    const adapter = new BuiltinElectronBrowserContextAdapter({
        electronApp,
        actualContext,
        logger,
        userDataDir,
        launchTimeout,
        windowWidth,
        windowHeight,
        visible: windowVisible,
        offscreen,
        browserId,
        browserKind: 'electron'
    });

    if (actualContext && typeof actualContext.addInitScript === 'function') {
        try {
            await actualContext.addInitScript({ content: buildBuiltinBrowserToolbarInitScript() });
            logger.info('已注入内置浏览器导航栏脚本');
        } catch (toolbarError) {
            logger.warning(`注入内置浏览器导航栏脚本失败: ${toolbarError.message}`);
        }

        try {
            await actualContext.addInitScript({ content: buildBuiltinElementInspectorInitScript() });
            logger.info('已注入内置浏览器元素获取脚本');
        } catch (inspectorError) {
            logger.warning(`注入内置浏览器元素获取脚本失败: ${inspectorError.message}`);
        }
    }

    logger.info('已禁用去水印插件');

    if (typeof electronApp.isConnected !== 'function') {
        electronApp.isConnected = () => !adapter.isClosed();
    }

    const pages = typeof electronApp.windows === 'function' ? electronApp.windows() : [];
    let page = pages.find(Boolean) || null;
    if (!page && typeof electronApp.firstWindow === 'function') {
        page = await electronApp.firstWindow({ timeout: launchTimeout });
    }

    if (!page) {
        throw new Error('内置 Electron 浏览器窗口未能创建');
    }

    adapter._registerPage(page);

    try {
        await page.evaluate(buildBuiltinBrowserToolbarInitScript());
    } catch (_error) {
    }

    try {
        await page.evaluate(buildBuiltinElementInspectorInitScript());
    } catch (_error) {
    }

    let browserVersion = '';
    try {
        browserVersion = await page.evaluate(() => String(navigator.userAgent || '')).catch(() => '');
    } catch (_error) {
        browserVersion = '';
    }

    return {
        electronApp,
        context: adapter,
        page,
        browserVersion,
        userDataDir,
        cleanup: async () => {
            await adapter.close();
        }
    };
}

module.exports = {
    loadPlaywrightElectron,
    resolveBuiltinElectronHelperMainPath,
    resolveBuiltinElectronLaunchCommandPath,
    resolvePlaywrightElectronLoaderPath,
    patchPageContext,
    BuiltinElectronBrowserContextAdapter,
    launchBuiltinElectronBrowser,
    buildBuiltinBrowserToolbarInitScript,
    buildBuiltinElementInspectorInitScript
};
