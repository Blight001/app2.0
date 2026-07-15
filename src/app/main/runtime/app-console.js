const util = require('util');

// 创建/初始化：createAppConsoleBridge的具体业务逻辑。
function createAppConsoleBridge({
  historyLimit = 500,
  getSenders = () => [],
  getDebugSenders = () => [],
  getSender = () => null,
} = {}) {
  const history = [];
  // 调试窗口历史包含普通应用日志和“仅调试窗口”日志；侧栏历史只使用 history。
  const debugHistory = [];
  const hasColor = Boolean(
    (process.stdout && process.stdout.isTTY)
    || (process.stderr && process.stderr.isTTY)
    || process.env.FORCE_COLOR
  );
  const COLORS = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
  };

// 格式化/规范化：formatValue的具体业务逻辑。
  function formatValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) return value.stack || value.message || String(value);
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

// 处理：detectSource的具体业务逻辑。
  function detectSource(args) {
    const text = args.map(formatValue).join(' ').trim();
    const match = text.match(/^\[([^\]]+)\]/);
    return match ? String(match[1] || '').trim() : '其它';
  }

// 校验/保护：shouldSuppressEntry的具体业务逻辑。
  function shouldSuppressEntry(args) {
    return detectSource(args) === 'TCP';
  }

  function buildEntry(level, args) {
    const source = detectSource(args);
    return {
      level,
      source,
      text: args.map(formatValue).join(' '),
      timestamp: new Date().toISOString(),
    };
  }

  function appendBounded(target, entry) {
    target.push(entry);
    if (target.length > historyLimit) {
      target.splice(0, target.length - historyLimit);
    }
  }

  function deliver(entry, resolveSenders) {
    try {
      const senderValue = typeof resolveSenders === 'function' ? resolveSenders() : [];
      const senderList = Array.isArray(senderValue) ? senderValue : [senderValue];
      const uniqueSenders = [];
      for (const sender of senderList) {
        if (!sender || typeof sender.send !== 'function') continue;
        if (uniqueSenders.includes(sender)) continue;
        uniqueSenders.push(sender);
        sender.send('app-console-line', entry);
      }
    } catch (_) {}
  }

// 处理：push的具体业务逻辑。
  function push(level, args) {
    try {
      if (shouldSuppressEntry(args)) {
        return;
      }
      const entry = buildEntry(level, args);
      appendBounded(history, entry);
      appendBounded(debugHistory, entry);
      deliver(entry, () => (typeof getSenders === 'function' ? getSenders() : getSender()));
    } catch (_) {}
  }

  // 高频网络请求只进入独立调试窗口：不写 stdout/stderr，也不投递侧栏/控制页。
  function pushDebugOnly(level, args) {
    try {
      const normalizedArgs = Array.isArray(args) ? args : [args];
      const entry = buildEntry(level, normalizedArgs);
      appendBounded(debugHistory, entry);
      deliver(entry, getDebugSenders);
      return entry;
    } catch (_) {
      return null;
    }
  }

// 处理：detectTag的具体业务逻辑。
  function detectTag(args) {
    const text = util.format(...args).trim();
    const match = text.match(/^\[([^\]]+)\]/);
    return match ? match[1] : '';
  }

// 处理：pickColor的具体业务逻辑。
  function pickColor(level, args) {
    if (!hasColor) return null;
    if (level === 'error') return COLORS.red;
    if (level === 'warn') return COLORS.yellow;

    const tag = detectTag(args);
    if (tag === '启动') return COLORS.cyan;
    if (tag === '配置') return COLORS.blue;
    if (tag === 'IPC') return COLORS.magenta;
    if (tag === 'bridge') return COLORS.green;
    if (tag === 'Shutdown') return COLORS.yellow;
    return COLORS.cyan;
  }

// 处理：emit的具体业务逻辑。
  function emit(level, args, originalConsole) {
    if (shouldSuppressEntry(args)) {
      return;
    }
    const line = util.format(...args);
    const color = pickColor(level, args);
    const text = color ? `${color}${line}${COLORS.reset}` : line;

    try {
      if (level === 'error') {
        originalConsole.error(text);
      } else if (level === 'warn') {
        originalConsole.warn(text);
      } else if (level === 'info') {
        originalConsole.info(text);
      } else {
        originalConsole.log(text);
      }
    } catch (error) {
      const code = error && error.code;
      if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED') {
        throw error;
      }
    }
  }

// 处理：install的具体业务逻辑。
  function install() {
    const originalConsole = {
      log: console.log.bind(console),
      info: typeof console.info === 'function' ? console.info.bind(console) : console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: typeof console.debug === 'function' ? console.debug.bind(console) : console.log.bind(console),
    };

    console.log = (...args) => {
      emit('info', args, originalConsole);
      push('info', args);
    };
    console.info = (...args) => {
      emit('info', args, originalConsole);
      push('info', args);
    };
    console.warn = (...args) => {
      emit('warn', args, originalConsole);
      push('warn', args);
    };
    console.error = (...args) => {
      emit('error', args, originalConsole);
      push('error', args);
    };
    console.debug = (...args) => {
      emit('info', args, originalConsole);
      push('info', args);
    };
  }

  return {
    install,
    pushDebugOnly,
    getHistory: () => history.slice(),
    getDebugHistory: () => debugHistory.slice(),
  };
}

module.exports = {
  createAppConsoleBridge,
};
