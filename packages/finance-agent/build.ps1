<#
.SYNOPSIS
  Build and package the Finance Agent as a portable desktop executable.

.DESCRIPTION
  Compiles the Bun sidecar, builds the Tauri desktop shell, and packages
  everything into a self-contained portable directory.

.PARAMETER OutDir
  Output directory for the portable package. Default: ./dist/Finance Agent

.PARAMETER Arch
  Target architecture: x64 (default), arm64.

.PARAMETER Mode
  Build mode: release (default, smaller, faster) or debug.

.EXAMPLE
  .\build.ps1
  .\build.ps1 -OutDir "D:\releases\finance-agent"
  .\build.ps1 -Mode debug -Arch arm64

.NOTES
  Prerequisites:
    - Bun 1.2+         (bun --version)
    - Rust nightly      (rustc --version)
    - Tauri CLI 2.x     (cargo tauri --version)
    - Windows SDK       (for webview2, included in Windows 10+)
#>

param(
  [string]$OutDir = "",
  [string]$Arch = "x64",
  [ValidateSet("release", "debug")]
  [string]$Mode = "release"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot

# ─── Prerequisites ──────────────────────────────────────────

function Test-Command($Name) {
  try { $null = Get-Command $Name -ErrorAction Stop; return $true }
  catch { return $false }
}

Write-Host "=== Finance Agent Builder ===" -ForegroundColor Cyan
Write-Host ""

# Check Bun
if (-not (Test-Command "bun")) {
  Write-Host "ERROR: Bun not found. Install from https://bun.sh" -ForegroundColor Red
  exit 1
}
$bunVer = bun --version
Write-Host "[OK] Bun $bunVer" -ForegroundColor Green

# Check Rust
if (-not (Test-Command "rustc")) {
  Write-Host "ERROR: Rust not found. Install from https://rustup.rs" -ForegroundColor Red
  exit 1
}
$rustVer = rustc --version
Write-Host "[OK] Rust $rustVer" -ForegroundColor Green

# Check Tauri CLI
if (-not (Test-Command "cargo")) {
  Write-Host "ERROR: Cargo not found." -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Cargo available" -ForegroundColor Green

# ─── Resolve paths ──────────────────────────────────────────

$TargetDir = Join-Path $ScriptRoot "src-tauri"
$BinariesDir = Join-Path $TargetDir "binaries"
$ReleaseDir = Join-Path $TargetDir "target\release"
$TauriOutput = Join-Path $TargetDir "target\release\bundle"

if (-not $OutDir) {
  $OutDir = Join-Path $ScriptRoot "dist\Finance Agent"
}

# ─── Step 1: Build the Bun sidecar ─────────────────────────

Write-Host "`n=== Step 1/3: Build Bun sidecar ===" -ForegroundColor Cyan

# Ensure binaries directory exists
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null

$targetFlag = if ($Arch -eq "arm64") { "--target", "bun-linux-arm64" } else { @() }
$modeFlag = if ($Mode -eq "debug") { "" } else { "--compile" }

Write-Host "Compiling sidecar (arch=$Arch, mode=$Mode)..." -ForegroundColor Yellow

if ($Mode -eq "release") {
  bun build ".\src-agent\index.ts" --compile --outfile "$BinariesDir\agent-sidecar-x86_64-pc-windows-msvc" @targetFlag
} else {
  bun build ".\src-agent\index.ts" --outfile "$BinariesDir\agent-sidecar-x86_64-pc-windows-msvc.js" @targetFlag
}

if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Sidecar build failed." -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Sidecar built" -ForegroundColor Green

# ─── Step 2: Build Tauri desktop shell ─────────────────────

Write-Host "`n=== Step 2/3: Build Tauri desktop shell ===" -ForegroundColor Cyan

if (Test-Path "$TargetDir\Cargo.toml") {
  Push-Location $TargetDir
  try {
    if ($Mode -eq "release") { cargo build --release }
    else { cargo build }
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed (exit code $LASTEXITCODE)" }
    Write-Host "[OK] Tauri shell built" -ForegroundColor Green
  } finally { Pop-Location }
} else {
  Write-Host "[SKIP] No src-tauri/Cargo.toml — Tauri shell not built" -ForegroundColor Yellow
  Write-Host "  Sidecar only. To build full desktop app, scaffold from agent-tauri template:" -ForegroundColor Gray
  Write-Host "    npx @earendil-works/agent-tauri scaffold ./my-agent" -ForegroundColor Gray
}

# ─── Step 3: Package portable bundle ───────────────────────

Write-Host "`n=== Step 3/3: Package portable bundle ===" -ForegroundColor Cyan

$ExeName = "Finance Agent.exe"
$SidecarName = "agent-sidecar.exe"

# Create output directory
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\data\sessions" | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\resources\skills" | Out-Null

# Copy Tauri executable
$CargoExeName = "my-agent.exe"
$tauriExe = Join-Path $ReleaseDir $ExeName
$cargoExe = Join-Path $ReleaseDir $CargoExeName
if (Test-Path $tauriExe) {
  Copy-Item $tauriExe "$OutDir\$ExeName" -Force
} elseif (Test-Path $cargoExe) {
  Copy-Item $cargoExe "$OutDir\$ExeName" -Force
  Write-Host "[OK] Tauri exe copied (from $CargoExeName)" -ForegroundColor Green
} else {
  Write-Host "WARNING: Tauri exe not found" -ForegroundColor Yellow
}

# Copy sidecar
$sidecarExe = Join-Path $BinariesDir "$SidecarName"
if (Test-Path $sidecarExe) {
  Copy-Item $sidecarExe "$OutDir\$SidecarName" -Force
  if (Test-Path "$ScriptRoot\src-tauri\binaries\agent-sidecar.exe") { Copy-Item "$ScriptRoot\src-tauri\binaries\agent-sidecar.exe" "$OutDir\agent-sidecar.exe" -Force }
  Write-Host "[OK] Sidecar copied" -ForegroundColor Green
} else {
  Write-Host "WARNING: Sidecar exe not found" -ForegroundColor Yellow
}

# Copy skills
if (Test-Path "$ScriptRoot\skills") {
  Copy-Item "$ScriptRoot\skills\*" "$OutDir\resources\skills\" -Recurse -Force
  Write-Host "[OK] Skills copied" -ForegroundColor Green
}

# Create README
@"
Finance Agent — Portable Desktop App
=====================================
Built: $(Get-Date -Format "yyyy-MM-dd HH:mm")
Architecture: $Arch
Mode: $Mode

To run:
  Double-click "$ExeName"

To configure API keys:
  1. Create a .env file or set environment variables:
     - ANTHROPIC_API_KEY=sk-ant-...
     - OPENAI_API_KEY=sk-...
  2. Or use the auth dialog inside the app

Data directory:
  data/  (sessions, settings, auth — created on first launch)
"@ | Out-File -FilePath "$OutDir\README.txt" -Encoding utf8

# ─── Summary ────────────────────────────────────────────────

$exeSize = if (Test-Path "$OutDir\$ExeName") { "{0:N0} KB" -f ((Get-Item "$OutDir\$ExeName").Length / 1KB) } else { "N/A" }
$sidecarSize = if (Test-Path "$OutDir\$SidecarName") { "{0:N0} KB" -f ((Get-Item "$OutDir\$SidecarName").Length / 1KB) } else { "N/A" }

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "Output:  $OutDir" -ForegroundColor White
Write-Host "App:     $ExeName ($exeSize)" -ForegroundColor White
Write-Host "Sidecar: $SidecarName ($sidecarSize)" -ForegroundColor White
Write-Host ""
Write-Host "To configure: set ANTHROPIC_API_KEY or OPENAI_API_KEY" -ForegroundColor Cyan
Write-Host "To run:       $OutDir\$ExeName" -ForegroundColor Cyan
