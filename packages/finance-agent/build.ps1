<#
.SYNOPSIS
  Build the Finance Agent as a portable desktop executable.

.PARAMETER OutDir
  Output directory. Default: ./dist/Finance Agent

.PARAMETER Mode
  release (default) or debug.
#>

param(
  [string]$OutDir = "",
  [ValidateSet("release", "debug")]
  [string]$Mode = "release"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot
$TargetDir = Join-Path $ScriptRoot "src-tauri"
$BinariesDir = Join-Path $TargetDir "binaries"
$ReleaseDir = Join-Path $TargetDir "target\release"

if (-not $OutDir) { $OutDir = Join-Path $ScriptRoot "dist\Finance Agent" }

Write-Host "=== Building Finance Agent ===" -ForegroundColor Cyan

# Step 1: Build Bun sidecar
Write-Host "`n[1/3] Building Bun sidecar..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
if ($Mode -eq "release") {
  bun build "$ScriptRoot\src-agent\index.ts" --compile --outfile "$BinariesDir\agent-sidecar"
} else {
  bun build "$ScriptRoot\src-agent\index.ts" --outfile "$BinariesDir\agent-sidecar.js"
}
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
Write-Host "[OK]" -ForegroundColor Green

# Step 2: Build frontend + Tauri shell
Write-Host "[2/3] Building frontend..." -ForegroundColor Cyan
Push-Location $ScriptRoot
try {
  npm run build:frontend
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
  Write-Host "[OK] Frontend built" -ForegroundColor Green
} finally { Pop-Location }

Write-Host "      Building Tauri shell..." -ForegroundColor Cyan
Push-Location $TargetDir
try {
  if ($Mode -eq "release") { cargo build --release } else { cargo build }
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
  Write-Host "[OK]" -ForegroundColor Green
} finally { Pop-Location }

# Step 3: Package
Write-Host "[3/3] Packaging portable bundle..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\data\sessions" | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\resources\skills" | Out-Null

$ExeName = "Finance Agent.exe"
$tauriExe = Join-Path $ReleaseDir "my-agent.exe"
if (Test-Path $tauriExe) { Copy-Item $tauriExe "$OutDir\$ExeName" -Force }

$sidecarExe = "$BinariesDir\agent-sidecar.exe"
if (Test-Path $sidecarExe) { Copy-Item $sidecarExe "$OutDir\" -Force }

if (Test-Path "$ScriptRoot\skills") {
  Copy-Item "$ScriptRoot\skills\*" "$OutDir\resources\skills\" -Recurse -Force
}

Write-Host "[OK]" -ForegroundColor Green
Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Output: $OutDir"
