'use strict';

function createSoftwareHeading(software) {
  const heading = document.createElement('span');
  heading.className = 'software-card-heading';
  const name = document.createElement('span');
  name.className = 'software-card-name';
  name.textContent = software.name;
  name.title = software.name;
  heading.appendChild(name);
  return heading;
}

function createSoftwareIcon(software) {
  const icon = document.createElement('span');
  icon.className = 'software-card-icon';
  if (!software.iconDataUrl) {
    icon.classList.add('is-placeholder');
    return icon;
  }
  const image = document.createElement('img');
  image.src = software.iconDataUrl;
  image.alt = '';
  icon.appendChild(image);
  return icon;
}

function createSoftwareCard(software, openSoftware) {
  const button = document.createElement('button');
  button.className = 'software-card';
  button.type = 'button';
  button.dataset.softwareId = software.id;
  const icon = createSoftwareIcon(software);
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
  window.aiFree?.browser.onTabsUpdated?.(() => {
    if (loaded && document.getElementById('software-settings-panel')?.classList.contains('active')) {
      void loadCatalog();
    }
  });
  tab?.addEventListener('click', () => {
    if (!loaded) void loadCatalog();
  });
}

document.addEventListener('DOMContentLoaded', initializeSoftwareSettings);
