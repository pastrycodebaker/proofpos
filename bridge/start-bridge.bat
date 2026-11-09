@echo off
REM Windows: double-click to start the Proof POS print bridge. Leave this window open.
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js first from https://nodejs.org ^(the LTS version^), then double-click this again. & pause & exit /b 1)
if not exist node_modules (
  echo Setting up for the first time. This takes a minute or two...
  call npm install --no-fund --no-audit
)
echo Starting the print bridge...
node bridge.mjs
pause
