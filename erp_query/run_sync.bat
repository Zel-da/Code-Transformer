@echo off
REM ERP → 앱(Neon) 일일 동기화 (ErpItemSync 스케줄 작업이 호출).
REM run_all.py 가 4단계(items/orders/vendors/shipments) 통합 실행 + 실패 시 알림.
set PY=C:\Users\Administrator\Downloads\Code-Transformer\.venv\Scripts\python.exe
set DIR=C:\Users\Administrator\Downloads\Code-Transformer\erp_query
set LOG=C:\ProgramData\ErpQueryApi\sync.log
echo [%date% %time%] sync start >> "%LOG%"
"%PY%" "%DIR%\run_all.py" >> "%LOG%" 2>&1
echo [%date% %time%] sync done (exit %errorlevel%) >> "%LOG%"
