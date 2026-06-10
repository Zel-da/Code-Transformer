# ⚠ DEPRECATED — `rpa-ncr/` 가 현행

이 폴더는 초기 스켈레톤입니다. **현재 운영 중인 RPA 워커는 `rpa-ncr/`** 이며,
- 풀스택 (data_source 추상화 + 웹 UI 진행 상황 + 빌드 스펙)
- NCR API/DB 두 가지 소스 지원
- 윈도우 컨트롤러 캘리브레이션 완료
- 별도 워커 폴링/실행 흐름

이 `rpa/` 폴더는:
- 창 제목·좌표·필드 매핑이 전부 `TODO_*` 상태로 **캘리브레이션 미완료**
- 워크플로 폼 입력 시퀀스가 비어 있어 **실제 ERP 입력 불가**
- `core/` 모듈 일부(WindowController, PopupHandler)는 참고용으로 둠

신규 개발/운영은 `rpa-ncr/` 를 사용하세요. 이 폴더는 곧 정리될 예정이며,
실수로 `python rpa/main.py` 를 돌리면 즉시 에러로 종료됩니다 (main.py 가드).

---

(이하 옛 문서, 참고용)

# (구) NCR RPA 클라이언트

Windows ERP GUI에 부적합 보고서를 자동 입력하는 Python RPA.

## 환경

- Windows 10/11
- Python 3.11+
- pywinauto (UIA 백엔드) + pyperclip + keyboard

## 설치

```bash
pip install -r requirements.txt
```

## 설정

1. `.env.example` → `.env` 복사 후 아래 항목 입력

| 환경 변수 | 설명 |
|---|---|
| `NCR_API_BASE` | NCR 웹 서버 주소 (예: `http://192.168.1.10:3000`) |
| `UNIERP_EXE_PATH` | UNIERP 실행 파일 전체 경로 (예: `C:\UNIERP\UNIERP.exe`) |
| `UNIERP_USERNAME` | ERP 로그인 아이디 |
| `UNIERP_PASSWORD` | ERP 로그인 비밀번호 |

2. `config/settings.json`
   - `launch.login_window_title` — 로그인 창 제목 패턴 (기본: `.*로그인.*`)
   - `login_coords` — 좌표 캘리브레이션 후 아이디/비밀번호/버튼 좌표 입력  
     (0,0 이면 Tab 방식 자동 사용)
3. `config/field_mapping.json` — NCR 필드 → ERP 폼 필드 매핑 (추후)

## 실행

```bash
# 폴링 모드 (60초마다 PENDING 보고서 처리, 각 사이클마다 UNIERP 자동 실행/로그인)
python main.py

# 단일 실행 후 종료
python main.py --once

# 특정 보고서만 테스트
python main.py --report-id 42

# ERP 입력 없이 목록만 조회
python main.py --dry-run --once
```

## 자동 실행·로그인 흐름

```
작업자(모바일/웹) 보고서 제출 → DB syncStatus=PENDING
        │
        ▼
Python RPA (폴링) — GET /api/reports/pending 로 PENDING 목록 조회
        │
        ├─ 각 보고서: PATCH /api/reports/:id/sync-status {PROCESSING}
        │
        ├─ UNIERP 프로세스 확인
        │     ├─ 실행 중  → 기존 창에 연결
        │     └─ 미실행  → exe 실행 → 로그인 창 대기 → ID/PW 입력 → Enter
        │
        ▼
  메인 창 로딩 확인 → 보고서 ERP 입력 (폼 순서는 캘리브레이션 후 구현)
        │
        ▼
  성공 → PATCH .../sync-status {COMPLETED}
  실패 → PATCH .../sync-status {FAILED}  (오류 상세는 rpa.log)
```

> 참고: `POST /api/rpa/trigger` 엔드포인트는 서버 측 처리 시뮬레이션(목업)이라
> 실제 RPA 클라이언트는 위의 `GET /reports/pending` + `PATCH .../sync-status`를 사용한다.

## 디렉터리 구조

```
rpa/
├── core/
│   ├── window_controller.py  # 창 연결·좌표·키 입력 저수준
│   ├── popup_handler.py      # 팝업 감지·dismiss
│   └── exceptions.py         # FocusLostError 등
├── steps/
│   ├── input_step.py         # InputStep / InputMethod 정의
│   └── sequence_builder.py   # 시퀀스 실행 엔진
├── workflows/
│   └── ncr_workflow.py       # 비즈니스 흐름 (폼 입력)
├── config/
│   ├── settings.json         # 좌표·타이밍·ERP 설정
│   └── field_mapping.json    # 필드 매핑 테이블
├── api_client.py             # NCR API 서버 통신
├── main.py                   # 진입점
└── requirements.txt
```

## 캘리브레이션 절차 (§14)

1. ERP 창 최대화 (`ensure_maximized()`)
2. UIA 인스펙터(`print_control_identifiers()`)로 컨트롤 트리 확인
3. `config/settings.json` → `coords` 섹션에 기준 해상도 기준 좌표 입력
4. `workflows/ncr_workflow.py` → TODO 항목을 실제 필드 시퀀스로 교체
5. `--dry-run` → `--report-id N` 순서로 단계별 테스트
