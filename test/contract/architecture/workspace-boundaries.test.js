'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const sourceRoot = path.join(projectRoot, 'src', 'app');

function walkJavaScript(target, files = []) {
  if (!fs.existsSync(target)) return files;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.js')) files.push(target);
    return files;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) walkJavaScript(child, files);
    else if (entry.name.endsWith('.js')) files.push(child);
  }
  return files;
}

function relativeImports(file) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = [];
  const pattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) {
    const specifier = match[1] || match[2];
    if (specifier.startsWith('.')) imports.push(path.resolve(path.dirname(file), specifier));
  }
  return imports;
}

function inside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function crossDomainViolations(sourceDirectories, forbiddenDirectories) {
  const violations = [];
  for (const sourceDirectory of sourceDirectories) {
    for (const file of walkJavaScript(sourceDirectory)) {
      for (const imported of relativeImports(file)) {
        const forbidden = forbiddenDirectories.find((directory) => inside(imported, directory));
        if (!forbidden) continue;
        violations.push({
          file: path.relative(projectRoot, file).replace(/\\/g, '/'),
          imported: path.relative(projectRoot, imported).replace(/\\/g, '/'),
        });
      }
    }
  }
  return violations;
}

test('Browser domain 不得引用 Software domain 内部实现', () => {
  const violations = crossDomainViolations([
    path.join(sourceRoot, 'main/features/browser'),
    path.join(sourceRoot, 'main/features/browser-automation'),
  ], [
    path.join(sourceRoot, 'main/features/external-app'),
    path.join(sourceRoot, 'main/features/software-ai'),
    path.join(sourceRoot, 'main/features/software-automation'),
  ]);
  assert.deepEqual(violations, []);
});

test('Software domain 不得引用 Browser domain 内部实现', () => {
  const violations = crossDomainViolations([
    path.join(sourceRoot, 'main/features/external-app'),
    path.join(sourceRoot, 'main/features/software-ai'),
    path.join(sourceRoot, 'main/features/software-automation'),
  ], [
    path.join(sourceRoot, 'main/features/browser'),
    path.join(sourceRoot, 'main/features/browser-automation'),
  ]);
  assert.deepEqual(violations, []);
});

test('各 renderer 工作域不得跨域引用 controller 或页面实现', () => {
  const rendererRoot = path.join(sourceRoot, 'renderer');
  const workspaces = ['home', 'browser-workspace', 'software-workspace'];
  for (const workspace of workspaces) {
    const forbidden = workspaces
      .filter((candidate) => candidate !== workspace)
      .map((candidate) => path.join(rendererRoot, candidate));
    assert.deepEqual(
      crossDomainViolations([path.join(rendererRoot, workspace)], forbidden),
      [],
      `${workspace} renderer 存在跨域引用`,
    );
  }
});

test('Home 运行代码不引用 TabManager、Chromium Runtime 或软件执行器', () => {
  const files = [
    path.join(sourceRoot, 'main/workspace/home-window-controller.js'),
    ...walkJavaScript(path.join(sourceRoot, 'renderer/home')),
  ];
  const forbiddenPattern = /(?:tab-manager|browser-runtime|features[\\/]external-app|software-automation)/;
  const violations = files
    .filter((file) => forbiddenPattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(projectRoot, file).replace(/\\/g, '/'));
  assert.deepEqual(violations, []);
});
