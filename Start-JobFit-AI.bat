@echo off
setlocal

set "PROJECT_DIR=%~dp0"
pushd "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Cannot access the project directory.
  pause
  exit /b 1
)
set "PROJECT_READY=1"

if not exist "package.json" (
  echo [ERROR] package.json is missing from the project directory.
  goto :failed
)
if not exist "pnpm-workspace.yaml" (
  echo [ERROR] pnpm-workspace.yaml is missing from the project directory.
  goto :failed
)
if not exist "pnpm-lock.yaml" (
  echo [ERROR] pnpm-lock.yaml is missing from the project directory.
  goto :failed
)
if not exist "apps\local-api\package.json" (
  echo [ERROR] The Local API package is missing.
  goto :failed
)
if not exist "apps\local-api\src\server.ts" (
  echo [ERROR] The Local API server source is missing.
  goto :failed
)

where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is unavailable. Install the project-required Node.js 22.15 or later and reopen this launcher.
  goto :failed
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 15) ? 0 : 1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22.15 or later is required.
  goto :failed
)

where.exe pnpm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm is unavailable. Install the project-required pnpm version and reopen this launcher.
  goto :failed
)

if not exist "node_modules\.pnpm" (
  echo [ERROR] Project dependencies are not installed. Run pnpm install --frozen-lockfile from the project directory.
  goto :failed
)
if not exist "apps\local-api\node_modules\@google\genai\package.json" (
  echo [ERROR] The Local API dependencies are incomplete. Run pnpm install --frozen-lockfile from the project directory.
  goto :failed
)
if not exist "apps\local-api\node_modules\zod\package.json" (
  echo [ERROR] The Local API dependencies are incomplete. Run pnpm install --frozen-lockfile from the project directory.
  goto :failed
)

if not defined JOBFIT_EXTENSION_ID (
  if not exist ".jobfit-extension-id" (
    echo [ERROR] Configure JOBFIT_EXTENSION_ID in the environment or create .jobfit-extension-id.
    echo Use the 32-character ID shown for this extension in chrome://extensions.
    goto :failed
  )
  set /p "JOBFIT_EXTENSION_ID="<".jobfit-extension-id"
)
node -e "if (!/^[a-p]{32}$/.test(process.env.JOBFIT_EXTENSION_ID || '')) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] The extension ID must be exactly 32 lowercase letters from a through p.
  goto :failed
)

node -e "const server = require('node:net').createServer(); server.once('error', () => process.exit(1)); server.listen(8787, '127.0.0.1', () => server.close())"
if errorlevel 1 (
  echo [ERROR] Cannot use API port 8787 on 127.0.0.1; it may already be occupied.
  echo No process was stopped. Investigate with: netstat -ano ^| findstr :8787
  echo Check the PID in Task Manager before taking any action.
  goto :failed
)

echo Starting the existing JobFit AI Local API. Keep this window open; press Ctrl+C to stop it.
call pnpm.cmd dev:api
set "API_EXIT_CODE=%ERRORLEVEL%"
if not "%API_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The Local API exited with code %API_EXIT_CODE%. Review the messages above.
  pause
)

popd
exit /b %API_EXIT_CODE%

:failed
if defined PROJECT_READY popd
echo.
pause
exit /b 1
