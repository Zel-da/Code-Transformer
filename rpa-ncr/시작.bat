@echo off
title NCR 자동 입력
cd /d "%~dp0"

REM ===========================================
REM Step -1: 관리자 권한 자동 승격
REM (UNIERP가 관리자 권한일 때 UIPI 보호 회피)
REM ===========================================
net session 1>NUL 2>NUL
if errorlevel 1 (
    echo.
    echo 관리자 권한이 필요합니다. UAC 승격창에서 [예] 눌러주세요...
    echo.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM ===========================================
REM Step 0: Python 설치 확인
REM ===========================================
python --version 1>NUL 2>NUL
if errorlevel 1 (
    echo.
    echo =====================================================
    echo  [오류] Python이 설치되어 있지 않습니다.
    echo =====================================================
    echo.
    echo Python 3.11 또는 3.12 를 설치하세요:
    echo.
    echo   https://www.python.org/downloads/windows/
    echo.
    echo *** 설치할 때 "Add Python to PATH" 체크박스를 켜야 합니다 ***
    echo.
    echo 설치 후 이 창을 닫고 다시 더블클릭하세요.
    echo.
    pause
    exit /b 1
)

REM ===========================================
REM Step 1: 첫 실행이면 자동 설치 (원자성)
REM   .venv 만 있고 .install_ok 마커가 없으면 이전 pip 실패 잔재 →
REM   자동 재설치. 마커는 pip 성공 직후에만 생성된다.
REM ===========================================
set NEED_INSTALL=0
if not exist ".venv\Scripts\python.exe" set NEED_INSTALL=1
if not exist ".venv\.install_ok" set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
    echo.
    echo =====================================================
    echo  첫 실행 또는 이전 설치 미완료 - 필요한 프로그램을 자동 설치합니다
    echo  인터넷 연결 필요, 약 2~3분 소요
    echo =====================================================
    echo.

    if not exist ".venv\Scripts\python.exe" (
        echo [1/3] 가상환경 생성 중...
        python -m venv .venv
        if errorlevel 1 (
            echo [오류] 가상환경 생성 실패
            pause
            exit /b 1
        )
    )

    echo.
    echo [2/3] pip 업데이트 중...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip

    echo.
    echo [3/3] 패키지 설치 중 - 시간이 좀 걸립니다 ...
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [오류] 패키지 설치 실패
        echo 인터넷 연결과 Python 3.11 또는 3.12 사용 여부를 확인하세요.
        echo 마커 파일을 남기지 않으므로 다음 실행에서 재시도합니다.
        pause
        exit /b 1
    )

    REM 성공 마커 - pip 성공 직후에만 생성. 다음 실행에서 설치 스킵의 기준이 됨.
    echo installed > ".venv\.install_ok"

    echo.
    echo =====================================================
    echo  설치 완료. 프로그램을 시작합니다.
    echo =====================================================
    timeout /t 2 /nobreak 1>NUL
)

REM ===========================================
REM Step 2: PRIVATE\app_db.json 확인
REM ===========================================
if not exist "PRIVATE\app_db.json" (
    echo.
    echo [경고] PRIVATE\app_db.json 파일이 없습니다.
    echo 공용 DB 모드를 쓰려면 USB로 받은 파일을 이 위치에 넣어주세요.
    echo.
    pause
)

REM ===========================================
REM Step 3: 프로그램 실행
REM ===========================================
".venv\Scripts\python.exe" main.py

if errorlevel 1 (
    echo.
    echo [오류] 프로그램이 오류로 종료되었습니다.
    echo logs\ 폴더의 최신 로그 파일을 확인하세요.
    echo.
    pause
)
