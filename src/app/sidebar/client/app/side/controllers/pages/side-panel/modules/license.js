// 侧边栏许可证 / 验证相关逻辑

// 设置/更新/持久化：setLicenseButtonsDisabled的具体业务逻辑。
function setLicenseButtonsDisabled(disabled) {
  if (typeof setLicenseRequiredButtonsDisabled === 'function') {
    setLicenseRequiredButtonsDisabled(disabled);
  } else {
    setButtonsDisabled('.requires-license', disabled);
    setButtonsDisabled('#open-dream-page-btn', disabled);
  }
  setAccountTabDisabled(disabled);
}

// 设置/更新/持久化：setAutoValidateStatus的具体业务逻辑。
function setAutoValidateStatus(message, level) {
  if (message) {
    console.log('[侧边栏][自动验证]', message, level ? `(${level})` : '');
  }
}

let autoValidateTimer = null;

// 停止/关闭/清理：clearAutoValidateTimer的具体业务逻辑。
function clearAutoValidateTimer() {
  if (autoValidateTimer) {
    clearTimeout(autoValidateTimer);
    autoValidateTimer = null;
  }
}

// 处理：captureLicenseState的具体业务逻辑。
function captureLicenseState(payload, { key = '', deviceId = '', bound = true } = {}) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const isValidated = bound === true || data.licenseValidated === true || data.validated === true;
  return {
    key,
    deviceId,
    bound: !!bound,
    regionInfo: isValidated ? normalizeRegionRoutingInfo(
      data.regionInfo
      || data.region_info
      || data.licenseRegionInfo
      || null,
    ) : null,
    canSelfUnbind: data.can_self_unbind === true || data.canSelfUnbind === true,
    remainingUnbindTimes: toFiniteNumber(data.remaining_unbind_times ?? data.remainingUnbindTimes),
    maxUnbindTimes: toFiniteNumber(data.max_unbind_times ?? data.maxUnbindTimes),
    usedUnbindTimes: toFiniteNumber(data.used_unbind_times ?? data.usedUnbindTimes),
    deviceBindCount: toFiniteNumber(data.device_bind_count ?? data.deviceBindCount),
    maxDeviceCount: toFiniteNumber(data.max_device_count ?? data.maxDeviceCount),
    deviceBindingStatus: data.device_binding_status || data.deviceBindingStatus || '',
    deviceBindingSummary: data.device_binding_summary || data.deviceBindingSummary || '',
  };
}

// 设置/更新/持久化：applyValidateButtonState的具体业务逻辑。
function applyValidateButtonState(state) {
  const validateBtn = safeGetEl('validate-key-btn');
  if (!validateBtn) return;

  currentLicenseState = {
    ...currentLicenseState,
    ...state,
    key: state && Object.prototype.hasOwnProperty.call(state, 'key') ? String(state.key || '') : currentLicenseState.key,
    deviceId: state && Object.prototype.hasOwnProperty.call(state, 'deviceId') ? String(state.deviceId || '') : currentLicenseState.deviceId,
    bound: !!(state && state.bound),
  };

  validateBtn.classList.remove('loading');
  validateBtn.disabled = false;
  validateBtn.dataset.licenseState = currentLicenseState.bound ? 'bound' : 'unbound';

  if (currentLicenseState.bound) {
    validateBtn.classList.add('validated');
    validateBtn.textContent = '解绑';
    validateBtn.title = '点击解绑';
  } else {
    validateBtn.classList.remove('validated');
    validateBtn.textContent = '验证';
    validateBtn.title = '请手动点击验证';
  }
}

// 创建/初始化：createBoundLicenseSnapshot的具体业务逻辑。
function createBoundLicenseSnapshot({ key, deviceId } = {}) {
  return {
    bound: true,
    key: key !== undefined ? key : currentLicenseState.key,
    deviceId: deviceId !== undefined ? deviceId : currentLicenseState.deviceId,
    canSelfUnbind: currentLicenseState.canSelfUnbind,
    remainingUnbindTimes: currentLicenseState.remainingUnbindTimes,
    maxUnbindTimes: currentLicenseState.maxUnbindTimes,
    usedUnbindTimes: currentLicenseState.usedUnbindTimes,
    deviceBindCount: currentLicenseState.deviceBindCount,
    maxDeviceCount: currentLicenseState.maxDeviceCount,
    deviceBindingStatus: currentLicenseState.deviceBindingStatus,
    deviceBindingSummary: currentLicenseState.deviceBindingSummary,
  };
}

// 处理：restoreBoundLicenseState的具体业务逻辑。
function restoreBoundLicenseState({ key, deviceId } = {}) {
  applyValidateButtonState(createBoundLicenseSnapshot({ key, deviceId }));
}

// 设置/更新/持久化：applyValidatedLicenseResult的具体业务逻辑。
function applyValidatedLicenseResult(payload, { key, deviceId } = {}) {
  const nextState = captureLicenseState(payload, {
    key,
    deviceId,
    bound: true,
  });
  hasValidatedInSession = true;
  applyValidateButtonState(nextState);
}

// 设置/更新/持久化：applyLicenseCredentialsToInput的具体业务逻辑。
function applyLicenseCredentialsToInput({ key = '', deviceId = '' } = {}) {
  const keyInput = safeGetEl('key-input');
  const deviceIdInput = safeGetEl('device-id');
  const normalizedKey = String(key || '').trim();
  const normalizedDeviceId = String(deviceId || '').trim();

  if (keyInput && normalizedKey) {
    keyInput.value = normalizedKey;
  }
  if (deviceIdInput && normalizedDeviceId) {
    deviceIdInput.value = normalizedDeviceId;
  }

  if (normalizedKey) {
    globalCurrentKey = normalizedKey;
    currentLicenseState.key = normalizedKey;
  }
  if (normalizedDeviceId) {
    globalCurrentDeviceId = normalizedDeviceId;
    currentLicenseState.deviceId = normalizedDeviceId;
  }
}

// 设置/更新/持久化：applyValidationFailureState的具体业务逻辑。
function applyValidationFailureState({ disableLicenseButtons = false } = {}) {
  hasValidatedInSession = false;
  resetLicenseStateToValidate();
  updateButtonStatesBasedOnConnection(false);
  if (disableLicenseButtons) {
    setLicenseButtonsDisabled(true);
  }
}

// 停止/关闭/清理：resetLicenseSummaryDisplay的具体业务逻辑。
function resetLicenseSummaryDisplay() {
  const expireEl = safeGetEl('expire-time');
  const usageEl = safeGetEl('usage-times');
  const accountLoggedIn = safeGetEl('sidebar-account-session')?.dataset.authenticated === 'true';
  const emptyText = accountLoggedIn ? '未验证' : '登录后显示';

  if (expireEl) {
    expireEl.textContent = emptyText;
    expireEl.style.color = accountLoggedIn ? '#e6a23c' : '';
  }

  if (usageEl) {
    usageEl.textContent = emptyText;
    usageEl.style.color = accountLoggedIn ? '#e6a23c' : '';
  }
}

// 停止/关闭/清理：resetLicenseStateToValidate的具体业务逻辑。
function resetLicenseStateToValidate() {
  currentLicenseState = {
    ...currentLicenseState,
    bound: false,
    regionInfo: null,
    canSelfUnbind: false,
    remainingUnbindTimes: null,
    maxUnbindTimes: null,
    usedUnbindTimes: null,
    deviceBindCount: null,
    maxDeviceCount: null,
    deviceBindingStatus: '',
    deviceBindingSummary: '',
  };
  resetLicenseSummaryDisplay();
  applyValidateButtonState({ bound: false });
}

// 启动/打开/显示：displayExpirationInfo的具体业务逻辑。
function displayExpirationInfo(result) {
  try {
    const el = safeGetEl('expire-time');
    const usageEl = safeGetEl('usage-times');
    const payload = extractValidationPayload(result);
    if (!payload) return;

    const licenseUsage = payload.licenseUsage && typeof payload.licenseUsage === 'object'
      ? payload.licenseUsage
      : null;
    const expireAt = payload.expire_at
      || payload.expireAt
      || payload.expiry_date
      || payload.expiryDate
      || payload.cardExpiryDate
      || licenseUsage?.expire_at
      || licenseUsage?.expireAt
      || '';
    const daysLeft = payload.days_left
      ?? payload.daysLeft
      ?? licenseUsage?.days_left
      ?? licenseUsage?.daysLeft;
    const expiresInSeconds = payload.expires_in_seconds
      ?? payload.expiresInSeconds
      ?? licenseUsage?.expires_in_seconds
      ?? licenseUsage?.expiresInSeconds;
    const hasExpiryData = expireAt !== undefined
      || daysLeft !== undefined
      || expiresInSeconds !== undefined;
    const usageText = formatUsageTimesText(payload);

    if (!hasExpiryData && !usageText) {
      return;
    }

    if (el) {
      if (expireAt) {
        el.textContent = formatValidationDate(expireAt);
        el.style.color = '#409eff';
      } else if (daysLeft !== undefined) {
        el.textContent = `剩余 ${daysLeft} 天`;
        el.style.color = '#409eff';
      } else if (expiresInSeconds !== undefined) {
        const remainingText = formatRemainingValidity(expiresInSeconds);
        if (remainingText) {
          el.textContent = remainingText;
          el.style.color = '#409eff';
        } else {
          el.textContent = '未知';
          el.style.color = '#e6a23c';
        }
      } else {
        el.textContent = '未知';
        el.style.color = '#e6a23c';
      }
    }

    if (usageEl) {
      if (usageText) {
        usageEl.textContent = usageText;
        usageEl.style.color = '#409eff';
      } else {
        usageEl.textContent = '未知';
        usageEl.style.color = '#e6a23c';
      }
    }
  } catch (e) {
    console.error('更新到期时间显示失败:', e);
  }
}

// 同步/连接：bindServerAccountCookieListener的具体业务逻辑。
function bindServerAccountCookieListener() {
  if (!window.electronAPI || typeof window.electronAPI.on !== 'function') {
    return;
  }

  window.electronAPI.on('server-account-cookie-received', async (data) => {
    try {
      const {
        platform,
        cookies,
        key,
        deviceId,
        userId,
        autoProcess,
        currentAccountType,
        currentAccountTypeLabel,
        current_account_type,
        current_account_type_label,
      } = data;

      if (!autoProcess) {
        return;
      }

      const keyInput = document.getElementById('key-input');
      const deviceIdInput = document.getElementById('device-id');
      if (!keyInput || !deviceIdInput) {
        console.error('[侧边栏] 找不到卡密或设备号输入框');
        return;
      }

// 处理：currentKey的具体业务逻辑。
      const currentKey = (keyInput.value || '').trim();
// 处理：currentDeviceId的具体业务逻辑。
      const currentDeviceId = (deviceIdInput.value || '').trim();
      const effectiveKey = key || currentKey;
      const effectiveDeviceId = deviceId || currentDeviceId;

      if (!hasValidatedInSession && !effectiveKey) {
        console.warn('[侧边栏] 当前会话未验证且没有有效卡密，无法自动处理账号cookie');
        return;
      }

      if (window.electron && typeof window.electron.openDreamPage === 'function') {
        try {
          const result = await window.electron.openDreamPage({
            key: effectiveKey,
            deviceId: effectiveDeviceId,
            serverPushedData: {
              platform,
              cookies,
              userId,
              currentAccountType,
              currentAccountTypeLabel,
              current_account_type,
              current_account_type_label,
            }
          });

          if (!result || result.ok !== true) {
            const msg = sanitizeUserFacingMessage((result && (result.message || result.error)) || '自动处理失败', '自动处理失败');
            console.error('[侧边栏] 自动处理服务器推送账号失败:', msg);
            if (window.MessageModal) {
              window.MessageModal.showErrorMessage(`自动处理${platform}账号失败：${msg}`);
            }
          }
        } catch (err) {
          console.error('[侧边栏] 自动调用openDreamPage失败:', err);
          if (window.MessageModal) {
            window.MessageModal.showErrorMessage(`自动处理${platform}账号失败：${sanitizeUserFacingMessage(err.message, '自动处理失败')}`);
          }
        }
      } else {
        console.error('[侧边栏] openDreamPage方法不可用，无法自动处理');
        if (window.MessageModal) {
          window.MessageModal.showErrorMessage('系统功能未就绪，无法自动处理账号');
        }
      }
    } catch (err) {
      console.error('[侧边栏] 处理服务器推送账号失败:', err);
      if (window.MessageModal) {
        window.MessageModal.showErrorMessage('处理服务器推送账号失败：' + sanitizeUserFacingMessage(err.message, '账号处理失败'));
      }
    }
  });
}

// 同步/连接：bindLicenseCredentialsListener的具体业务逻辑。
function bindLicenseCredentialsListener() {
  if (!window.electronAPI || typeof window.electronAPI.on !== 'function') {
    return;
  }

  window.electronAPI.on('license-credentials-updated', (data = {}) => {
    const usernameEl = safeGetEl('account-username-display');
    if (usernameEl) usernameEl.value = String(data.username || '');
    if (data.loggedOut === true) {
      const keyInput = safeGetEl('key-input');
      const deviceIdInput = safeGetEl('device-id');
      if (keyInput) keyInput.value = '';
      if (deviceIdInput) deviceIdInput.value = '';
      globalCurrentKey = '';
      globalCurrentDeviceId = '';
      hasValidatedInSession = false;
      resetLicenseStateToValidate();
      setLicenseButtonsDisabled(true);
      return;
    }
    try {
      applyLicenseCredentialsToInput({
        key: data.key,
        deviceId: data.deviceId,
      });
      if (data.validation && typeof data.validation === 'object') {
        displayExpirationInfo(data.validation);
        applyValidatedLicenseResult(data.validation, {
          key: data.key,
          deviceId: data.deviceId,
        });
        enableAllLicenseRequiredButtons();
      }
    } catch (error) {
      console.warn('[侧边栏] 处理卡密回填失败:', error?.message || error);
    }
  });
}

// 处理：consumeAutoValidateFlag的具体业务逻辑。
async function consumeAutoValidateFlag() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return { ok: false, pending: false, key: '', deviceId: '' };
  }

  try {
    const result = await window.electronAPI.invoke('consume-auto-validate-flag');
    if (result && result.ok) {
      return result;
    }
  } catch (e) {
    console.warn('[前端] 读取自动验证标记失败:', e);
  }

  return { ok: false, pending: false, key: '', deviceId: '' };
}

// 同步/连接：bindLicenseValidationControls的具体业务逻辑。
function bindLicenseValidationControls() {
  const keyInput = safeGetEl('key-input');
  const validateBtn = safeGetEl('validate-key-btn');
  if (!keyInput || !validateBtn) {
    return;
  }

// 处理/分发：handleValidateClick的具体业务逻辑。
  async function handleValidateClick() {
    clearAutoValidateTimer();
    const boundState = validateBtn.dataset.licenseState === 'bound' || currentLicenseState.bound;
    const currentKey = String((currentLicenseState.key || keyInput.value || '').trim());
    const currentDeviceId = String((currentLicenseState.deviceId || safeGetEl('device-id')?.value || 'unknown').trim() || 'unknown');

    if (boundState) {
      if (!currentKey) {
        window.MessageModal.showWarningMessage('请输入卡密');
        return;
      }

      const confirmMessage = '确定解绑吗';
      window.MessageModal.showConfirmDialog(confirmMessage, async () => {
        validateBtn.disabled = true;
        validateBtn.classList.add('loading');
        try {
          const resp = await window.electronAPI.invoke('unbind-device', {
            key: currentKey,
            device_id: currentDeviceId,
            deviceId: currentDeviceId,
          });

          if (resp?.ok) {
            const successMsg = resp?.message || '解绑成功';
            applyValidationFailureState();
            displayExpirationInfo(resp?.data || resp?.result || resp);
            window.MessageModal.showSuccessMessage(successMsg);
          } else {
            const msg = resp?.message || resp?.error || '未知错误';
            window.MessageModal.showErrorMessage('解绑失败: ' + msg);
            restoreBoundLicenseState({
              key: currentKey,
              deviceId: currentDeviceId,
            });
          }
        } catch (e) {
          console.error('解绑卡密时出错:', e);
          window.MessageModal.showErrorMessage('解绑卡密时出错: ' + (e?.message || String(e)));
          restoreBoundLicenseState({
            key: currentKey,
            deviceId: currentDeviceId,
          });
        } finally {
          validateBtn.classList.remove('loading');
        }
      }, () => {});
      return;
    }

    const key = keyInput.value?.trim();
    if (!key) {
      window.MessageModal.showWarningMessage('请输入卡密');
      return;
    }

    validateBtn.disabled = true;
    validateBtn.classList.add('loading');

    try {
      globalCurrentKey = key;
      currentLicenseState.key = key;
      currentLicenseState.deviceId = currentDeviceId;
      globalCurrentDeviceId = currentDeviceId;
      const resp = await window.electronAPI.invoke('validate-key', { key, device_id: currentDeviceId });
      const payload = extractValidationPayload(resp?.result || resp);
      displayExpirationInfo(payload || resp);
      if (resp?.ok) {
        displayExpirationInfo(payload || resp);
        applyValidatedLicenseResult(payload || resp, {
          key,
          deviceId: currentDeviceId,
        });
      } else {
        const msg = resp?.result?.message || resp?.error || '未知错误';
        window.MessageModal.showErrorMessage('卡密验证失败: ' + msg);
        applyValidationFailureState();
      }
    } catch (e) {
      console.error('验证卡密时出错:', e);
      window.MessageModal.showErrorMessage('验证卡密时出错: ' + (e?.message || String(e)));
      applyValidationFailureState();
      } finally {
        validateBtn.classList.remove('loading');
        if (hasValidatedInSession) {
          enableAllLicenseRequiredButtons();
          try {
            const vpnBtn = safeGetEl('VPN-switch');
            const startBtn = safeGetEl('start-clash-mini-btn');
            if (typeof autoStartClashMiniAfterValidation === 'function') {
              void autoStartClashMiniAfterValidation({
                startBtn,
                vpnBtn,
                key,
                deviceId: currentDeviceId,
              });
            }
          } catch (error) {
            console.warn('[侧边栏] 触发验证后自动开启网络魔法失败:', error?.message || error);
          }
        } else {
          setLicenseButtonsDisabled(true);
      }
    }
  }

// 获取/读取/解析：loadCredentials的具体业务逻辑。
  const loadCredentials = async () => {
    try {
      let loadedKey = '';
      let loadedDeviceId = '';
      const result = await window.electronAPI.invoke('get-user-credentials');
      if (result && result.ok && result.credentials) {
        const credentials = result.credentials;
        loadedKey = credentials.key || '';
        keyInput.value = loadedKey;
        globalCurrentKey = loadedKey || '';
        loadedDeviceId = credentials.deviceId || '';
        globalCurrentDeviceId = loadedDeviceId;

        hasValidatedInSession = false;
        applyValidateButtonState({
          key: loadedKey,
          deviceId: loadedDeviceId,
          bound: false,
        });

        setLicenseButtonsDisabled(true);

        // 清除旧版本遗留的自动卡密验证标记，但不再向中台调用 /api/validate_key。
        await consumeAutoValidateFlag();
        if (loadedKey && credentials.validated === true && credentials.bound === true) {
          displayExpirationInfo(credentials);
          applyValidatedLicenseResult(credentials, {
            key: loadedKey,
            deviceId: loadedDeviceId,
          });
          enableAllLicenseRequiredButtons();
          setAutoValidateStatus('已恢复账号登录状态');
          try {
            const vpnBtn = safeGetEl('VPN-switch');
            const startBtn = safeGetEl('start-clash-mini-btn');
            if (typeof autoStartClashMiniAfterValidation === 'function') {
              void autoStartClashMiniAfterValidation({
                startBtn,
                vpnBtn,
                key: loadedKey,
                deviceId: loadedDeviceId,
              });
            }
          } catch (error) {
            console.warn('[侧边栏] 恢复账号状态后自动开启网络魔法失败:', error?.message || error);
          }
        }
      }

      if (typeof warmupClashMiniProcess === 'function') {
        void warmupClashMiniProcess();
      }
    } catch (e) {
      console.warn('[前端] 加载凭证失败:', e);
    }
  };

  void loadCredentials();

  const saveKeyDebounced = debounce(async (value) => {
    if (value && value.trim()) {
      try {
        const deviceId = safeGetEl('device-id')?.value || 'unknown';
        await window.electronAPI.invoke('save-user-credentials', {
          key: value.trim(),
          deviceId: deviceId
        });
      } catch (e) {
        console.warn('[前端] 自动保存卡密失败:', e);
      }
    }
  }, 200);

  keyInput.addEventListener('input', (e) => {
    clearAutoValidateTimer();
    const nextKey = String(e.target.value || '').trim();
    const previousKey = currentLicenseState.key;
    currentLicenseState.key = nextKey;
    currentLicenseState.deviceId = globalCurrentDeviceId || currentLicenseState.deviceId;
    if (currentLicenseState.bound && nextKey !== previousKey) {
      globalCurrentKey = nextKey;
      applyValidationFailureState({ disableLicenseButtons: true });
    } else {
      globalCurrentKey = nextKey;
    }
    saveKeyDebounced(e.target.value);
  });

  validateBtn.addEventListener('click', () => {
    void handleValidateClick();
  });

  bindLicenseCredentialsListener();
}

