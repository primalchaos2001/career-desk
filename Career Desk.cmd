@echo off
rem Career Desk launcher: double-click to start. Keep the window open while you use it.
setlocal
title Career Desk
cd /d "%~dp0"
set "APP=%~dp0packages\app\dist-local\career-desk.mjs"
if not exist "%APP%" (
  echo Career Desk's app files are missing.
  echo Download CareerDesk-windows.zip from the project's GitHub Releases page,
  echo or, as a developer, build once with: pnpm --filter @tailorats/app run local:build
  echo.
  pause
  exit /b 1
)

rem Node: the copy in this download first, then an installed Node.js, then Codex's.
set "NODE="
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE if exist "%CODEX_NODE%" set "NODE=%CODEX_NODE%"
if not defined NODE (
  echo Career Desk needs Node.js 20 or later.
  echo Install it from https://nodejs.org and double-click this file again.
  echo.
  pause
  exit /b 1
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) < 20 ? 1 : 0)"
if errorlevel 1 (
  echo Career Desk needs Node.js 20 or later. Found an older version at:
  echo   %NODE%
  echo.
  pause
  exit /b 1
)

rem One-time setup of job-board search and CV PDFs (Python tools in .venv).
if not exist "%~dp0.venv\Scripts\python.exe" call :setup_python

"%NODE%" "%APP%" %*
if errorlevel 1 (
  echo.
  pause
)
exit /b

:setup_python
set "PY="
for /f "delims=" %%P in ('where py 2^>nul') do if not defined PY set "PY=py -3"
if not defined PY for /f "delims=" %%P in ('where python 2^>nul') do if not defined PY (
  echo %%P | find /i "WindowsApps" >nul || set "PY=python"
)
if not defined PY (
  echo.
  echo  Job-board search and CV PDFs need Python 3.10 or later, which isn't installed.
  echo  Everything else works now. To add them later: install Python from
  echo  https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^),
  echo  then close and start Career Desk again.
  echo.
  exit /b 0
)
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" || (
  echo  Python 3.10 or later is needed for job boards and CV PDFs; skipping them for now.
  exit /b 0
)
echo.
echo  First start: setting up job-board search and CV PDFs. This takes about a minute
echo  and needs the internet. It only happens once.
echo.
%PY% -m venv "%~dp0.venv" || exit /b 0
"%~dp0.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%~dp0tools\python\requirements.txt" || (
  echo  Setup didn't finish; it will try again next time. Career Desk still opens.
  rmdir /s /q "%~dp0.venv"
)
exit /b 0
