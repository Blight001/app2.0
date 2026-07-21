'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '../../../src/assets/extensions/browser_automation/popup/cookie-credential-cache.js',
);

function loadCredentialCache(panel, subtitle, stored = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(
      "import * as formatters from './cookie-credential-formatters.js';",
      'const formatters = globalThis.__formatters;',
    )
    .replace(/export \{[^]*\};\s*$/, '');
  const context = vm.createContext({
    __formatters: {
      getTodayCookieCredentialDateKey: () => '2026-07-21',
      getCookieCredentialDateKey: (value) => String(value || '').slice(0, 10),
      getCookieCredentialYesterdayKey: () => '2026-07-20',
      formatCookieCredentialDateLabel: (value) => String(value),
      normalizeCookieCredentialSearchQuery: (value) => String(value || '').trim().toLowerCase(),
      cookieCredentialItemMatchesQuery: (item, query) => !query || item.account.includes(query),
    },
    chrome: { storage: { local: {
      get: async () => ({ ...stored }),
      set: async (value) => Object.assign(stored, value),
    } } },
    console,
    document: {
      getElementById(id) {
        if (id === 'cookie-credential-edit-panel') return panel;
        if (id === 'cookie-credential-edit-panel-subtitle') return subtitle;
        return null;
      },
    },
    CookieCaptureShared: {
      STORAGE_KEYS: {
        COOKIE_CREDENTIAL_CACHE_LIST_KEY: 'list',
        COOKIE_CREDENTIAL_SELECTED_DATE_KEY: 'date',
        COOKIE_CREDENTIAL_SEARCH_KEY: 'search',
      },
    },
    window: { requestAnimationFrame() {} },
  });
  vm.runInContext(source, context, { filename: sourcePath });
  return context;
}

test('credential editor owns its state and cannot abort popup initialization', () => {
  const toggles = [];
  const panel = { classList: {
    contains: () => false,
    toggle: (_name, enabled) => toggles.push(enabled),
  } };
  const subtitle = { textContent: '' };
  const context = loadCredentialCache(panel, subtitle);

  assert.doesNotThrow(() => vm.runInContext('syncCookieCredentialEditUi()', context));
  assert.equal(toggles.at(-1), false);

  vm.runInContext("setCookieCredentialEditTarget({ id: 'credential-1' })", context);
  assert.equal(toggles.at(-1), true);
  assert.match(subtitle.textContent, /正在编辑/);

  vm.runInContext('clearCookieCredentialEditTarget()', context);
  assert.equal(toggles.at(-1), false);
});

test('credential filters keep date and search state inside the cache module', async () => {
  const stored = { date: 'all', search: ' ALICE ' };
  const context = loadCredentialCache({ classList: { contains: () => false, toggle() {} } }, {}, stored);

  await vm.runInContext('loadCookieCredentialFilterState()', context);
  assert.equal(vm.runInContext('getCookieCredentialSelectedDateValue()', context), 'all');
  assert.equal(vm.runInContext("setCookieCredentialSelectedDate('')", context), '2026-07-21');
  assert.equal(vm.runInContext("setCookieCredentialSearchQuery(' BOB ')", context), 'bob');

  const visible = vm.runInContext(
    "getCookieCredentialVisibleItems([{ account: 'bob-one', dateKey: '2026-07-21' }, { account: 'alice', dateKey: '2026-07-21' }])",
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(visible)), [{ account: 'bob-one', dateKey: '2026-07-21' }]);

  const options = vm.runInContext(
    "buildCookieCredentialDateOptions([{ savedAt: '2026-07-20T01:00:00Z' }, { savedAt: '2026-07-21T01:00:00Z' }])",
    context,
  );
  assert.deepEqual(Array.from(options, (item) => item.value), ['all', '2026-07-21', '2026-07-20']);
  await vm.runInContext('saveCookieCredentialFilterState()', context);
  assert.equal(stored.date, '2026-07-21');
  assert.equal(stored.search, 'bob');
});
