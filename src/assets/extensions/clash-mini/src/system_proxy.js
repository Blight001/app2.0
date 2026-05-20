const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const BACKUP_FILE_NAME = 'system-proxy-backup.json';
const INTERNET_SETTINGS_PATH = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const INTERNET_SETTINGS_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const LOCAL_PROXY_OVERRIDE = '<local>;127.0.0.1;localhost;::1';

function getBackupPath() {
  try {
    return path.join(app.getPath('userData'), BACKUP_FILE_NAME);
  } catch (_) {
    return path.join(process.cwd(), BACKUP_FILE_NAME);
  }
}

function readBackupState() {
  try {
    const backupPath = getBackupPath();
    if (!fs.existsSync(backupPath)) return null;
    const raw = fs.readFileSync(backupPath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeBackupState(state) {
  try {
    const backupPath = getBackupPath();
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function clearBackupState() {
  try {
    fs.rmSync(getBackupPath(), { force: true });
  } catch (_) {}
}

function parseIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

class SystemProxy {
  constructor(platform = process.platform) {
    this.platform = platform;
  }

  isSupported() {
    return this.platform === 'win32';
  }

  async enable({ host = '127.0.0.1', port = 7890 } = {}) {
    if (!this.isSupported()) {
      throw new Error('当前仅支持 Windows 代理切换');
    }

    await this._captureBackupIfNeeded();

    const proxyServer = `${host}:${port}`;
    await this._setRegistryDword('ProxyEnable', 1);
    await this._setRegistryString('ProxyServer', proxyServer);
    await this._setRegistryString('ProxyOverride', LOCAL_PROXY_OVERRIDE);
    await this._setRegistryDword('AutoDetect', 0);
    await this._deleteRegistryValue('AutoConfigURL');
    await this._notifyInternetSettingsChanged();
    return { ok: true, enabled: true, proxyServer, backupPath: getBackupPath() };
  }

  async disable(options = {}) {
    if (!this.isSupported()) {
      throw new Error('当前仅支持 Windows 代理切换');
    }

    return this.restore(options);
  }

  async restore({ resetWinHttp = false } = {}) {
    if (!this.isSupported()) {
      throw new Error('当前仅支持 Windows 代理切换');
    }

    const backupState = readBackupState();
    let result;

    if (backupState) {
      await this._applyRegistryState(backupState);
      result = {
        ok: true,
        enabled: false,
        restored: true,
        backupRestored: true,
        backupPath: getBackupPath(),
      };
    } else {
      await this._applyRegistryState({
        ProxyEnable: 0,
        ProxyServer: null,
        ProxyOverride: null,
        AutoConfigURL: null,
        AutoDetect: 1,
      });
      result = {
        ok: true,
        enabled: false,
        restored: true,
        backupRestored: false,
        backupPath: getBackupPath(),
      };
    }

    clearBackupState();

    if (resetWinHttp) {
      try {
        await this._resetWinHttpProxy();
        result.winHttpReset = true;
      } catch (error) {
        result.winHttpReset = false;
        result.winHttpResetError = error?.message || String(error);
      }
    }

    return result;
  }

  async repair(options = {}) {
    const restoreResult = await this.restore({ resetWinHttp: true, ...(options || {}) });
    return {
      ...restoreResult,
      repaired: true,
      message: restoreResult.backupRestored
        ? '已恢复电脑代理到原始状态，并重置 WinHTTP 代理'
        : '已清理电脑代理设置，并重置 WinHTTP 代理',
    };
  }

  async _captureBackupIfNeeded() {
    if (readBackupState()) return;
    try {
      const state = await this._captureCurrentRegistryState();
      if (state && typeof state === 'object') {
        state.capturedAt = new Date().toISOString();
        writeBackupState(state);
      }
    } catch (_) {}
  }

  async _captureCurrentRegistryState() {
    const script = `
$ErrorActionPreference = 'Stop'
$regPath = '${INTERNET_SETTINGS_PATH}'
function Read-RegValue([string]$name) {
  try {
    return Get-ItemPropertyValue -Path $regPath -Name $name -ErrorAction Stop
  } catch {
    return $null
  }
}

$state = [ordered]@{
  ProxyEnable = Read-RegValue 'ProxyEnable'
  ProxyServer = Read-RegValue 'ProxyServer'
  ProxyOverride = Read-RegValue 'ProxyOverride'
  AutoConfigURL = Read-RegValue 'AutoConfigURL'
  AutoDetect = Read-RegValue 'AutoDetect'
}

$state | ConvertTo-Json -Compress -Depth 4
`;

    const output = await this._runPowerShell(script);
    if (!output) return null;
    try {
      const parsed = JSON.parse(output);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  async _applyRegistryState(state = {}) {
    const next = state && typeof state === 'object' ? state : {};
    await this._setRegistryStateValue('ProxyEnable', next.ProxyEnable, 'dword');
    await this._setRegistryStateValue('ProxyServer', next.ProxyServer, 'string');
    await this._setRegistryStateValue('ProxyOverride', next.ProxyOverride, 'string');
    await this._setRegistryStateValue('AutoConfigURL', next.AutoConfigURL, 'string');
    await this._setRegistryStateValue('AutoDetect', next.AutoDetect, 'dword');
    await this._notifyInternetSettingsChanged();
  }

  _setRegistryStateValue(name, value, type) {
    if (value === null || value === undefined || value === '') {
      return this._deleteRegistryValue(name);
    }
    if (type === 'dword') {
      return this._setRegistryDword(name, value);
    }
    return this._setRegistryString(name, value);
  }

  _setRegistryString(name, value) {
    return this._runReg([
      'add',
      INTERNET_SETTINGS_REG_KEY,
      '/v',
      String(name),
      '/t',
      'REG_SZ',
      '/d',
      String(value ?? ''),
      '/f',
    ]);
  }

  _setRegistryDword(name, value) {
    const numericValue = parseIntegerOrNull(value);
    if (numericValue === null) {
      return this._deleteRegistryValue(name);
    }
    return this._runReg([
      'add',
      INTERNET_SETTINGS_REG_KEY,
      '/v',
      String(name),
      '/t',
      'REG_DWORD',
      '/d',
      String(numericValue),
      '/f',
    ]);
  }

  _deleteRegistryValue(name) {
    return this._registryValueExists(name).then((exists) => {
      if (!exists) {
        return '';
      }
      return this._runReg([
        'delete',
        INTERNET_SETTINGS_REG_KEY,
        '/v',
        String(name),
        '/f',
      ]);
    });
  }

  _registryValueExists(name) {
    return new Promise((resolve, reject) => {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const regExe = path.join(systemRoot, 'System32', 'reg.exe');
      const command = fs.existsSync(regExe) ? regExe : 'reg.exe';
      const child = spawn(command, [
        'query',
        INTERNET_SETTINGS_REG_KEY,
        '/v',
        String(name),
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(true);
          return;
        }
        if (code === 1) {
          resolve(false);
          return;
        }
        reject(new Error(stderr.trim() || stdout.trim() || `reg.exe query exited with code ${code}`));
      });
    });
  }

  _notifyInternetSettingsChanged() {
    const script = `
$signature = @"
[DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
"@
Add-Type -MemberDefinition $signature -Name WinInet -Namespace PInvoke | Out-Null
[PInvoke.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[PInvoke.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`;

    return this._runPowerShell(script).catch(() => null);
  }

  _runReg(args) {
    return new Promise((resolve, reject) => {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const regExe = path.join(systemRoot, 'System32', 'reg.exe');
      const command = fs.existsSync(regExe) ? regExe : 'reg.exe';
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr.trim() || stdout.trim() || `reg.exe exited with code ${code}`));
        }
      });
    });
  }

  _runPowerShell(script) {
    return new Promise((resolve, reject) => {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const powershellExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const pwshExe = path.join(systemRoot, 'System32', 'PowerShell', '7', 'pwsh.exe');
      const command = fs.existsSync(powershellExe) ? powershellExe : (fs.existsSync(pwshExe) ? pwshExe : 'powershell.exe');
      const ps = spawn(command, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      ps.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      ps.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      ps.on('error', reject);
      ps.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error([
            stderr.trim() || '',
            stdout.trim() || '',
            `PowerShell exited with code ${code}`,
          ].filter(Boolean).join(' | ')));
        }
      });
    });
  }

  _resetWinHttpProxy() {
    return new Promise((resolve, reject) => {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const netshExe = path.join(systemRoot, 'System32', 'netsh.exe');
      const command = fs.existsSync(netshExe) ? netshExe : 'netsh';
      const child = spawn(command, ['winhttp', 'reset', 'proxy'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `netsh exited with code ${code}`));
      });
    });
  }
}

function createSystemProxy() {
  return new SystemProxy();
}

async function enableSystemProxy(options) {
  return createSystemProxy().enable(options);
}

async function disableSystemProxy(options) {
  return createSystemProxy().disable(options);
}

async function restoreSystemProxy(options) {
  return createSystemProxy().restore(options);
}

async function repairSystemProxy(options) {
  return createSystemProxy().repair(options);
}

module.exports = {
  SystemProxy,
  createSystemProxy,
  enableSystemProxy,
  disableSystemProxy,
  restoreSystemProxy,
  repairSystemProxy,
};
