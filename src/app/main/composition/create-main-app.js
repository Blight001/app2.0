const { startMainApp } = require('../bootstrap');

// 创建/初始化：createMainApp的具体业务逻辑。
function createMainApp() {
  return {
    start: startMainApp,
  };
}

module.exports = {
  createMainApp,
};
