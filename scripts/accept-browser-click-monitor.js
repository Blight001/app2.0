'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const binding = require(path.join(
  __dirname,
  '../native/browser-host/build/Release/browser_host.node',
));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clickWindow(hwndBuffer) {
  const bytes = Buffer.from(hwndBuffer);
  const rawHwnd = bytes.readBigUInt64LE(0).toString();
  const source = String.raw`
using System;
using System.Runtime.InteropServices;
public static class BrowserClickProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {
    public int Left, Top, Right, Bottom;
  }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  public static void Click(long raw) {
    IntPtr hwnd = new IntPtr(raw);
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) throw new Exception("GetWindowRect failed");
    SetForegroundWindow(hwnd);
    SetCursorPos((rect.Left + rect.Right) / 2, (rect.Top + rect.Bottom) / 2);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}`;
  const script = `Add-Type -TypeDefinition @'\n${source}\n'@\n[BrowserClickProbe]::Click([long]'${rawHwnd}')`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || stdout || 'click probe failed'));
    });
  });
}

app.whenReady().then(async () => {
  const watched = new BrowserWindow({ x: 80, y: 100, width: 320, height: 240, show: true });
  const other = new BrowserWindow({ x: 480, y: 100, width: 320, height: 240, show: true });
  await Promise.all([
    watched.loadURL('data:text/html,<title>WATCHED</title><body>watched</body>'),
    other.loadURL('data:text/html,<title>OTHER</title><body>other</body>'),
  ]);
  await delay(200);

  const watchedHwnd = watched.getNativeWindowHandle();
  let clicks = 0;
  assert.equal(binding.watchChildWindowClicks({ childHwnd: watchedHwnd }, () => { clicks += 1; }), true);

  await clickWindow(other.getNativeWindowHandle());
  await delay(150);
  assert.equal(clicks, 0, 'click outside watched HWND must be ignored');

  await clickWindow(watchedHwnd);
  await delay(150);
  assert.equal(clicks, 1, 'click inside watched HWND must be reported once');

  assert.equal(binding.unwatchChildWindowClicks({ childHwnd: watchedHwnd }), true);
  await clickWindow(watchedHwnd);
  await delay(150);
  assert.equal(clicks, 1, 'unwatched HWND must stop reporting clicks');

  watched.destroy();
  other.destroy();
  console.log('native browser click monitor acceptance passed');
  app.quit();
}).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
