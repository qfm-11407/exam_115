@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
if exist ".local\ui-loadtest\node_modules\playwright-core\index.mjs" goto run
echo Installing the browser test driver...
call npm install --prefix ".local\ui-loadtest" --no-save --ignore-scripts playwright-core@1.64.1
if errorlevel 1 goto failed
:run
node "scripts\gas-ui-loadtest.mjs" %*
if errorlevel 1 goto failed
echo Test passed. See .local\gas-loadtest for the report.
pause
exit /b 0
:missing
echo Please install Node.js first.
:failed
echo Test did not finish successfully. See the message or report above.
pause
exit /b 1
