const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const accountAuth = read(
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js',
);
const license = read(
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/license.js',
);
const availability = read(
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/connection-sync.js',
);

test('登录会话直接同步羊毛资源和内置代理的可用状态', () => {
  const renderStart = accountAuth.indexOf('function renderSidebarAccountSession');
  const renderEnd = accountAuth.indexOf('async function submitSidebarAccountAuth', renderStart);
  const renderer = accountAuth.slice(renderStart, renderEnd);

  assert.match(renderer, /applyAuthenticatedAccountFeatureAccess\(session\)/);

  const applyStart = license.indexOf('function applyAuthenticatedAccountFeatureAccess');
  const applyEnd = license.indexOf('async function consumeAutoValidateFlag', applyStart);
  const applySession = license.slice(applyStart, applyEnd);

  assert.match(applySession, /applyValidatedLicenseResult\(validation/);
  assert.match(applySession, /enableAllLicenseRequiredButtons\(\)/);
});

test('初始化凭证请求不能覆盖请求期间完成的登录', () => {
  const loadStart = license.indexOf('const loadCredentials = async');
  const loadEnd = license.indexOf('void loadCredentials();', loadStart);
  const loader = license.slice(loadStart, loadEnd);

  assert.match(license, /licenseCredentialsUpdateRevision \+= 1/);
  assert.match(loader, /const requestRevision = licenseCredentialsUpdateRevision/);
  assert.match(loader, /requestRevision !== licenseCredentialsUpdateRevision/);
});

test('羊毛资源和代理主开关不再被隐藏卡密状态整体禁用', () => {
  const requiredStart = availability.indexOf('function setLicenseRequiredButtonsDisabled');
  const requiredEnd = availability.indexOf('function setAccountTabDisabled', requiredStart);
  const requiredState = availability.slice(requiredStart, requiredEnd);
  assert.match(requiredState, /button\.dataset\.quotaUnavailable === 'true'/);
  assert.doesNotMatch(requiredState, /setButtonsDisabled\('\.requires-license'/);

  const featureStart = availability.indexOf('function applyFeatureAvailability');
  const featureEnd = availability.indexOf('function setDreamButtonPlatformName', featureStart);
  const featureState = availability.slice(featureStart, featureEnd);
  assert.match(featureState, /\.VPN-btn:not\(#VPN-switch\)/);

  const renderStart = availability.indexOf('function renderWoolPlatformButtons');
  const renderEnd = availability.indexOf('function setTutorialLinkHref', renderStart);
  const renderer = availability.slice(renderStart, renderEnd);
  assert.match(renderer, /button\.disabled = quotaUnavailable/);
  assert.doesNotMatch(renderer, /button\.disabled = !isLicenseValidated\(\)/);
});
