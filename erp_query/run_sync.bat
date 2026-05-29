@echo off
REM ERP → 앱(Neon) 일일 동기화 (ErpItemSync 스케줄 작업이 호출)
REM   1) item_codes        (제품 검색목록)
REM   2) production_orders (출하호기 자동조회)
REM   3) vendors           (거래처 자동완성/저장)
set PY=C:\Users\Administrator\Downloads\Code-Transformer\.venv\Scripts\python.exe
set DIR=C:\Users\Administrator\Downloads\Code-Transformer\erp_query
set LOG=C:\ProgramData\ErpQueryApi\sync.log
echo [%date% %time%] sync start >> "%LOG%"
"%PY%" "%DIR%\sync_items.py" --scope produced >> "%LOG%" 2>&1
"%PY%" "%DIR%\sync_orders.py" >> "%LOG%" 2>&1
"%PY%" "%DIR%\sync_vendors.py" --table B_BIZ_PARTNER --cd-col BP_CD --nm-col BP_NM --tax-col BP_RGST_NO --valid-col USAGE_FLAG >> "%LOG%" 2>&1
echo [%date% %time%] sync done (exit %errorlevel%) >> "%LOG%"
