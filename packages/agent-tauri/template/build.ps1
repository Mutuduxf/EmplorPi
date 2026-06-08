<#
.SYNOPSIS
  Clean build a portable desktop agent.
  Requires: Bun, Rust, Tauri CLI.
#>

param([string]$OutDir = "")

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot
$AppName = (Get-Item $ScriptRoot).Name
$BinariesDir = Join-Path $ScriptRoot "src-tauri" "binaries"
$ReleaseDir = Join-Path $ScriptRoot "src-tauri" "target" "release"
if (-not $OutDir) { $OutDir = Join-Path $ScriptRoot "dist" $AppName }

Write-Host "=== Building $AppName ===" -ForegroundColor Cyan
Write-Host "      (clean build)" -ForegroundColor Cyan

# Clean previous build artifacts
Write-Host "`n[0/3] Cleaning..." -ForegroundColor Cyan
if (Test-Path $BinariesDir) { Remove-Item -Recurse -Force $BinariesDir }
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
if (Test-Path (Join-Path $ScriptRoot "dist\web")) { Remove-Item -Recurse -Force (Join-Path $ScriptRoot "dist\web") }
Write-Host "[OK]" -ForegroundColor Green

# Step 1: Build Bun sidecar
Write-Host "`n[1/3] Building Bun sidecar..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
bun build "$ScriptRoot\src-agent\index.ts" --compile --outfile "$BinariesDir\agent-sidecar"
if ($LASTEXITCODE -ne 0) { throw "Sidecar build failed" }
Write-Host "[OK]" -ForegroundColor Green

# Step 2: Build frontend + Tauri shell
Write-Host "[2/3] Building Tauri app..." -ForegroundColor Cyan
Push-Location $ScriptRoot
try {
  npx tauri build --bundles
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
  Write-Host "[OK]" -ForegroundColor Green
} finally { Pop-Location }

# Step 3: Package portable bundle
Write-Host "[3/3] Packaging..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\data\sessions" | Out-Null
New-Item -ItemType Directory -Force -Path "$OutDir\resources\skills" | Out-Null

Copy-Item (Join-Path $ReleaseDir "my-agent.exe") "$OutDir\$AppName.exe" -Force
Copy-Item "$BinariesDir\agent-sidecar.exe" "$OutDir\" -Force
if (Test-Path "$ScriptRoot\skills") {
  Copy-Item "$ScriptRoot\skills\*" "$OutDir\resources\skills\" -Recurse -Force
}

Write-Host "[OK]" -ForegroundColor Green
Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Output: $OutDir"
