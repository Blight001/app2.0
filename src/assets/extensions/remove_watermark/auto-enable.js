(function () {
  'use strict';

  const STORAGE_SUFFIX = '__STORAGE__';
  const STORAGE_KEYS = [
    '__SP_COPY__',
    '__SP_KEYBOARD_TYPE__',
    '__SP_CONTEXT_MENU_TYPE__',
  ];
  const EVENT_NAME = 'lah2AqVqxG';
  const START_PAYLOADS = [
    '__COPY_TYPE__CI__',
    '__KEYBOARD_TYPE__CI__',
    '__CONTEXT_MENU_TYPE__CI__',
  ];

  function writeEnabledState() {
    try {
      const value = JSON.stringify({ origin: true, expire: null });
      STORAGE_KEYS.forEach((key) => {
        localStorage.setItem(`${key}${STORAGE_SUFFIX}`, value);
      });
    } catch (_) {}
  }

  function dispatchStartEvents() {
    try {
      START_PAYLOADS.forEach((type) => {
        window.dispatchEvent(new CustomEvent(EVENT_NAME, {
          detail: JSON.stringify({ type, payload: 'START' }),
        }));
      });
    } catch (_) {}
  }

  writeEnabledState();
  dispatchStartEvents();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    writeEnabledState();
    dispatchStartEvents();
    if (attempts >= 12) {
      clearInterval(timer);
    }
  }, 500);
}());
