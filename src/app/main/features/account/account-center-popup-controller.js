'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');

class AccountCenterPopupController {
  constructor({ app, ui }) {
    this.app = app;
    this.ui = ui;
    this.window = null;
    this.layout = null;
    this.dismissTimer = null;
    this.dismissing = false;
    this.blurArmTimer = null;
    this.blurArmed = false;
    this.dismissOnBlur = true;
    this.windowFocusHandler = null;
  }

  close() {
    this.clearTimersAndFocusHandler();
    this.dismissing = false;
    this.blurArmed = false;
    this.dismissOnBlur = true;
    const popup = this.window;
    this.window = null;
    this.layout = null;
    if (!popup || popup.isDestroyed()) return;
    try { popup.close(); } catch (_) {}
  }

  clearTimersAndFocusHandler() {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
    if (this.windowFocusHandler && this.app?.removeListener) {
      this.app.removeListener('browser-window-focus', this.windowFocusHandler);
    }
    this.windowFocusHandler = null;
    if (this.blurArmTimer) clearTimeout(this.blurArmTimer);
    this.blurArmTimer = null;
  }

  dismiss() {
    const popup = this.window;
    if (!popup || popup.isDestroyed() || this.dismissing) return;
    this.dismissing = true;
    try { popup.webContents.send('account-popup-dismiss'); } catch (_) {}
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.close();
    }, 190);
  }

  resize(requestedHeight) {
    const popup = this.window;
    if (!popup || popup.isDestroyed() || !this.layout) return;
    const height = Math.max(320, Math.ceil(Number(requestedHeight) || 0));
    const top = this.layout.workArea.y + 8;
    const lowestY = this.layout.workArea.y + this.layout.workArea.height - height - 8;
    const y = height <= this.layout.workArea.height - 16
      ? Math.min(Math.max(this.layout.desiredY, top), lowestY)
      : top;
    popup.setBounds({ x: this.layout.x, y, width: this.layout.width, height }, false);
  }

  async captureSnapshot() {
    try {
      const webContents = this.ui.getSideView?.()?.webContents;
      if (!webContents || webContents.isDestroyed?.()) return {};
      return await webContents.executeJavaScript(`(() => ({
        theme: document.documentElement.classList.contains('theme-gold') ? 'gold' : (document.documentElement.classList.contains('theme-light') ? 'light' : 'dark'),
        announcementTitle: document.getElementById('announcement-title')?.textContent || '',
        announcementIcon: document.getElementById('announcement-icon')?.textContent || '',
        announcementHtml: document.getElementById('announcement-content')?.innerHTML || '',
        tutorialUrl: document.getElementById('tutorial-link')?.href || '',
        appVersion: document.getElementById('app-version')?.textContent || ''
      }))()`);
    } catch (_) {
      return {};
    }
  }

  async toggle(payload = {}) {
    if (this.isWindowAlive()) {
      this.dismiss();
      return;
    }
    const mainWindow = this.ui.getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed?.()) return;
    this.dismissOnBlur = payload?.dismissOnBlur !== false;
    const bounds = this.resolvePopupBounds(mainWindow, payload);
    const popup = this.createWindow(mainWindow, bounds);
    this.window = popup;
    this.bindWindowEvents(popup);
    await this.loadWindow(popup, payload);
  }

  isWindowAlive() {
    return Boolean(this.window) && !this.window.isDestroyed();
  }

  resolvePopupBounds(mainWindow, payload) {
    const contentBounds = mainWindow.getContentBounds();
    const anchor = payload?.anchor && typeof payload.anchor === 'object' ? payload.anchor : {};
    const width = 430;
    const height = 520;
    const anchorRight = Number.isFinite(Number(anchor.right)) ? Number(anchor.right) : contentBounds.width - 8;
    const anchorBottom = Number.isFinite(Number(anchor.bottom)) ? Number(anchor.bottom) : 36;
    const desiredX = Math.round(contentBounds.x + anchorRight - width);
    const desiredY = Math.round(contentBounds.y + anchorBottom + 6);
    const workArea = screen.getDisplayNearestPoint({ x: desiredX, y: desiredY }).workArea;
    const x = Math.min(Math.max(desiredX, workArea.x + 8), workArea.x + workArea.width - width - 8);
    const y = Math.min(Math.max(desiredY, workArea.y + 8), workArea.y + workArea.height - height - 8);
    this.layout = { desiredY, width, workArea, x };
    return { width, height, x, y };
  }

  createWindow(mainWindow, bounds) {
    return new BrowserWindow({
      parent: mainWindow,
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        preload: path.join(this.app.getAppPath(), 'src', 'app', 'main', 'preload.js'),
      },
    });
  }

  bindWindowEvents(popup) {
    this.windowFocusHandler = (_event, focusedWindow) => {
      if (focusedWindow !== popup && this.blurArmed && this.dismissOnBlur) this.dismiss();
    };
    this.app?.on?.('browser-window-focus', this.windowFocusHandler);
    popup.on('closed', () => {
      if (this.window === popup) this.window = null;
    });
    popup.on('blur', () => {
      if (this.window === popup && this.blurArmed && this.dismissOnBlur) this.dismiss();
    });
    popup.webContents.on('did-finish-load', () => { void this.handleDidFinishLoad(popup); });
    popup.once('ready-to-show', () => this.show(popup));
  }

  async handleDidFinishLoad(popup) {
    if (popup.isDestroyed()) return;
    this.show(popup);
    const snapshot = await this.captureSnapshot();
    if (!popup.isDestroyed()) popup.webContents.send('account-popup-snapshot', snapshot);
  }

  show(popup) {
    if (popup.__aiFreeShown || popup.isDestroyed()) return;
    try {
      popup.show();
      popup.focus();
      popup.__aiFreeShown = true;
      this.blurArmed = false;
      if (this.blurArmTimer) clearTimeout(this.blurArmTimer);
      this.blurArmTimer = setTimeout(() => this.refocusAndArmBlur(popup), 220);
    } catch (_) {}
  }

  refocusAndArmBlur(popup) {
    this.blurArmTimer = null;
    if (this.window !== popup || popup.isDestroyed() || this.dismissing) return;
    try { popup.show(); popup.focus(); } catch (_) {}
    this.blurArmTimer = setTimeout(() => {
      this.blurArmTimer = null;
      if (this.window === popup && !popup.isDestroyed() && !this.dismissing) this.blurArmed = true;
    }, 80);
  }

  async loadWindow(popup, payload) {
    const popupPath = path.join(this.app.getAppPath(), 'src', 'app', 'sidebar', 'index.html');
    try {
      await popup.loadFile(popupPath, { query: {
        accountCenterPopup: '1',
        showVipPlans: payload?.showVipPlans === true ? '1' : '0',
      } });
      this.show(popup);
    } catch (error) {
      console.warn('[UI] 个人中心独立浮窗加载失败:', error?.message || error);
      this.close();
    }
  }

  async open(payload = {}) {
    if (!this.isWindowAlive()) {
      await this.toggle(payload);
      return;
    }
    if (this.dismissing) {
      this.close();
      await this.toggle(payload);
      return;
    }
    this.dismissOnBlur = payload?.dismissOnBlur !== false;
    try {
      this.window.show();
      this.window.focus();
      if (payload?.showVipPlans === true) this.window.webContents.send('open-vip-plans');
    } catch (_) {}
  }

  isOpen() {
    return this.isWindowAlive() && !this.dismissing;
  }

  isSender(sender) {
    return this.isWindowAlive() && sender === this.window.webContents;
  }

  getApi() {
    return {
      closeAccountCenterPopupWindow: () => this.close(),
      dismissAccountCenterPopupWindow: () => this.dismiss(),
      isAccountCenterPopupOpen: () => this.isOpen(),
      isAccountCenterPopupSender: (sender) => this.isSender(sender),
      openAccountCenterPopupWindow: (payload) => this.open(payload),
      resizeAccountCenterPopupWindow: (height) => this.resize(height),
      toggleAccountCenterPopupWindow: (payload) => this.toggle(payload),
    };
  }
}

function createAccountCenterPopupController(options) {
  return new AccountCenterPopupController(options).getApi();
}

module.exports = { createAccountCenterPopupController };
