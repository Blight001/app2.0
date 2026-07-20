'use strict';

class AiFreeBrowserHistoryView {
constructor({
  el,
  getBrowserHistory,
  getBrowserProfileAudit,
  getSelectedHistoryIds,
  setSelectedHistoryIds,
  applyNetworkMagicToBrowserHistory,
  openBrowserHistory,
  selectBrowserHistory,
  openSelectedBrowserHistory,
  renameSelectedBrowserHistory,
  deleteSelectedBrowserHistory,
}) {
    Object.assign(this, {
      el, getBrowserHistory, getBrowserProfileAudit, getSelectedHistoryIds, setSelectedHistoryIds,
      applyNetworkMagicToBrowserHistory, openBrowserHistory, selectBrowserHistory,
      openSelectedBrowserHistory, renameSelectedBrowserHistory, deleteSelectedBrowserHistory,
    });
    for (const name of [
      'renderBrowserHistory', 'renderBrowserProfileAudit', 'getSelectedBrowserHistory',
      'toggleBrowserHistorySelection', 'ensureBrowserHistoryContextMenu',
      'hideBrowserHistoryContextMenu', 'showBrowserHistoryContextMenu', 'formatBrowserHistoryDateTime',
    ]) this[name] = this[name].bind(this);
  }

  appendAccountMetadata(main, item) {
    const parts = [];
    if (item.accountDisplayName) parts.push(`账号：${item.accountDisplayName}`);
    if (item.accountTypeLabel) parts.push(item.accountTypeLabel);
    if (parts.length) {
      const accountMeta = document.createElement('span');
      accountMeta.className = 'browser-history-account-meta';
      accountMeta.textContent = parts.join(' · ');
      main.append(accountMeta);
    }
    if (item.accountType === 'shared') {
      const autoDelete = document.createElement('span');
      autoDelete.className = 'browser-history-account-meta browser-history-auto-delete';
      autoDelete.textContent = `自动删除：${this.formatBrowserHistoryDateTime(item.autoDeleteAt) || '等待服务器同步'}`;
      main.append(autoDelete);
    }
  }

  renderBrowserHistory(options = {}) {
    const list = this.el('browser-history-list');
    if (!list) return;
    list.replaceChildren();
    if (!this.getBrowserHistory().length) {
      const empty = document.createElement('div');
      empty.className = 'browser-history-empty';
      empty.textContent = '暂无浏览器记录，点击窗口栏的“+”新建。';
      list.appendChild(empty);
      return;
    }
    this.getBrowserHistory().forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'browser-history-item';
      row.classList.toggle('is-selected', this.getSelectedHistoryIds().has(item.id));
      row.classList.toggle('is-open', item.isOpen === true);
      row.classList.toggle('is-active', item.isActive === true);
      row.classList.toggle('has-error', !!item.lastError);
      row.classList.toggle('is-entering', options.animate === true);
      row.classList.toggle('is-selection-changing', options.selectionChangedId === item.id);
      row.dataset.historyId = item.id;
      row.style.setProperty('--history-item-index', String(index));
  
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'browser-history-main';
      main.title = `${item.name || '未命名浏览器'}（单击选择，右键批量操作）`;
      main.setAttribute('aria-pressed', this.getSelectedHistoryIds().has(item.id) ? 'true' : 'false');
      main.setAttribute('aria-label', `${item.name || '未命名浏览器'}，${item.isActive ? '当前浏览器' : (item.isOpen ? '已打开' : '已关闭')}，点击选择`);
      const name = document.createElement('span');
      name.className = 'browser-history-name';
      name.textContent = item.name || '未命名浏览器';
      main.append(name);
      this.appendAccountMetadata(main, item);
      main.addEventListener('click', () => this.toggleBrowserHistorySelection(item.id));
  
      const actions = document.createElement('div');
      actions.className = 'browser-history-actions';
      const magic = document.createElement('button');
      magic.type = 'button';
      magic.className = 'browser-history-action browser-history-magic';
      magic.classList.toggle('is-applied', item.networkMagicSelected === true);
      magic.textContent = '魔法';
      magic.title = item.networkMagicSelected === true
        ? '该浏览器已选择魔法端口代理，点击关闭魔法'
        : '将网络魔法代理应用到该浏览器（已打开时自动重启）';
      magic.addEventListener('click', () => void this.applyNetworkMagicToBrowserHistory(item, magic, item.networkMagicSelected !== true));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'browser-history-action browser-history-open';
      open.textContent = '打开';
      open.title = '打开浏览器';
      open.addEventListener('click', () => void this.openBrowserHistory(item.id, open));
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'browser-history-action browser-history-edit';
      edit.textContent = '编辑';
      edit.title = '编辑名称、参数或删除浏览器';
      edit.addEventListener('click', () => void this.selectBrowserHistory(item.id, { openDialog: true }));
      actions.append(magic, open, edit);
      row.append(main, actions);
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (!this.getSelectedHistoryIds().has(item.id)) this.setSelectedHistoryIds(new Set([item.id]));
        this.renderBrowserHistory({ selectionChangedId: item.id });
        this.showBrowserHistoryContextMenu(event.clientX, event.clientY);
      });
      list.appendChild(row);
    });
  }
  
  renderBrowserProfileAudit() {
    const audit = this.el('browser-profile-audit');
    const totalCount = Number(this.getBrowserProfileAudit()?.totalCount || 0);
    if (audit) {
      audit.hidden = !this.getBrowserProfileAudit();
      audit.textContent = this.getBrowserProfileAudit()
        ? `环境 ${totalCount}`
        : '';
    }
  }
  
  getSelectedBrowserHistory() {
    return this.getBrowserHistory().filter((item) => this.getSelectedHistoryIds().has(item.id));
  }
  
  toggleBrowserHistorySelection(historyId) {
    const id = String(historyId || '');
    if (!id) return;
    const next = new Set(this.getSelectedHistoryIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.setSelectedHistoryIds(next);
    this.hideBrowserHistoryContextMenu();
    this.renderBrowserHistory({ selectionChangedId: id });
  }
  
  ensureBrowserHistoryContextMenu() {
    let menu = this.el('browser-history-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'browser-history-context-menu';
    menu.className = 'browser-history-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <div class="browser-history-context-summary"></div>
      <button type="button" role="menuitem" data-browser-history-command="open">批量打开</button>
      <button type="button" role="menuitem" data-browser-history-command="rename">批量重命名</button>
      <button type="button" role="menuitem" class="is-danger" data-browser-history-command="delete">批量删除</button>
    `;
    menu.addEventListener('click', (event) => {
      const command = event.target.closest('[data-browser-history-command]')?.dataset.browserHistoryCommand;
      if (!command) return;
      this.hideBrowserHistoryContextMenu();
      if (command === 'open') void this.openSelectedBrowserHistory();
      if (command === 'rename') this.renameSelectedBrowserHistory();
      if (command === 'delete') this.deleteSelectedBrowserHistory();
    });
    document.body.appendChild(menu);
    return menu;
  }
  
  hideBrowserHistoryContextMenu() {
    const menu = this.el('browser-history-context-menu');
    if (!menu) return;
    menu.classList.remove('is-visible');
    menu.setAttribute('aria-hidden', 'true');
  }
  
  showBrowserHistoryContextMenu(x, y) {
    const items = this.getSelectedBrowserHistory();
    if (!items.length) return;
    const menu = this.ensureBrowserHistoryContextMenu();
    const summary = menu.querySelector('.browser-history-context-summary');
    if (summary) summary.textContent = `已选择 ${items.length} 个浏览器`;
    menu.querySelectorAll('[data-browser-history-command]').forEach((button) => {
      const label = button.dataset.browserHistoryCommand === 'open'
        ? '打开'
        : button.dataset.browserHistoryCommand === 'rename' ? '重命名' : '删除';
      button.textContent = `${label}选中项（${items.length}）`;
    });
    menu.classList.add('is-visible');
    menu.setAttribute('aria-hidden', 'false');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }
  
  formatBrowserHistoryDateTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

window.createAiFreeBrowserHistoryView = function createAiFreeBrowserHistoryView(dependencies) {
  return new AiFreeBrowserHistoryView(dependencies);
};
