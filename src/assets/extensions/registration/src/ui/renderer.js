const renderMainPage = require('./templates/main-page');

if (typeof document !== 'undefined') {
  const appRoot = document.getElementById('app-root') || document.body;
  appRoot.innerHTML = renderMainPage();

  require('./modules/renderer-core');
}
