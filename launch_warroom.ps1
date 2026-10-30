# Pierre Stock War Room - PowerShell Tactical Launcher
$Host.UI.RawUI.WindowTitle = "PIERRE STOCK WAR ROOM // GATEWAY"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "             PIERRE STOCK WAR ROOM -- OPENCLAW GATEWAY                " -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location -Path $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "[1/2] Installing dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "[1/2] Node dependencies verified." -ForegroundColor Green
}

Write-Host "[2/2] Launching Pierre Stock War Room on http://localhost:3888 ..." -ForegroundColor Cyan
Start-Process "http://localhost:3888"

node server.js
