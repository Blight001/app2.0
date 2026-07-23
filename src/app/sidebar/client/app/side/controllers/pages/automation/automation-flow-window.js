'use strict';

{
  const MESSAGE_SCOPE = 'ai-free-automation-flow';

  function createAutomationFlowWindow(options = {}) {
    let flowWindow = null;

    function send(type, payload = {}) {
      if (!flowWindow || flowWindow.closed) return;
      flowWindow.postMessage({ scope: MESSAGE_SCOPE, type, ...payload }, '*');
    }

    function open() {
      if (flowWindow && !flowWindow.closed) {
        flowWindow.focus();
        send('initialize', { card: options.getCard() });
        return;
      }
      const url = new URL('../automation-flow/index.html', window.location.href);
      flowWindow = window.open(
        url.href,
        'ai-free-automation-flow',
        'width=1240,height=820,minWidth=900,minHeight=620,resizable=yes',
      );
      if (!flowWindow) options.onError?.('无法打开卡片流程窗口');
    }

    function close() {
      if (flowWindow && !flowWindow.closed) flowWindow.close();
      flowWindow = null;
    }

    async function handleMessage(event) {
      if (!flowWindow || event.source !== flowWindow || event.data?.scope !== MESSAGE_SCOPE) return;
      if (event.data.type === 'ready') {
        send('initialize', { card: options.getCard() });
        return;
      }
      if (event.data.type === 'change' && event.data.card) {
        options.onChange(event.data.card);
        return;
      }
      if (event.data.type === 'save' && event.data.card) {
        options.onChange(event.data.card);
        const saved = await options.onSave();
        send('saved', { ok: Boolean(saved), error: saved ? '' : '卡片保存失败' });
      }
    }

    window.addEventListener('message', (event) => void handleMessage(event));
    return Object.freeze({ close, open });
  }

  window.AutomationFlowWindow = Object.freeze({ create: createAutomationFlowWindow });
}
