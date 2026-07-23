'use strict';

function createSoftwareHeading(software) {
  const heading = document.createElement('span');
  heading.className = 'software-card-heading';
  heading.textContent = software.name;
  if (software.running || software.experimental) {
    const badge = document.createElement('span');
    badge.className = 'software-card-badge';
    badge.textContent = software.running ? '已打开' : '实验性';
    heading.appendChild(badge);
  }
  return heading;
}

function createSoftwareCard(software, openSoftware) {
  const button = document.createElement('button');
  button.className = 'software-card';
  button.type = 'button';
  button.dataset.softwareId = software.id;
  const icon = document.createElement('span');
  icon.className = 'software-card-icon';
  icon.textContent = software.iconText || software.name.slice(0, 1);
  const content = document.createElement('span');
  content.className = 'software-card-content';
  const description = document.createElement('span');
  description.className = 'software-card-description';
  description.textContent = software.description || '点击嵌入软件窗口';
  content.append(createSoftwareHeading(software), description);
  const action = document.createElement('span');
  action.className = 'software-card-action';
  action.textContent = software.running ? '嵌入' : '打开';
  button.append(icon, content, action);
  button.addEventListener('click', () => openSoftware(button, software));
  return button;
}

function initializeSoftwareSettings() {
  const list = document.getElementById('software-catalog-list');
  const refresh = document.getElementById('refresh-software-catalog');
  const tab = document.querySelector('[data-tab="software-settings-panel"]');
  let loaded = false;
  if (!list) return;

  function renderMessage(message, error = false) {
    list.replaceChildren();
    const element = document.createElement('div');
    element.className = `software-catalog-message${error ? ' is-error' : ''}`;
    element.textContent = message;
    list.appendChild(element);
  }

  async function openSoftware(button, software) {
    button.disabled = true;
    button.classList.add('is-loading');
    const action = button.querySelector('.software-card-action');
    if (action) action.textContent = '启动中…';
    try {
      const result = await window.aiFree?.software.open({ softwareId: software.id });
      if (!result?.ok) throw new Error(result?.error || '软件启动失败');
      if (action) action.textContent = '已打开';
    } catch (error) {
      if (action) action.textContent = '重试';
      button.disabled = false;
      window.alert?.(`无法嵌入 ${software.name}：${error?.message || error}`);
    } finally {
      button.classList.remove('is-loading');
    }
  }

  async function loadCatalog() {
    loaded = true;
    renderMessage('正在检测桌面上已打开的窗口…');
    try {
      const result = await window.aiFree?.software.list();
      if (!result?.ok) throw new Error(result?.error || '检测失败');
      const software = Array.isArray(result.data) ? result.data : [];
      if (!software.length) {
        renderMessage('暂未检测到可嵌入的桌面窗口。请先打开目标软件，再点击刷新。');
        return;
      }
      list.replaceChildren(...software.map((item) => createSoftwareCard(item, openSoftware)));
    } catch (error) {
      renderMessage(`软件检测失败：${error?.message || error}`, true);
    }
  }

  refresh?.addEventListener('click', () => void loadCatalog());
  tab?.addEventListener('click', () => {
    if (!loaded) void loadCatalog();
  });
}

document.addEventListener('DOMContentLoaded', initializeSoftwareSettings);
