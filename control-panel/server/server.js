const http = require('http');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'control-panel.config.json');

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function safeResolve(rootDir, requestPath) {
  const normalized = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const resolved = path.resolve(rootDir, `.${normalized}`);
  const rootResolved = path.resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) return null;
  return resolved;
}

function startServer() {
  const cfg = readConfig();
  const host = String(cfg.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(cfg.port) > 0 ? Number(cfg.port) : 8787;
  const rootDir = path.resolve(__dirname, '..');

  function mapRequestPath(pathname) {
    if (pathname === '/' || pathname === '/control-panel' || pathname === '/control-panel/') {
      return '/index.html';
    }

    if (pathname.startsWith('/control-panel/')) {
      return pathname.slice('/control-panel'.length);
    }

    return pathname;
  }

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      const pathname = mapRequestPath(decodeURIComponent(url.pathname || '/'));

      let filePath = safeResolve(rootDir, pathname);
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', getContentType(filePath));
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(error?.message || String(error));
    }
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[control-panel] Port ${port} is already in use.`);
      console.error('[control-panel] Stop the existing process on 127.0.0.1:8787 and try again.');
    } else {
      console.error('[control-panel] Server error:', error);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`[control-panel] server listening on http://${host}:${port}/control-panel/`);
  });

  const shutdown = () => {
    try {
      server.close(() => process.exit(0));
    } catch (_) {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
