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

1. `.env.example` → `.env` 복사 후 서버 주소 입력
2. `config/settings.json` — ERP 창 제목, 좌표 캘리브레이션 값 입력
3. `config/field_mapping.json` — NCR 필드 → ERP 폼 필드 매핑 입력

## 실행

```bash
# 폴링 모드 (60초마다 PENDING 보고서 처리)
python main.py

# 단일 실행 후 종료
python main.py --once

# 특정 보고서만 테스트
python main.py --report-id 42

# ERP 입력 없이 목록만 확인
python main.py --dry-run --once
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
