# rpa-ncr — 부적합 보고(NCR) → UNIERP 자동 입력 RPA

Code-Transformer 클라우드(리플릿 API 또는 공용 Neon DB)에 쌓인 **부적합 보고**를
받아 UNIERP의 **부적합보고서등록** 화면에 자동 입력하는 RPA 워커입니다.
동사의 `OCR_EU`(계약조건품의서 자동입력) 아키텍처를 본떠 만들었습니다.

- **데이터 소스**: `settings.json`의 `source`로 `api`(리플릿) / `db`(Neon) 전환
- **운영**: FastAPI 웹 대시보드(실시간 로그/큐) 또는 헤드리스 CLI
- **자동화**: pywinauto(UIA) Tab 기반 입력 + pyautogui 폴백, 에러창 자동처리, 포커스 이탈 시 중단

---

## 1. 설치

```powershell
cd rpa-ncr
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 2. 설정

### settings.json (`config/settings.json`)
- `source`: `"api"` 또는 `"db"`
- `api.base_url`: 리플릿 API 주소 (예: `https://<app>.replit.app` 또는 `http://localhost:3000`)
- `api.secret`: 서버가 `X-RPA-Secret`을 요구하면 입력 (env `NCR_API_SECRET`로도 가능)
- `db.database_url`: 비워두면 env `DATABASE_URL` → `PRIVATE/app_db.json` 순으로 탐색
- `erp.*`: 아래 **캘리브레이션** 참고

### 공용 DB 사용 시 (`source: "db"`)
`PRIVATE/app_db.json` 생성(이 폴더는 .gitignore됨):
```json
{ "database_url": "postgresql://user:pw@...neon.tech/neondb?sslmode=require" }
```

## 3. 실행

### 웹 대시보드
```powershell
.\.venv\Scripts\python.exe main.py
```
브라우저가 `http://127.0.0.1:8010` 으로 열립니다. 순서:
1. **데이터 소스** 선택 → 연결 테스트
2. **ERP 설정** 입력 → 저장 (캘리브레이션)
3. **PENDING 조회** → 큐 확인
4. **ERP 창 확인** → **입력 시작**. 진행 상황은 실시간 로그/큐로 표시.

### 헤드리스 CLI (`run_worker.py`)
```powershell
python run_worker.py --dry-run                 # 조회 + 입력 시퀀스 출력 (ERP 미연결)
python run_worker.py --source db --dry-run      # DB 소스로 드라이런
python run_worker.py --report-id 42 --dry-run    # 특정 보고 1건 미리보기
python run_worker.py --report-id 42 --mark-only completed   # ERP 없이 상태 콜백만 시험
python run_worker.py --once                      # PENDING 일괄 처리 후 종료 (실 ERP 필요)
python run_worker.py --poll                       # 주기 폴링 무인 실행 (실 ERP 필요)
```

## 4. 캘리브레이션 (실 UNIERP 필요) ★중요

`field_mapping.json`의 `erp_field`/맵과 `settings.json`의 `erp.*`는 **실제 폼 구조에
맞춰 채워야** 동작합니다. 초기값은 전부 `TODO`이며, 웹 대시보드 설정 점검 배너가
미완료 항목을 알려줍니다.

1. **창 제목** — `GET /api/erp/windows`(또는 "ERP 창 확인" 버튼)로 UNIERP 메인 창
   제목의 부분 문자열을 확인 → `erp.window_title`.
2. **실행 경로 + 로그인** — `erp.launch_path`(`.appref-ms`/`.exe`), `erp.login_pw` 설정
   → `POST /api/erp/launch`로 실행·로그인 검증.
3. **대상 메뉴** — 부적합보고서등록 메뉴의 정확한 이름 → `erp.target_menu`
   (F3 메뉴찾기에 클립보드로 붙여넣어 진입).
4. **첫 필드 Tab 수** — 폼이 열린 직후 첫 입력 필드까지의 Tab 횟수 → `erp.first_field_tabs`.
5. **필드 Tab 순서** — `POST /api/erp/inspect` + 수동 Tab 워킹으로 `field_mapping.json`의
   `header_fields` 배열 순서가 폼의 Tab 순서와 일치하도록 맞추고 각 `erp_field`를 채운다.
   필드가 비면 그 자리에 `{"method":"skip"}` 항목을 넣어 Tab만 통과시킨다.
6. **팝업 검색 필드** — `itemCode` 등 코드 조회 필드를 `popup_search`(더블클릭) /
   `popup_search_enter`(Enter 확인) / `type`(직접 입력) 중 선택.
7. **드롭다운 맵** — `ncrType_map` 등에 값별 아래방향키 횟수(정수)를 채운다.
   (미입력이면 해당 필드는 자동으로 SKIP 처리)
8. **저장** — `erp.save_shortcut`(예: `^s`) 또는 `field_mapping.actions.save`(버튼
   `auto_id`/`text`) 중 하나 설정. 저장 후 확인창은 `_check_error_dialog`가 자동 처리.
9. **(선택) 그리드** — 다행 입력 폼이면 그리드 헤더 행을 복사해 `erp.grid_columns`에
   넣어 자동 열 감지를 활성화. 단일 품목 보고면 불필요.

## 5. 검증

- **드라이런**: `run_worker.py --dry-run` 으로 ERP 없이 입력 시퀀스(필드/값/method/tab)를
  확인. 매핑·날짜 포맷·코드맵 오류를 조기에 발견.
- **소스 패리티**: 같은 보고를 `--source api`/`--source db`로 받아 동일한지 확인.
- **단건 E2E**: 실 ERP를 열고 `--report-id N --once` 로 1건 입력 → 라이브 로그로 폼이
  채워지는지 관찰. 어긋나면 `/api/erp/inspect`로 디버그(캘리브레이션 루프).
- **실패 경로**: 입력 중 다른 창 클릭 → 포커스 이탈로 배치 중단 / 잘못된 품목 →
  해당 건만 실패 후 다음 건 계속 / ERP 에러창 → 자동 닫고 종료 후 발생 지점 요약.

## 6. 패키징 (exe)

```powershell
.\.venv\Scripts\python.exe -m pip install pyinstaller
.\.venv\Scripts\pyinstaller build.spec
```
산출물: `dist/RPA_NCR/RPA_NCR.exe`. `config/`는 번들 내 `_internal/config`로 포함되고,
`PRIVATE/app_db.json`은 exe 옆에 둡니다.

---

## 구조

```
rpa-ncr/
├── main.py                 # 웹 진입점 (DPI awareness → uvicorn → 브라우저)
├── run_worker.py           # 헤드리스 CLI
├── config/                 # settings.json, field_mapping.json, valid_items.txt(선택)
├── src/
│   ├── data_source/        # base(ABC)/api_source/db_source/report_model — api·db 추상화
│   ├── rpa/                # window_controller·input_sequence·fallback_controller(OCR_EU 포팅)
│   │                       # + ncr_field_map·ncr_connector(신규)
│   ├── web/                # app(FastAPI)·state·schemas + templates/static
│   └── utils/              # config_loader·logger·file_utils
└── PRIVATE/                # app_db.json (gitignore)
```

> 기존 `../rpa/` 폴더(반제품 골격)는 이 프로젝트로 대체됩니다. 데이터 흐름·API 형태는
> `artifacts/api-server/src/routes/reports.ts`, DB 스키마는
> `lib/db/src/schema/nonConformityReports.ts`를 참고하세요.
