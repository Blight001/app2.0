function firstLicenseControlValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function licenseControlText(...values) {
  const value = firstLicenseControlValue(...values);
  return value === undefined ? '' : String(value).trim();
}

function applyAuthenticatedAccountFeatureAccess(session = {}) {
  if (session.authenticated !== true) return;
  const validation = session.validation && typeof session.validation === 'object'
    ? session.validation
    : {};
  const keyInput = safeGetEl('key-input');
  const deviceInput = safeGetEl('device-id');
  const key = licenseControlText(
    validation.key,
    session.key,
    currentLicenseState.key,
    keyInput && keyInput.value,
  );
  const deviceId = licenseControlText(
    validation.deviceId,
    validation.device_id,
    session.deviceId,
    session.device_id,
    currentLicenseState.deviceId,
    deviceInput && deviceInput.value,
  );
  applyLicenseCredentialsToInput({ key, deviceId });
  applyValidatedLicenseResult(validation, { key, deviceId });
  enableAllLicenseRequiredButtons();
}

async function consumeAutoValidateFlag() {
  const license = window.aiFree && window.aiFree.license;
  if (!license || typeof license.consumeAutoValidateFlag !== 'function') {
    return { ok: false, pending: false, key: '', deviceId: '' };
  }
  try {
    const result = await license.consumeAutoValidateFlag();
    if (result && result.ok) return result;
  } catch (error) {
    console.warn('[前端] 读取自动验证标记失败:', error);
  }
  return { ok: false, pending: false, key: '', deviceId: '' };
}

function currentLicenseControlCredentials(keyInput) {
  const deviceInput = safeGetEl('device-id');
  return {
    key: licenseControlText(currentLicenseState.key, keyInput.value),
    deviceId: licenseControlText(
      currentLicenseState.deviceId,
      deviceInput && deviceInput.value,
      'unknown',
    ) || 'unknown',
  };
}

function triggerNetworkMagicAfterValidation(key, deviceId, label) {
  try {
    if (typeof autoStartNetworkMagicIfEligible !== 'function') return;
    void autoStartNetworkMagicIfEligible({
      startBtn: safeGetEl('start-clash-mini-btn'),
      vpnBtn: safeGetEl('VPN-switch'),
      key,
      deviceId,
    });
  } catch (error) {
    console.warn(label, licenseControlText(error && error.message, error));
  }
}

async function performLicenseUnbind(validateBtn, credentials) {
  validateBtn.disabled = true;
  validateBtn.classList.add('loading');
  try {
    const response = await window.aiFree.license.unbindDevice({
      key: credentials.key,
      device_id: credentials.deviceId,
      deviceId: credentials.deviceId,
    });
    if (response && response.ok) {
      applyValidationFailureState();
      displayExpirationInfo(firstLicenseControlValue(response.data, response.result, response));
      window.MessageModal.showSuccessMessage(licenseControlText(response.message, '解绑成功'));
      return;
    }
    const message = licenseControlText(response && response.message, response && response.error, '未知错误');
    window.MessageModal.showErrorMessage(`解绑失败: ${message}`);
    restoreBoundLicenseState(credentials);
  } catch (error) {
    console.error('解绑卡密时出错:', error);
    window.MessageModal.showErrorMessage(`解绑卡密时出错: ${licenseControlText(error && error.message, error)}`);
    restoreBoundLicenseState(credentials);
  } finally {
    validateBtn.classList.remove('loading');
  }
}

function confirmLicenseUnbind(validateBtn, credentials) {
  if (!credentials.key) {
    window.MessageModal.showWarningMessage('请输入卡密');
    return;
  }
  window.MessageModal.showConfirmDialog(
    '确定解绑吗',
    async () => performLicenseUnbind(validateBtn, credentials),
    () => {},
  );
}

function applyLicenseValidationResponse(response, credentials) {
  const payload = extractValidationPayload(firstLicenseControlValue(response && response.result, response));
  displayExpirationInfo(firstLicenseControlValue(payload, response));
  if (response && response.ok) {
    applyValidatedLicenseResult(firstLicenseControlValue(payload, response), credentials);
    return;
  }
  const message = licenseControlText(
    response && response.result && response.result.message,
    response && response.error,
    '未知错误',
  );
  window.MessageModal.showErrorMessage(`卡密验证失败: ${message}`);
  applyValidationFailureState();
}

function finishLicenseValidation(validateBtn, credentials) {
  validateBtn.classList.remove('loading');
  if (!hasValidatedInSession) {
    setLicenseButtonsDisabled(true);
    return;
  }
  enableAllLicenseRequiredButtons();
  triggerNetworkMagicAfterValidation(
    credentials.key,
    credentials.deviceId,
    '[侧边栏] 触发验证后自动开启网络魔法失败:',
  );
}

async function validateNewLicense(validateBtn, keyInput, credentials) {
  const key = licenseControlText(keyInput.value);
  if (!key) {
    window.MessageModal.showWarningMessage('请输入卡密');
    return;
  }
  const nextCredentials = { key, deviceId: credentials.deviceId };
  validateBtn.disabled = true;
  validateBtn.classList.add('loading');
  try {
    globalCurrentKey = key;
    globalCurrentDeviceId = credentials.deviceId;
    currentLicenseState.key = key;
    currentLicenseState.deviceId = credentials.deviceId;
    const response = await window.aiFree.license.validateKey({
      key,
      device_id: credentials.deviceId,
    });
    applyLicenseValidationResponse(response, nextCredentials);
  } catch (error) {
    console.error('验证卡密时出错:', error);
    window.MessageModal.showErrorMessage(`验证卡密时出错: ${licenseControlText(error && error.message, error)}`);
    applyValidationFailureState();
  } finally {
    finishLicenseValidation(validateBtn, nextCredentials);
  }
}

async function handleLicenseValidateClick(validateBtn, keyInput) {
  clearAutoValidateTimer();
  const credentials = currentLicenseControlCredentials(keyInput);
  const bound = validateBtn.dataset.licenseState === 'bound' || currentLicenseState.bound;
  if (bound) {
    confirmLicenseUnbind(validateBtn, credentials);
    return;
  }
  await validateNewLicense(validateBtn, keyInput, credentials);
}

function restoreLoadedLicense(credentials) {
  const key = licenseControlText(credentials.key);
  const deviceId = licenseControlText(credentials.deviceId);
  const keyInput = safeGetEl('key-input');
  if (keyInput) keyInput.value = key;
  globalCurrentKey = key;
  globalCurrentDeviceId = deviceId;
  hasValidatedInSession = false;
  applyValidateButtonState({ key, deviceId, bound: false });
  setLicenseButtonsDisabled(true);
  if (!key || credentials.validated !== true || credentials.bound !== true) return;
  displayExpirationInfo(credentials);
  applyValidatedLicenseResult(credentials, { key, deviceId });
  enableAllLicenseRequiredButtons();
  setAutoValidateStatus('已恢复账号登录状态');
  triggerNetworkMagicAfterValidation(
    key,
    deviceId,
    '[侧边栏] 恢复账号状态后自动开启网络魔法失败:',
  );
}

async function loadLicenseCredentials() {
  try {
    const requestRevision = licenseCredentialsUpdateRevision;
    const result = await window.aiFree.license.getUserCredentials();
    if (!result || !result.ok || !result.credentials) return;
    await consumeAutoValidateFlag();
    if (requestRevision !== licenseCredentialsUpdateRevision) return;
    restoreLoadedLicense(result.credentials);
  } catch (error) {
    console.warn('[前端] 加载凭证失败:', error);
  }
}

function createLicenseKeySaver() {
  return debounce(async (value) => {
    const key = licenseControlText(value);
    if (!key) return;
    try {
      const deviceInput = safeGetEl('device-id');
      await window.aiFree.license.saveUserCredentials({
        key,
        deviceId: licenseControlText(deviceInput && deviceInput.value, 'unknown'),
      });
    } catch (error) {
      console.warn('[前端] 自动保存卡密失败:', error);
    }
  }, 200);
}

function handleLicenseKeyInput(event, saveKeyDebounced) {
  clearAutoValidateTimer();
  const nextKey = licenseControlText(event.target.value);
  const previousKey = currentLicenseState.key;
  currentLicenseState.key = nextKey;
  currentLicenseState.deviceId = globalCurrentDeviceId || currentLicenseState.deviceId;
  globalCurrentKey = nextKey;
  if (currentLicenseState.bound && nextKey !== previousKey) {
    applyValidationFailureState({ disableLicenseButtons: true });
  }
  saveKeyDebounced(event.target.value);
}

function bindLicenseValidationControls() {
  const keyInput = safeGetEl('key-input');
  const validateBtn = safeGetEl('validate-key-btn');
  if (!keyInput || !validateBtn) return;
  void loadLicenseCredentials();
  const saveKeyDebounced = createLicenseKeySaver();
  keyInput.addEventListener('input', (event) => handleLicenseKeyInput(event, saveKeyDebounced));
  validateBtn.addEventListener('click', () => void handleLicenseValidateClick(validateBtn, keyInput));
  bindLicenseCredentialsListener();
}
