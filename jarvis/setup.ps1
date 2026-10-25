# Jarvis one-line setup for Abbas's PC (25 Oct 2026)
# Paste in PowerShell:   irm https://raw.githubusercontent.com/abbas911-prog/sj-designs/main/jarvis/setup.ps1 | iex
# Safe to run again any time: every step skips what is already done.

$ErrorActionPreference = 'Continue'
$RAW = 'https://raw.githubusercontent.com/abbas911-prog/sj-designs/main/jarvis'
$AGENT = Join-Path $HOME 'my-agent'
$JARVIS = Join-Path $AGENT 'jarvis'

function Say($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }

# 1. Claude Code
$bin = Join-Path $HOME '.local\bin'
if (Test-Path (Join-Path $bin 'claude.exe')) { $env:Path = "$bin;$env:Path" }
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Say "Claude Code is already installed ($(claude --version))."
} else {
  Say "Installing Claude Code (about 330 MB, prints nothing while it downloads - leave it alone)..."
  irm https://claude.ai/install.ps1 | iex
  if (Test-Path (Join-Path $bin 'claude.exe')) { $env:Path = "$bin;$env:Path" }
}

# 2. Python (the memory, face and sj.py need a real interpreter; the Store placeholder does not count)
function RealPython {
  foreach ($c in @('py','python','python3')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') {
      try { $v = & $cmd.Source --version 2>&1; if ($v -match '^Python 3') { return $cmd.Source } } catch {}
    }
  }
  return $null
}
if (RealPython) { Say "Python is already installed ($(& (RealPython) --version))." }
else {
  Say "Installing Python 3.12 with winget..."
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  if (-not (RealPython)) { Write-Host "Python did not install - install it from python.org (tick 'Add to PATH') and run this line again." -ForegroundColor Yellow }
}

# 3. Jarvis folder: brain file, SJ tool, config
Say "Putting the Jarvis files in $JARVIS ..."
New-Item -ItemType Directory -Force -Path $JARVIS | Out-Null
foreach ($f in @('CLAUDE.md','README.md','sj.py','config.example.json')) {
  Invoke-WebRequest "$RAW/$f" -OutFile (Join-Path $JARVIS $f) -UseBasicParsing
}
$cfg = Join-Path $JARVIS 'config.json'
if (-not (Test-Path $cfg)) {
  Copy-Item (Join-Path $JARVIS 'config.example.json') $cfg
  Say "Opening config.json - put in the Assistant link (the .../exec one) and the Assistant password, then save and close Notepad."
  Start-Process notepad $cfg -Wait
}

# 4. Make Claude Code read the brain from the agent folder (an @import; the wizard never overwrites this file)
$brain = Join-Path $AGENT 'CLAUDE.md'
$line = '@jarvis/CLAUDE.md'
if (-not (Test-Path $brain) -or -not (Select-String -Path $brain -SimpleMatch $line -Quiet)) {
  Add-Content -Path $brain -Value "`n# Abbas's business brain (SJTC + AL MUTAGADED) - read every time`n$line`n"
}

# 5. fullstack-agent (memory + voice + face) - the Windows line from github.com/jaredrhod/fullstack-agent
Say "Getting fullstack-agent (memory, voice, face)..."
Set-Location $AGENT
if (-not (Test-Path 'fullstack-agent\fullstack-agent.md')) {
  Invoke-WebRequest https://github.com/jaredrhod/fullstack-agent/archive/refs/heads/main.zip -OutFile fsa.zip -UseBasicParsing
  Expand-Archive fsa.zip . -Force
  New-Item -ItemType Directory -Force -Path fullstack-agent | Out-Null
  Get-ChildItem fullstack-agent-main -Force | Copy-Item -Destination fullstack-agent -Recurse -Force
  Remove-Item fullstack-agent-main -Recurse -Force
  Remove-Item fsa.zip
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "Claude Code is not on this PC yet. Close this window, open a NEW PowerShell, and paste the setup line again." -ForegroundColor Yellow
  return
}

Say "Starting the wizard. It will ask you to sign in to Claude in the browser the first time."
Say "When it asks: name = Jarvis, pieces = memory + voice + face (skip hands)."
Set-Location (Join-Path $AGENT 'fullstack-agent')
claude "set me up"

# 6. After the wizard: make sure the brain import is still there
if (-not (Select-String -Path $brain -SimpleMatch $line -Quiet)) {
  Add-Content -Path $brain -Value "`n# Abbas's business brain (SJTC + AL MUTAGADED) - read every time`n$line`n"
}
Say "Done. Daily use: double-click the 'Jarvis Talk' shortcut on the Desktop, hold the push-to-talk key and say 'what's on my plate'."
