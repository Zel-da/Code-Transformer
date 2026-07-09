@echo off
chcp 65001 > /dev/null
title UNIERP 창 진단
cd /d "%~dp0"
echo.
echo === UNIERP 창 진단 시작 ===
echo.
".venv\Scripts\python.exe" -c "from pywinauto import Desktop; import sys; print('--- UIA 백엔드 enumerate ---'); [print(f'  pid={w.process_id():>6}  title={w.window_text()!r}') for w in Desktop(backend='uia').windows() if w.window_text()]; print(); print('--- Win32 백엔드 enumerate ---'); [print(f'  pid={w.process_id():>6}  title={w.window_text()!r}') for w in Desktop(backend='win32').windows() if w.window_text()]"
echo.
echo === 위 결과를 모두 복사해서 전달해주세요 ===
pause
