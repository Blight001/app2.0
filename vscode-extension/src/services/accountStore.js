// 账号历史记录：保存「服务器 /api/fetch_cookie 返回的账号」，供侧边栏历史列表展示与复用。
// 用 globalState 持久化（跨会话保留）。

const STATE_KEY = 'aiFreeTools.accountRecords';
const MAX_RECORDS = 50;

function buildId(account, platform) {
  const acc = String(account || '').trim().toLowerCase();
  const plat = String(platform || '').trim().toLowerCase();
  if (!acc) return '';
  return plat ? `${plat}::${acc}` : acc;
}

class AccountStore {
  constructor(context) {
    this.context = context;
    const saved = context.globalState.get(STATE_KEY, []);
    this.records = Array.isArray(saved) ? saved.filter((item) => item && typeof item === 'object') : [];
  }

  async persist() {
    await this.context.globalState.update(STATE_KEY, this.records);
  }

  // 按最近使用时间倒序返回
  list() {
    return this.records
      .slice()
      .sort((a, b) => (Date.parse(b?.lastUsedAt || '') || 0) - (Date.parse(a?.lastUsedAt || '') || 0));
  }

  get(id) {
    const normalized = String(id || '').trim();
    return this.records.find((item) => String(item?.id || '').trim() === normalized) || null;
  }

  async addOrUpdate(input = {}) {
    const account = String(input.account || '').trim();
    if (!account || account === '未知账号') return null;
    const platform = String(input.platform || input.currentPlatform || '').trim();
    const id = buildId(account, platform);
    if (!id) return null;

    const now = new Date().toISOString();
    const existing = this.get(id);
    const record = {
      id,
      account,
      platform,
      key: String(input.key || existing?.key || '').trim(),
      deviceId: String(input.deviceId || input.device_id || existing?.deviceId || '').trim(),
      currentAccountType: String(input.currentAccountType || input.current_account_type || existing?.currentAccountType || '').trim(),
      currentAccountTypeLabel: String(input.currentAccountTypeLabel || input.current_account_type_label || existing?.currentAccountTypeLabel || '').trim(),
      serverRecycleTime: String(input.serverRecycleTime || input.server_recycle_time || existing?.serverRecycleTime || '').trim(),
      cookieCount: Number.isFinite(Number(input.cookieCount)) ? Number(input.cookieCount) : (existing?.cookieCount || 0),
      createdAt: existing?.createdAt || now,
      lastUsedAt: now,
    };

    this.records = [record, ...this.records.filter((item) => String(item?.id || '').trim() !== id)].slice(0, MAX_RECORDS);
    await this.persist();
    return record;
  }

  async updateLastUsed(id) {
    const record = this.get(id);
    if (!record) return null;
    record.lastUsedAt = new Date().toISOString();
    this.records = [record, ...this.records.filter((item) => String(item?.id || '').trim() !== record.id)];
    await this.persist();
    return record;
  }

  async remove(id) {
    const normalized = String(id || '').trim();
    const before = this.records.length;
    this.records = this.records.filter((item) => String(item?.id || '').trim() !== normalized);
    if (this.records.length !== before) await this.persist();
    return this.records.length !== before;
  }

  async clear() {
    this.records = [];
    await this.persist();
  }
}

module.exports = {
  AccountStore,
};
