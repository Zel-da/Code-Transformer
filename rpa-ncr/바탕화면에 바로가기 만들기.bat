@echo off
title 바탕화면 바로가기 만들기
cd /d "%~dp0"

set TARGET=%~dp0시작.bat

powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); if (-not (Test-Path $desktop)) { New-Item -ItemType Directory -Path $desktop -Force | Out-Null }; $lnk_path = Join-Path $desktop 'NCR RPA.lnk'; $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($lnk_path); $lnk.TargetPath = '%TARGET%'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = 'shell32.dll,137'; $lnk.Description = 'NCR RPA'; $lnk.Save(); Write-Host ('Created: ' + $lnk_path)"

if errorlevel 1 (
    echo.
    echo [오류] 바로가기 만들기 실패
    pause
    exit /b 1
)

echo.
echo =====================================================
echo  바탕화면에 "NCR RPA" 바로가기를 만들었습니다.
echo =====================================================
echo.
echo 이제 바탕화면 아이콘을 더블클릭하면 실행됩니다.
echo.
pause
