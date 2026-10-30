@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Real AI grading test: 28 student pages, teacher, and screen.
echo This uses the GAS API key and incurs API usage charges.
call "%~dp0TEST_GAS_30.cmd" --mode live --judge-timeout 600 %*
exit /b %errorlevel%
