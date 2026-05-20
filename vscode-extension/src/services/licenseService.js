const vscode = require('vscode');
const { postJson } = require('./httpClient');
const { ServerResolver } = require('./serverResolver');

const STATE_KEY = 'aiFreeTools.licenseState';

function normalizeValidationResult(source = {}) {
  const body = source && typeof source === 'object' ? source : {};
  const valid = Object.prototype.hasOwnProperty.call(body, 'valid')
    ? body.valid === true
    : (body.ok === true || body.success === true || String(body.state || body.status || '').toLowerCase() === 'active');
  return {
    ok: valid,
    valid,
    message: body.message || body.msg || (valid ? '卡密有效' : '卡密验证失败'),
    expire_at: body.expire_at || body.expireAt || body.expiryDate || body.expiry_date || '',
    days_left: body.days_left ?? body.daysLeft ?? null,
    remaining_usage_times: body.remaining_usage_times ?? body.remainingUsageTimes ?? body.remaining_uses ?? body.remainingUses ?? null,
    max_usage_times: body.max_usage_times ?? body.maxUsageTimes ?? null,
    used_usage_times: body.used_usage_times ?? body.usedUsageTimes ?? null,
    raw: body,
  };
}

class LicenseService {
  constructor(context, deps = {}) {
    this.context = context;
    this.logService = deps.logService || null;
    this.resolver = new ServerResolver(context, { logService: this.logService });
    this.state = this.readState();
  }

  readState() {
    const saved = this.context.globalState.get(STATE_KEY, {});
    return saved && typeof saved === 'object'
      ? {
          key: String(saved.key || '').trim(),
          deviceId: String(saved.deviceId || '').trim(),
          validated: saved.validated === true,
          runtimeConfig: saved.runtimeConfig && typeof saved.runtimeConfig === 'object' ? saved.runtimeConfig : {},
          validation: saved.validation && typeof saved.validation === 'object' ? saved.validation : {},
          records: Array.isArray(saved.records) ? saved.records : [],
        }
      : { key: '', deviceId: '', validated: false, runtimeConfig: {}, validation: {}, records: [] };
  }

  async persist() {
    await this.context.globalState.update(STATE_KEY, this.state);
  }

  getDeviceId() {
    return vscode.env.machineId || this.state.deviceId || '';
  }

  getCredentials() {
    return {
      key: this.state.key || '',
      deviceId: this.state.deviceId || this.getDeviceId(),
      validated: this.state.validated === true,
      licenseValidated: this.state.validated === true,
      runtimeConfig: this.state.runtimeConfig || {},
      validation: this.state.validation || {},
      records: this.state.records || [],
    };
  }

  getRuntimeConfig() {
    return this.state.runtimeConfig || {};
  }

  getTargetUrl(fallback) {
    return String(this.state.runtimeConfig?.targetUrl || fallback || '').trim();
  }

  getTutorialUrl(fallback) {
    return String(this.state.runtimeConfig?.tutorialUrl || fallback || '').trim();
  }

  getPlatformName() {
    return String(this.state.runtimeConfig?.platformName || 'VS Code').trim();
  }

  rememberRecord(key, status = 'success') {
    const value = String(key || '').trim();
    if (!value) return;
    const next = [
      { id: value, keyValue: value, status, updatedAt: new Date().toISOString() },
      ...(this.state.records || []).filter((item) => String(item?.keyValue || item?.key || '').trim() !== value),
    ].slice(0, 20);
    this.state.records = next;
  }

  async validateKey({ key, deviceId }) {
    const normalizedKey = String(key || '').trim();
    const normalizedDeviceId = String(deviceId || this.getDeviceId() || '').trim();
    if (!normalizedKey) return { ok: false, message: '请输入卡密' };

    this.logService?.info?.('开始卡密搜索', { source: 'license', keyPreview: `${normalizedKey.slice(0, 5)}***` });
    const resolved = await this.resolver.resolveForKey(normalizedKey);
    if (!resolved.ok) {
      this.logService?.warn?.(`卡密搜索失败：${resolved.error || 'unknown'}`, { source: 'license' });
      this.rememberRecord(normalizedKey, 'failed');
      await this.persist();
      return { ok: false, message: resolved.error || '卡密搜索失败' };
    }

    const runtimeConfig = {
      platformName: String(resolved.data.platformName || '').trim(),
      targetUrl: String(resolved.data.targetUrl || '').trim(),
      tutorialUrl: String(resolved.data.tutorialUrl || '').trim(),
      clientHttpBase: String(resolved.data.clientHttpBase || resolved.data.address_HTTP || resolved.data.serverBase || '').trim(),
      serverBase: String(resolved.data.clientHttpBase || resolved.data.address_HTTP || resolved.data.serverBase || '').trim(),
      tcp: resolved.data.tcp || null,
      address_TCP: String(resolved.data.address_TCP || '').trim(),
    };

    let secondValidation = {
      ok: true,
      valid: true,
      message: resolved.data.message || '卡密有效',
      expire_at: resolved.data.expire_at || resolved.data.expiryDate || '',
      raw: resolved.data,
    };

    if (runtimeConfig.serverBase) {
      const validateUrl = `${runtimeConfig.serverBase.replace(/\/+$/, '')}/api/validate_key`;
      this.logService?.info?.(`开始客户端二次验证：${validateUrl}`, { source: 'license', url: validateUrl, clientHttpBase: runtimeConfig.clientHttpBase || runtimeConfig.serverBase });
      const resp = await postJson(validateUrl, {
        key: normalizedKey,
        device_id: normalizedDeviceId,
      }, 12000);
      this.logService?.info?.(`客户端二次验证响应状态：HTTP ${resp?.status || 0}`, { source: 'license', url: validateUrl, status: resp?.status || 0 });
      const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
      secondValidation = normalizeValidationResult({
        ok: resp.ok,
        status: resp.status,
        ...body,
      });
      secondValidation.requestUrl = validateUrl;
      if (!secondValidation.ok) {
        this.logService?.warn?.(`客户端二次验证失败：${secondValidation.message || 'unknown'}`, { source: 'license', url: validateUrl });
        this.state = {
          ...this.state,
          key: normalizedKey,
          deviceId: normalizedDeviceId,
          validated: false,
          runtimeConfig,
          validation: secondValidation,
        };
        this.rememberRecord(normalizedKey, 'failed');
        await this.persist();
        return { ok: false, message: secondValidation.message || '客户端二次验证失败', validation: secondValidation };
      }
    }

    this.state = {
      ...this.state,
      key: normalizedKey,
      deviceId: normalizedDeviceId,
      validated: true,
      runtimeConfig,
      validation: secondValidation,
    };
    this.rememberRecord(normalizedKey, 'success');
    await this.persist();
    this.logService?.success?.(`卡密验证成功，客户端HTTP：${runtimeConfig.clientHttpBase || runtimeConfig.serverBase || '未返回'}，平台：${runtimeConfig.platformName || '未知'}`, { source: 'license', platformName: runtimeConfig.platformName || '', clientHttpBase: runtimeConfig.clientHttpBase || runtimeConfig.serverBase || '' });
    return {
      ok: true,
      valid: true,
      message: secondValidation.message || resolved.data.message || '卡密有效',
      expire_at: secondValidation.expire_at || resolved.data.expire_at || resolved.data.expiryDate || '',
      days_left: secondValidation.days_left ?? resolved.data.days_left ?? null,
      remaining_usage_times: secondValidation.remaining_usage_times ?? resolved.data.remaining_usage_times ?? null,
      licenseUsage: secondValidation.raw || resolved.data,
      runtimeConfig,
      resolved: resolved.data,
      validation: secondValidation,
    };
  }
}

module.exports = {
  LicenseService,
};
