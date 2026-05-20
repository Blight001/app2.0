(() => {
      const state = {
        entries: [],
        tabs: new Map(),
        activeSource: 'all',
        tabbar: document.getElementById('tabbar'),
        list: document.getElementById('list'),
        summary: document.getElementById('summary'),
        status: document.getElementById('status'),
        panelTitle: document.getElementById('panel-title'),
        panelCount: document.getElementById('panel-count'),
        overlay: document.getElementById('overlay'),
        countAll: document.getElementById('count-all'),
      };

      const levelLabelMap = {
        info: '普通',
        warn: '警告',
        error: '严重',
      };

      const levelClassMap = {
        info: 'level-info',
        warn: 'level-warn',
        error: 'level-error',
      };

// 格式化/规范化：normalizeLevel的具体业务逻辑。
      function normalizeLevel(level) {
        const key = String(level || 'info').toLowerCase();
        if (key === 'warn' || key === 'warning') return 'warn';
        if (key === 'error' || key === 'fatal') return 'error';
        return 'info';
      }

// 格式化/规范化：normalizeSource的具体业务逻辑。
      function normalizeSource(source) {
        const text = String(source || '').trim();
        return text || '其它';
      }

// 校验/保护：hashColor的具体业务逻辑。
      function hashColor(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
          hash = ((hash << 5) - hash) + text.charCodeAt(i);
          hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue} 72% 68%)`;
      }

// 格式化/规范化：formatTime的具体业务逻辑。
      function formatTime(ts) {
        const value = new Date(ts);
        if (Number.isNaN(value.getTime())) return '';
        return value.toLocaleTimeString('zh-CN', { hour12: false });
      }

// 校验/保护：ensureEmptyState的具体业务逻辑。
      function ensureEmptyState(listEl, count) {
        if (count > 0 || listEl.querySelector('.empty')) return;
        const node = document.createElement('div');
        node.className = 'empty';
        node.textContent = '暂无日志';
        listEl.appendChild(node);
      }

// 创建/初始化：createEntryNode的具体业务逻辑。
      function createEntryNode(entry) {
        const wrap = document.createElement('div');
        wrap.className = 'entry';

        const meta = document.createElement('div');
        meta.className = 'meta';

        const time = document.createElement('span');
        time.textContent = formatTime(entry.timestamp) || '--:--:--';
        meta.appendChild(time);

        const level = document.createElement('span');
        const levelKey = normalizeLevel(entry.level);
        level.className = `badge ${levelClassMap[levelKey] || 'level-info'}`;
        level.textContent = levelLabelMap[levelKey] || '普通';
        meta.appendChild(level);

        const source = document.createElement('span');
        source.className = 'badge source-tag';
        source.style.setProperty('--source-color', hashColor(normalizeSource(entry.source)));
        source.textContent = normalizeSource(entry.source);
        meta.appendChild(source);

        wrap.appendChild(meta);

        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = String(entry.text || '');
        wrap.appendChild(text);

        return wrap;
      }

// 处理：flashTab的具体业务逻辑。
      function flashTab(tabEl, levelKey) {
        if (!tabEl) return;
        tabEl.classList.remove('flash-info', 'flash-warn', 'flash-error');
        void tabEl.offsetWidth;
        tabEl.classList.add(`flash-${levelKey}`);
        window.setTimeout(() => {
          tabEl.classList.remove('flash-info', 'flash-warn', 'flash-error');
        }, 800);
      }

// 设置/更新/持久化：updateTabCounts的具体业务逻辑。
      function updateTabCounts() {
        state.countAll.textContent = String(state.entries.length);
        for (const [source, meta] of state.tabs.entries()) {
          const count = source === 'all'
            ? state.entries.length
            : state.entries.filter((item) => normalizeSource(item.source) === source).length;
          meta.count.textContent = String(count);
          if (source !== 'all') {
            meta.tab.hidden = count === 0;
          }
        }
        state.summary.textContent = `共 ${state.entries.length} 条日志`;
      }

// 渲染/刷新：renderList的具体业务逻辑。
      function renderList(source) {
        const current = normalizeSource(source);
        state.activeSource = current;
        state.list.innerHTML = '';

        const entries = current === 'all'
          ? state.entries
          : state.entries.filter((item) => normalizeSource(item.source) === current);

        if (!entries.length) {
          ensureEmptyState(state.list, 0);
        } else {
          const fragment = document.createDocumentFragment();
          for (const entry of entries) {
            fragment.appendChild(createEntryNode(entry));
          }
          state.list.appendChild(fragment);
        }

        state.panelTitle.textContent = current === 'all' ? '全部信息' : current;
        state.panelCount.textContent = `${entries.length} 条`;

        for (const meta of state.tabs.values()) {
          meta.tab.classList.toggle('active', meta.source === current);
        }
      }

// 校验/保护：ensureTab的具体业务逻辑。
      function ensureTab(source) {
        const current = normalizeSource(source);
        if (state.tabs.has(current)) return state.tabs.get(current);

        const tab = document.createElement('div');
        tab.className = current === 'all' ? 'tab all' : 'tab source-tab';
        tab.dataset.source = current;
        tab.style.setProperty('--source-color', hashColor(current));
        tab.innerHTML = `<div class="tab-inner"><span></span><span class="count">0</span></div>`;

        const title = tab.querySelector('span');
        const count = tab.querySelector('.count');
        title.textContent = current === 'all' ? '全部信息' : current;

        tab.addEventListener('click', () => renderList(current));
        state.tabbar.appendChild(tab);

        const meta = { source: current, tab, title, count };
        state.tabs.set(current, meta);
        return meta;
      }

// 格式化/规范化：normalizeEntry的具体业务逻辑。
      function normalizeEntry(entry) {
        const text = entry && typeof entry.text === 'string' ? entry.text : '';
        const match = text.match(/^\[([^\]]+)\]/);
        return {
          level: normalizeLevel(entry && entry.level),
          source: normalizeSource(entry && entry.source ? entry.source : (match ? match[1] : '其它')),
          text,
          timestamp: entry && entry.timestamp ? entry.timestamp : new Date().toISOString(),
        };
      }

// 处理：appendEntry的具体业务逻辑。
      function appendEntry(entry) {
        const normalized = normalizeEntry(entry);
        state.entries.push(normalized);

        ensureTab(normalized.source);
        updateTabCounts();
        renderList(state.activeSource);

        const activeMeta = state.tabs.get(state.activeSource);
        const sourceMeta = state.tabs.get(normalized.source);
        flashTab(state.tabs.get('all')?.tab, normalized.level);
        flashTab(sourceMeta?.tab, normalized.level);
        if (activeMeta && activeMeta.source === normalized.source) {
          flashTab(activeMeta.tab, normalized.level);
        }

        state.status.textContent = '日志已连接';
      }

// 获取/读取/解析：loadHistory的具体业务逻辑。
      async function loadHistory() {
        try {
          const response = await window.electron.getAppConsoleHistory();
          const history = Array.isArray(response)
            ? response
            : (response && Array.isArray(response.history) ? response.history : []);
          state.entries = history.map(normalizeEntry);
          const seen = new Set(state.entries.map((item) => normalizeSource(item.source)));
          for (const source of seen) {
            ensureTab(source);
          }
          updateTabCounts();
          renderList('all');
          state.status.textContent = '日志已连接';
        } catch (error) {
          state.status.textContent = `历史日志加载失败：${error && error.message ? error.message : error}`;
        }
      }

      if (window.electronAPI && typeof window.electronAPI.on === 'function') {
        window.electronAPI.on('app-console-line', (entry) => {
          appendEntry(entry);
        });
      }

      window.addEventListener('error', (event) => {
        const message = event && event.error
          ? (event.error.stack || event.error.message || String(event.error))
          : (event && event.message ? event.message : '未知前端错误');
        if (state.overlay) {
          state.overlay.style.display = 'block';
          state.overlay.textContent = `调试控制台页面脚本错误:\n${message}`;
        }
      });

      ensureTab('all');
      loadHistory();
    })();
  