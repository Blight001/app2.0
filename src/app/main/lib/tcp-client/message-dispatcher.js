// 获取/读取/解析：getRealProxyStatus的具体业务逻辑。
async function getRealProxyStatus({ app, fs, path, getCoreDir, getStorePath }) {
  try {
    let userDataDir;
    try {
      userDataDir = app.getPath('userData');
    } catch (err) {
      userDataDir = getCoreDir();
    }

    const trafficStatsPath = path.join(getCoreDir(), 'traffic_stats.json');
    const storePath = getStorePath();

    let trafficUsed = 0;
    try {
      const trafficData = JSON.parse(await fs.readFile(trafficStatsPath, 'utf8'));
      trafficUsed = (trafficData.rx_total || 0) + (trafficData.tx_total || 0);
    } catch (_) {
      trafficUsed = 0;
    }

    let sysProxyEnabled = false;
    try {
      const storeData = JSON.parse(await fs.readFile(storePath, 'utf8'));
      sysProxyEnabled = storeData.systemProxyEnabled || false;
    } catch (_) {
      sysProxyEnabled = false;
    }

    return {
      sys_proxy_enabled: sysProxyEnabled,
      traffic_used: Math.round(trafficUsed),
    };
  } catch (err) {
    console.error('[TCP] 获取真实代理状态失败:', err.message);
    return {
      sys_proxy_enabled: false,
      traffic_used: 0,
    };
  }
}

// 处理/分发：handleGetProxyStatusRequest的具体业务逻辑。
async function handleGetProxyStatusRequest(client, messageData, { proxyStatusRespType, deps }) {
  try {
    const proxyStatus = await getRealProxyStatus(deps);
    const responseData = {
      user_id: messageData.data?.user_id,
      status: {
        sys_proxy_enabled: proxyStatus.sys_proxy_enabled,
        traffic_used: proxyStatus.traffic_used,
      },
      timestamp: Date.now(),
    };

    await client.sendMessage(proxyStatusRespType, responseData);
  } catch (err) {
    console.error('[TCP] 处理代理状态请求失败:', err.message);
  }
}

// 格式化/规范化：normalizeTimeValueToMs的具体业务逻辑。
function normalizeTimeValueToMs(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    if (value > 0) return Math.floor(value * 1000);
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    if (text.length >= 13) return Math.floor(num);
    if (text.length === 10) return Math.floor(num * 1000);
    if (num > 1e12) return Math.floor(num);
    if (num > 1e9) return Math.floor(num * 1000);
    return Math.floor(num * 1000);
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

// 格式化/规范化：normalizePositiveNumber的具体业务逻辑。
function normalizePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

// 获取/读取/解析：resolveServerRecycleTimeInfo的具体业务逻辑。
function resolveServerRecycleTimeInfo(source) {
  if (!source || typeof source !== 'object') {
    return {
      serverRecycleTime: '',
      serverRecycleTimeTs: null,
      serverRecycleTimeIso: '',
    };
  }

  const explicitValue = source.server_recycle_time ?? source.serverRecycleTime;
  const nextRefreshValue = source.next_refresh_at
    ?? source.nextRefreshAt
    ?? source.refresh_info?.next_refresh_at
    ?? source.refresh_info?.nextRefreshAt
    ?? source.refreshInfo?.next_refresh_at
    ?? source.refreshInfo?.nextRefreshAt;
  const remainingSeconds = normalizePositiveNumber(
    source.remaining_seconds
    ?? source.remainingSeconds
    ?? source.refresh_info?.remaining_seconds
    ?? source.refresh_info?.remainingSeconds
    ?? source.refreshInfo?.remaining_seconds
    ?? source.refreshInfo?.remainingSeconds
  );
  const remainingMinutes = normalizePositiveNumber(
    source.remaining_minutes
    ?? source.remainingMinutes
    ?? source.refresh_info?.remaining_minutes
    ?? source.refresh_info?.remainingMinutes
    ?? source.refreshInfo?.remaining_minutes
    ?? source.refreshInfo?.remainingMinutes
  );
  const explicitTs = normalizeTimeValueToMs(explicitValue);
  const nextRefreshTs = normalizeTimeValueToMs(nextRefreshValue);
  const remainingTs = remainingSeconds
    ? Date.now() + Math.floor(remainingSeconds * 1000)
    : (remainingMinutes ? Date.now() + Math.floor(remainingMinutes * 60 * 1000) : null);
  const serverRecycleTimeTs = explicitTs || nextRefreshTs || remainingTs || null;
  const rawValue = explicitValue
    ?? nextRefreshValue
    ?? (remainingSeconds ? String(remainingSeconds) : null)
    ?? (remainingMinutes ? String(remainingMinutes * 60) : null);

  return {
    serverRecycleTime: serverRecycleTimeTs
      ? (typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : new Date(serverRecycleTimeTs).toISOString())
      : '',
    serverRecycleTimeTs,
    serverRecycleTimeIso: serverRecycleTimeTs ? new Date(serverRecycleTimeTs).toISOString() : '',
  };
}

// 处理/分发：handleAccountCookiePush的具体业务逻辑。
async function handleAccountCookiePush(client, messageData) {
  try {
    if (!messageData.data) {
      console.error('[TCP] 服务器推送的账号信息缺少data字段');
      return;
    }

    const {
      platform,
      cookies,
      key,
      device_id,
      user_id,
      server_recycle_time,
      serverRecycleTime,
      serverRecycleTimeTs,
      serverRecycleTimeIso,
      ai_account_expiry_time,
      aiAccountExpiryTime,
      next_refresh_at,
      nextRefreshAt,
      remaining_seconds,
      remainingSeconds,
      remaining_minutes,
      remainingMinutes,
      refresh_info,
      refreshInfo,
      current_account_type,
      current_account_type_label,
      currentAccountType,
      currentAccountTypeLabel,
    } = messageData.data;

    if (!platform) {
      console.error('[TCP] 服务器推送的账号信息缺少platform字段');
      return;
    }

    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      console.error('[TCP] 服务器推送的账号信息缺少有效的cookies');
      return;
    }

    console.log(`[TCP] 收到${platform}平台的账号，共${cookies.length}个cookie`);
    const recycleTimeInfo = resolveServerRecycleTimeInfo(messageData.data);

    if (client.onServerMessage) {
      console.log('[TCP] 转发账号信息到侧边栏进行自动处理');
      client.onServerMessage({
        type: 'account_cookie_auto_process',
        data: {
          platform,
          cookies,
          key,
          deviceId: device_id,
          userId: user_id,
          ...recycleTimeInfo,
          server_recycle_time,
          serverRecycleTime: serverRecycleTime || recycleTimeInfo.serverRecycleTime,
          serverRecycleTimeTs: serverRecycleTimeTs ?? recycleTimeInfo.serverRecycleTimeTs,
          serverRecycleTimeIso: serverRecycleTimeIso || recycleTimeInfo.serverRecycleTimeIso,
          ai_account_expiry_time,
          aiAccountExpiryTime,
          next_refresh_at,
          nextRefreshAt,
          remaining_seconds,
          remainingSeconds,
          remaining_minutes,
          remainingMinutes,
          refresh_info,
          refreshInfo,
          currentAccountType: currentAccountType || current_account_type,
          currentAccountTypeLabel: currentAccountTypeLabel || current_account_type_label,
          current_account_type: current_account_type || currentAccountType,
          current_account_type_label: current_account_type_label || currentAccountTypeLabel,
          autoProcess: true,
        },
        message: `收到服务器推送的${platform}账号，正在自动处理...`,
        timestamp: Date.now(),
      });
    } else {
      console.error('[TCP] 服务器消息回调未设置，无法处理账号cookie');
    }
  } catch (err) {
    console.error('[TCP] 处理服务器推送账号cookie信息失败:', err.message);
  }
}

// 处理/分发：handleServerMessage的具体业务逻辑。
async function handleServerMessage(client, messageData, options) {
  try {
    if (messageData.type === 'maintenance' || (messageData.message && messageData.message.includes('维护'))) {
      client.lastKnownStatus = 'maintenance';
    } else if (messageData.type === 'normal' || messageData.type === 'info') {
      client.lastKnownStatus = null;
    }

    if (messageData.type === 'get_proxy_status') {
      await handleGetProxyStatusRequest(client, messageData, options);
      return;
    }

    if (messageData.type === 'account_cookie_push') {
      await handleAccountCookiePush(client, messageData);
      return;
    }

    if (client.onServerMessage && typeof client.onServerMessage === 'function') {
      client.onServerMessage(messageData);
    } else {
      console.warn('[TCP] 未设置服务器消息处理回调，无法显示弹窗');
    }
  } catch (err) {
    console.error('[TCP] 处理服务器消息失败:', err.message);
  }
}

// 处理/分发：handleCompleteMessage的具体业务逻辑。
async function handleCompleteMessage(client, data, options) {
  try {
    const msgId = data.readUInt32BE(0);
    const msgType = data.readUInt16BE(4);
    const dataLen = data.readUInt32BE(6);

    const jsonData = data.slice(10, 10 + dataLen).toString('utf8');
    const responseData = JSON.parse(jsonData);

    if (msgType === options.serverMessageType) {
      console.log('[TCP] 处理服务器推送消息');
      await handleServerMessage(client, responseData, options);
      return;
    }

    const pending = client.pendingRequests.get(msgId);
    if (pending) {
      clearTimeout(pending.timeout);
      client.pendingRequests.delete(msgId);
      pending.resolve(responseData);
    } else {
      console.warn(`[TCP] 未找到对应的待处理请求，msgId:${msgId}`);
    }
  } catch (err) {
    console.error('[TCP] 处理完整消息失败:', err.message);
    console.error('[TCP] 消息数据:', data);
  }
}

// 处理/分发：processBuffer的具体业务逻辑。
async function processBuffer(client, options) {
  while (client.receiveBuffer.length >= 10) {
    try {
      const dataLen = client.receiveBuffer.readUInt32BE(6);
      const totalMessageLen = 10 + dataLen;
      if (client.receiveBuffer.length < totalMessageLen) {
        break;
      }

      const messageData = client.receiveBuffer.slice(0, totalMessageLen);
      client.receiveBuffer = client.receiveBuffer.slice(totalMessageLen);
      await handleCompleteMessage(client, messageData, options);
    } catch (err) {
      console.error('[TCP] 解析消息头失败:', err.message);
      console.error('[TCP] 清空缓冲区以恢复正常状态');
      client.receiveBuffer = Buffer.alloc(0);
      break;
    }
  }
}

// 处理/分发：handleIncomingData的具体业务逻辑。
async function handleIncomingData(client, data, options) {
  client.receiveBuffer = Buffer.concat([client.receiveBuffer, data]);
  await processBuffer(client, options);
}

module.exports = {
  getRealProxyStatus,
  handleAccountCookiePush,
  handleCompleteMessage,
  handleGetProxyStatusRequest,
  handleIncomingData,
  handleServerMessage,
  processBuffer,
};
