@echo off
REM ERP 품목 → 앱 item_codes 일일 동기화 (ErpItemSync 스케줄 작업이 호출)
set LOG=C:\ProgramData\ErpQueryApi\sync.log
echo [%date% %time%] sync start >> "%LOG%"
"C:\Users\Administrator\Downloads\Code-Transformer\.venv\Scripts\python.exe" "C:\Users\Administrator\Downloads\Code-Transformer\erp_query\sync_items.py" --scope produced >> "%LOG%" 2>&1
echo [%date% %time%] sync done (exit %errorlevel%) >> "%LOG%"
