# NCR RPA 클라이언트

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
웹 UI [RPA 실행] 버튼 클릭
        │
        ▼
API 서버 POST /api/rpa/trigger
        │
        ▼
Python RPA (폴링 중) — PENDING 보고서 감지
        │
        ├─ UNIERP 프로세스 확인
        │     ├─ 실행 중  → 기존 창에 연결
        │     └─ 미실행  → exe 실행 → 로그인 창 대기 → ID/PW 입력 → Enter
        │
        ▼
  메인 창 로딩 확인
        │
        ▼
  보고서 ERP 입력 (폼 순서는 추후 구현)
```

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
