@echo off
setlocal
set "PY=py"
where py >nul 2>nul || set "PY=python"
set "EDITS=%TEMP%\edits.txt"
powershell -NoProfile -Command "[IO.File]::WriteAllText('%EDITS%', (Get-Clipboard -Raw), (New-Object Text.UTF8Encoding $false))"
if errorlevel 1 exit /b 1
%PY% "%~dp0apply_edits.py" "%EDITS%" --dry-run
if errorlevel 1 exit /b 1
set /p "ANS=apply? [y/N] "
if /i "%ANS%"=="y" %PY% "%~dp0apply_edits.py" "%EDITS%"
