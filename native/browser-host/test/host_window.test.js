const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const bindingPath = path.join(__dirname, '..', 'build', 'Release', 'browser_host.node');

test('native host exports the documented API', { skip: !fs.existsSync(bindingPath) && 'native addon has not been built' }, () => {
  const binding = require(bindingPath);
  for (const name of [
    'createHostWindow', 'destroyHostWindow', 'attachChildWindow', 'detachChildWindow',
    'setHostBounds', 'raiseHostWindow', 'showHostWindow', 'hideHostWindow', 'focusChildWindow',
    'watchChildWindowClicks', 'unwatchChildWindowClicks',
    'isWindowAlive', 'getWindowProcessId', 'findMainWindowByProcessId',
    'setChildWindowTitle', 'isChildWindowAttached',
  ]) {
    assert.equal(typeof binding[name], 'function', `${name} must be exported`);
  }
});
