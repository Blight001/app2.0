'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findVsRoot() {
  const vswhereCandidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Visual Studio', 'Installer', 'vswhere.exe'),
  ];
  for (const vswhere of vswhereCandidates) {
    if (!vswhere || !fs.existsSync(vswhere)) continue;
    const detected = spawnSync(vswhere, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' });
    const detectedRoot = String(detected.stdout || '').trim();
    if (detected.status === 0 && fs.existsSync(path.join(detectedRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))) {
      return detectedRoot;
    }
  }
  const roots = [
    process.env.VSINSTALLDIR,
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
  ].filter(Boolean);
  return roots.find((candidate) => fs.existsSync(path.join(candidate, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))) || '';
}

function createMsvcEnvironment(vsRoot, workingDirectory) {
  const vcvars = path.join(vsRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const result = spawnSync('cmd.exe', [
    '/d', '/s', '/c', `"call "${vcvars}" >nul && set"`,
  ], {
    cwd: workingDirectory,
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) throw new Error('无法初始化 MSVC x64 编译环境');
  const environment = { ...process.env };
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return environment;
}

module.exports = { createMsvcEnvironment, findVsRoot };
