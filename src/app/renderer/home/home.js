'use strict';

const browserButton = document.getElementById('open-browser');
const softwareButton = document.getElementById('open-software');
const accountStatus = document.getElementById('account-status');

async function invokeWithDisabledState(button, action) {
  button.disabled = true;
  try {
    const result = await action();
    if (result?.ok === false) throw new Error(result.error?.message || '操作失败');
  } catch (error) {
    accountStatus.textContent = error?.message || String(error);
  } finally {
    button.disabled = false;
  }
}

browserButton.addEventListener('click', () => invokeWithDisabledState(
  browserButton,
  () => window.aiFree.home.openBrowser(),
));
softwareButton.addEventListener('click', () => invokeWithDisabledState(
  softwareButton,
  () => window.aiFree.home.openSoftware(),
));

window.aiFree.account.getSession().then((result) => {
  const session = result?.data || result?.session || result;
  const name = session?.username || session?.account || '';
  accountStatus.textContent = name ? `当前账号：${name}` : '当前未登录';
}).catch(() => {
  accountStatus.textContent = '账号状态暂不可用';
});
