'use strict';

const binding = require('../native/browser-host/build/Release/browser_host.node');
console.log(JSON.stringify({
  electron: process.versions.electron || '',
  node: process.versions.node,
  napi: process.versions.napi,
  createHostWindow: typeof binding.createHostWindow,
}));
