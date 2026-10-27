@echo off
cd /d "%~dp0"
python --version >nul 2>&1
if errorlevel 1 (
  echo Python 3.11 oder neuer installieren und zu PATH hinzufuegen.
  pause
  exit /b 1
)
echo AuditFlow startet. Im Browser http://127.0.0.1:8080 oeffnen.
python -m auditflow
pause
