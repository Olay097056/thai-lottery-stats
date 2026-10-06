const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const launcherPath = path.join(root, 'scripts', 'run_here.ps1');
const readinessPath = path.join(root, 'scripts', 'open_when_ready.ps1');
const launcher = fs.readFileSync(launcherPath, 'utf8');

assert(
  !/Start-Process\s+["']http:\/\/localhost:\$Port["']/.test(launcher),
  'launcher must not open the browser before the server is ready'
);
assert(
  /open_when_ready\.ps1/i.test(launcher),
  'launcher must start the bounded readiness helper'
);
assert(
  /--host\s+127\.0\.0\.1/.test(launcher),
  'launcher must keep the server bound to loopback'
);
assert(
  /\$PSVersionTable\.PSEdition\s+-eq\s+'Core'/.test(launcher) &&
    /Join-Path \$PSHOME 'pwsh\.exe'/.test(launcher) &&
    /Join-Path \$PSHOME 'powershell\.exe'/.test(launcher) &&
    /Start-Process\s+-FilePath\s+\$powerShellExe/.test(launcher),
  'launcher must choose a helper executable available in the current PowerShell edition'
);
assert(
  /Write-Host\s+"Thai Lottery Dashboard"/.test(launcher) &&
    /Write-Host\s+"URL: http:\/\/localhost:\$Port"/.test(launcher) &&
    /Write-Host\s+"Press Ctrl\+C to stop"/.test(launcher),
  'launcher must keep its title, URL, and stop instructions visible'
);

const readiness = fs.readFileSync(readinessPath, 'utf8');
const probe = readiness.indexOf('http://127.0.0.1:$Port/openapi.json');
const readyCheck = readiness.indexOf('.StatusCode -eq 200');
const parseOpenApi = readiness.indexOf('ConvertFrom-Json');
const appIdentity = readiness.indexOf('Lottery Stats API');
const browserOpen = readiness.indexOf('Start-Process "http://localhost:$Port"');
assert(probe >= 0, 'readiness helper must probe this app\'s OpenAPI endpoint on loopback');
assert(readyCheck > probe, 'readiness helper must check for HTTP 200');
assert(parseOpenApi > readyCheck, 'readiness helper must parse the response before opening the browser');
assert(appIdentity > parseOpenApi, 'readiness helper must verify the Lottery Stats API identity');
assert(browserOpen > appIdentity, 'browser must open only after the app-specific identity check');
assert(/TimeoutSeconds/.test(readiness), 'readiness wait must be bounded');

assert(/\$PSVersionTable\.PSEdition\s+-eq\s+'Core'/.test(launcher), 'launcher must detect PowerShell 7/Core');
assert(/Join-Path \$PSHOME 'pwsh\.exe'/.test(launcher), 'PowerShell 7 must launch pwsh.exe from PSHOME');
assert(/Join-Path \$PSHOME 'powershell\.exe'/.test(launcher), 'Windows PowerShell must launch powershell.exe from PSHOME');
assert(/Start-Process\s+-FilePath\s+\$powerShellExe/.test(launcher), 'launcher must start the selected PowerShell executable');

console.log('PASS: launcher waits for app identity and starts a compatible PowerShell helper');
