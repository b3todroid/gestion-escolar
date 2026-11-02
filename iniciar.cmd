@echo off
REM Inicia Gestion Escolar en este equipo (Windows). Doble clic para ejecutar.
REM Usa npm.cmd para no depender de la politica de PowerShell.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala la version LTS desde https://nodejs.org y vuelve a intentarlo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm.cmd install
)
echo.
echo Abriendo Gestion Escolar en http://localhost:5173
echo NO CIERRES ESTA VENTANA mientras uses la aplicacion. Para detenerla: Ctrl+C
echo.
call npm.cmd run dev -- --open
pause
