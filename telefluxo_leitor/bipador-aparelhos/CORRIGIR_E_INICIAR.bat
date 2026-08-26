@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   TELECEL - CORRECAO E INICIALIZACAO DO BIPADOR DE IMEIS
echo ============================================================
echo.

if not exist "package.json" goto :pasta_incorreta
if not exist "src\App.tsx" goto :pasta_incorreta
findstr /C:"bipador-aparelhos" "package.json" >nul
if errorlevel 1 goto :pasta_incorreta

echo [1/4] Removendo somente arquivos incompatíveis misturados ao Vite...
if exist "postcss.config.mjs" del /F /Q "postcss.config.mjs"
if exist "next.config.ts" del /F /Q "next.config.ts"
if exist "drizzle.config.ts" del /F /Q "drizzle.config.ts"
if exist "eslint.config.mjs" del /F /Q "eslint.config.mjs"
if exist ".npmrc" del /F /Q ".npmrc"
if exist "app" rmdir /S /Q "app"
if exist "build" rmdir /S /Q "build"
if exist "db" rmdir /S /Q "db"
if exist "drizzle" rmdir /S /Q "drizzle"
if exist "worker" rmdir /S /Q "worker"
if exist "examples" rmdir /S /Q "examples"
if exist "tests" rmdir /S /Q "tests"
if exist ".openai" rmdir /S /Q ".openai"
if exist ".sites-runtime" rmdir /S /Q ".sites-runtime"
if exist "dist" rmdir /S /Q "dist"

echo [2/4] Limpando dependencias antigas...
if exist "node_modules" rmdir /S /Q "node_modules"

echo [3/4] Instalando dependencias corretas...
call npm install
if errorlevel 1 goto :erro_npm

echo [4/4] Iniciando o sistema...
echo.
echo Quando terminar, use Ctrl+C para encerrar.
echo.
call npm run dev
goto :fim

:pasta_incorreta
echo ERRO: este arquivo deve ficar na raiz do projeto bipador-aparelhos.
echo Nenhum arquivo foi removido.
pause
exit /b 1

:erro_npm
echo.
echo ERRO: nao foi possivel instalar as dependencias.
echo Confirme se o Node.js 20.19 ou superior esta instalado.
pause
exit /b 1

:fim
endlocal
