<!--
title: RPA 사용 가이드 (상세)
role: operator
subtitle: 매일 PENDING 조회 → 자동 입력 → 검토 → 완료
-->

# rpa-ncr 사용 가이드 (상세)

**대상**: RPA 운영자 (RPA 를 매일 돌리는 사람 — 안예준 / 백승기 직장님 등)

**전제**: 최초 설치는 완료된 상태 (설치는 `RPA운영자_설치_상세.md` 참조).

---

## 0. 이 프로그램이 하는 일 (한 줄)

Replit 웹폼에서 등록된 **부적합 보고**를 RPA 가 UNIERP 의 **부적합판정등록(S)** 폼에 **Tab 시퀀스**로 자동 입력한다.

전체 흐름:

```
[현장 작업자] 웹폼 등록 → sync_status=PENDING
        ↓
[QC 담당자] 웹 QC 페이지에서 판정·비용·의견 입력 (claim/parts/labor/judgment/quality)
        ↓
[Neon 클라우드 DB] non_conformity_reports 테이블
        ↓
[RPA 운영자] 시작.bat 실행 → 대시보드 → [입력 시작]
        ↓
[UNIERP 판정등록 폼] Tab 시퀀스로 25필드 자동 입력
        ↓
[사용자 검토] 배치 검토 UI → [완료 확인]
        ↓
[Neon DB] sync_status=COMPLETED
```

---

## 1. 매일 사용 절차 (10 스텝)

### 스텝 1. UNIERP 미리 실행

관리자 권한으로 UNIERP 를 켜고 로그인. 로그인만 완료된 상태 (특정 메뉴 열 필요 없음).

> **왜 관리자 권한?** UNIERP 가 관리자 권한으로 뜨면 RPA 도 관리자 권한이어야 창 조작 가능 (Windows UIPI 정책). 시작.bat 이 자동으로 UAC 승격 요청함.

### 스텝 2. 시작.bat 더블클릭

바탕화면의 **NCR RPA** 바로가기 (또는 `Documents\rpa-ncr\시작.bat`) 더블클릭.

내부적으로 다음 순서:

1. UAC 창 뜨면 **[예]**
2. Python 설치 확인
3. **자동 업데이트 확인** (인터넷 있으면):
   - `[update] 최신 버전 사용 중 (xxxxxxx)` — 아무 것도 안 함
   - `[update] 새 버전 발견: aaa → bbb` — 자동 다운로드/적용
   - 오프라인이면 조용히 스킵
4. `.venv` 있으면 재사용, 없거나 requirements 바뀌면 자동 설치 (2~3분)
5. `main.py` 실행 → 브라우저 자동 오픈 (`http://127.0.0.1:8010`)

### 스텝 3. 데이터 소스 확인

대시보드 좌측 **데이터 소스** 카드:
- **공용 DB (Neon)** 선택되어 있어야 함
- 하단에 `API: http://localhost:3000 · DB: 설정됨` 표시되면 정상
- 필요 시 **[연결 테스트]** → `DB 연결 OK (Neon)`

### 스텝 4. PENDING 조회

우측 **실행** 카드에서 **[PENDING 조회]** 클릭.

- 큐 테이블에 대기 중인 보고 목록이 채워짐
- 로그: `DbSource 쿼리 캐시: 33 컬럼 (신규 6개, item_groups=있음)` + `PENDING 보고 N건 조회 (DB)`
- 보고가 0건이면: Replit 에서 신규 보고를 등록하거나 QC 페이지에서 넘긴 뒤 다시 조회

### 스텝 5. ERP 창 확인

**[ERP 창 확인]** 클릭 → `✓ ERP 창 발견: UNIERP - SOOSAN CEBOTICS(Admin)` 확인.

- 에러면: UNIERP 를 확실히 켜고 로그인 후 재시도
- 여러 창이 뜨거나 다른 UNIERP 세션이 돌면 종료 후 하나만 유지

### 스텝 6. 입력 시작

**[입력 시작]** 클릭 → RPA 가 자동으로:

1. F3 눌러 메뉴찾기 → `부적합판정등록(S)(QD231MA1_CKO063)` 붙여넣고 Enter → 폼 열림
2. Tab × 10 → **발행팀** 도달, 첫 값 입력
3. 이후 Tab 시퀀스로 25개 필드 순회 입력
4. Ctrl+S 저장
5. Shift+Insert → Enter → 신규 폼
6. 다음 보고 → 반복

**입력 중 절대 금지**:
- 마우스로 다른 창 클릭 (포커스 이탈 → RPA 자동 중지)
- 키보드 조작
- 창 최소화

### 스텝 7. 일시정지 / 중지 (필요 시)

- **[일시정지/재개]** — 현재 스텝 끝나면 대기. 다시 누르면 재개
- **[중지]** — 즉시 중단, 현재 보고는 PENDING 으로 복원

### 스텝 8. 배치 검토

모든 보고 입력·저장이 끝나면 자동으로 **일괄 검토 패널**이 뜬다:

- **1 보고 = 1 페이지**, 25개 필드 표시
- **[◀ 이전 보고 / 다음 보고 ▶]** 로 페이지 이동
- 필드별 값·method 확인
- UNIERP 로 가서 실제 저장 결과 확인

### 스텝 9. 완료 확인

- **[이 보고 완료 확인]** — 현재 보고만 `sync_status=COMPLETED` → 자동 다음 페이지
- **[모두 확인]** — 25건 전체 일괄 완료 (확인 다이얼로그 있음)
- **[처음부터]** — 현재 보고 재실행 (메뉴 다시 열고 처음부터 입력)
- **[재실행 #N]** — 특정 필드만 다시 (사용자가 UNIERP 에서 그 필드에 직접 포커스 후 클릭)

### 스텝 10. 종료

콘솔 창(검은 창) 닫으면 서버 종료. UNIERP 는 그대로 두고 로그아웃.

---

## 2. UNIERP 판정등록 폼 필드 (25개 순서)

RPA 가 다음 순서로 Tab 이동하며 입력한다. **Tab×N** 은 이전 필드에서 몇 번 눌러 도달하는지:

| # | 필드 | 방식 | 값 | Tab |
|---|---|---|---|---|
| 1 | 발행팀 | type | `SH11510500` (고정) | **×10 진입** |
| 2 | 부적합구분 | dropdown | `3` (↓×3 + Enter) | ×1 |
| 3 | 발생일 | type | `occurrenceDate` YYYYMMDD | ×1 |
| 4 | 입력일 | type | `reportDate` YYYYMMDD | **×2** (disabled 1개 흡수) |
| 5 | 공장 | type | `SA00` (고정) | ×1 |
| 6 | 공정 | type | `processCd` | ×1 |
| 7 | 부품코드 | type | `itemCode` | ×1 |
| 8 | 품목그룹 | type | `itemGroupCd` (item_groups 조인) | ×1 |
| 9 | 불량수량 | type | `defectQty` | ×1 |
| 10 | 거래처 | type | `vendorCd` | ×1 |
| 11 | 불량유형 | dropdown | `flawTypeCd` (A~Z 매핑) | ×1 |
| 12 | 제품코드 | type | `itemCode` | ×1 |
| 13 | 손실공수 | type | `lostManHours × 60` (분 단위) | ×1 |
| 14 | 출하호기 | skip | (매핑 미확정) | ×1 |
| 15 | 비고 | type | `remarks` | ×1 |
| 16 | 출하일 | type | `shipmentDateFrom` YYYYMMDD | ×1 |
| 17 | 클레임유무 | **radio** | `claimStatus` 예=← +Space, 아니면 통과 | **×3** (초기품질·유관부서여부 흡수) |
| 18 | 유관부서 | skip | (드롭박스 map 미확정) | ×1 |
| 19 | 부품비 | type | `partsCost` | ×1 |
| 20 | 공임비 | type | `laborCost` | ×1 |
| 21 | 부적합현상 | skip | (Neon 컬럼 대기) | **×2** (클레임금액 흡수) |
| 22 | 조치결과 | type | `qcCorrectiveResult` | ×1 |
| 23 | 시정및예방조치여부 | **radio** | `correctiveActionStatus` 예=← +Space | ×1 |
| 24 | 유관부서의견 | skip | (값 안 넣음) | ×1 |
| 25 | 품질의견 | type | `qualityOpinion` | ×1 |

누적 Tab 수: **38회**

### RPA 가 안 건드리는 필드 (자동 채움/미지원)

- **발행번호**, **AS접수번호**, **클레임금액**, **등록자** — ERP 가 자동 채움
- **초기품질여부** — 기본 "아니오" 유지
- **유관부서여부** — 기본 "아니오" 유지
- **첨부파일** — 파일 업로드는 RPA 미지원

### 라디오(예/아니오) 처리 규칙

값에 따라 동작:
- `예`, `Y`, `yes`, `true`, `1`, `T` (대소문자 무관) → **← + Space** (예 선택)
- 그 외 / 빈 값 / `아니오` / `N` → 아무것도 안 함 (기본 "아니오" 유지)

---

## 3. 자동 업데이트

### 동작
매 시작 시 `시작.bat` 내부에서 `update.py` 실행:

1. **git 저장소면**: `git ls-remote origin main` 으로 원격 SHA 조회 → 다르면 `git pull --ff-only`
2. **ZIP 배포본이면**: GitHub API → `.version` 비교 → 다르면 `archive.zip` 다운로드
3. **보존 규칙**:
   - ⛔ 안 건드림: `PRIVATE/`, `logs/`, `.venv/`, `.version`, `config/*` (사용자 편집분)
   - ✅ 업데이트: `config/forms/_defaults/*`, `src/`, `시작.bat`, `main.py`, `requirements.txt`, `docs/`
4. **실패 시**: `backup_before_{sha}/` 폴더에서 자동 복원
5. **requirements 변경 시**: `.venv/.install_ok` 삭제 → 다음 실행 시 재설치

### 비활성화 (필요 시)
`rpa-ncr/.no_auto_update` 빈 파일 생성 → 자동 업데이트 스킵

### 수동 확인
```powershell
cd C:\Users\<계정>\Documents\rpa-ncr
python update.py --check    # 새 버전 있는지만 확인 (exit 1 이면 있음)
python update.py --force    # 최신이어도 강제 재다운로드
```

---

## 4. 트러블슈팅

### "ERP 창을 찾을 수 없음"
- UNIERP 를 켜지 않음 or 다른 계정으로 실행됨 → 로그아웃 후 재로그인
- window_title 기준: `UNIERP - SOOSAN CEBOTICS` 포함 여부
- process_name 기준: `Bizentro`
- **UNIERP 가 관리자 권한이면 시작.bat 도 관리자 권한이어야 함** (UAC 자동 승격 실패했다면 우클릭 → 관리자 권한으로 실행)

### "Tab 순서가 어긋남 / 다른 필드에 값이 들어감"
- UNIERP 폼 레이아웃이 변경됐거나 disabled 필드 수가 다름
- 수정: `config/forms/_defaults/부적합판정등록.json` 의 각 필드 `tabs_before` 조정
- 예: 5번 필드 값이 4번 필드에 들어감 → 5번 `tabs_before` 를 2로 (하나 더 건너뜀)

### "라디오 값이 잘못 선택됨"
- `claim_status` 나 `corrective_action_status` 의 실제 DB 값 확인
- `예`/`Y`/`true` 계열이면 자동 "예" 선택
- 그 외는 기본 "아니오" 유지
- DB 값이 `"O"` 나 `"1"` 같은 특수값이면 `_type_step_value` 의 예/아니오 판별 로직에 매핑 추가 필요

### "포커스 이탈로 중단됨"
- 입력 중 다른 창을 클릭했거나 알림창이 뜸
- 대시보드 [입력 시작] 재클릭 → 중단됐던 지점부터 재개 (해당 보고는 PENDING 복원됨)

### "업데이트 실패"
- 로그: `업데이트 실패 (백업 복원됨): ...`
- 자동 복원됨 → 그대로 계속 사용 가능
- 다음 실행에서 재시도. 계속 실패하면 `.no_auto_update` 만들고 수동 재설치

### "설치가이드 대로 안 됨"
- Python 3.11 or 3.12 인지 확인 (3.13 은 일부 패키지 호환 문제)
- 회사 방화벽이 pypi.org / github.com 차단하는지 확인

---

## 5. 폼 프로파일 수정 (개발자용)

### 편집 대상
- **`rpa-ncr/config/forms/_defaults/부적합판정등록.json`** — 원본 (Git 관리, 자동 업데이트로 배포)
- **`rpa-ncr/config/forms/부적합판정등록.json`** — user override (있으면 우선, 자동 업데이트로 안 사라짐)

### 필드 스펙

```json
{
    "label": "필드명 (표시용)",
    "method": "type | dropdown | radio | skip",
    "ncr_key": "camelCase 필드명 (NcrReport 에서 값 가져올 키)",
    "literal": "고정값 (ncr_key 대신)",
    "format": "YYYYMMDD (날짜 필드)",
    "transform": "multiply_60 (손실공수 h→분)",
    "fallback_key": "ncr_key 값 없을 때 대체 키",
    "map_ref": "flawType_map (dropdown 매핑 참조)",
    "tabs_before": 1
}
```

### 신규 필드 추가 워크플로

1. **Neon 스키마 확인** — Replit 개발자에게 컬럼 추가 요청 (`Drizzle nonConformityReports.ts`)
2. **`db_source._OPTIONAL_NON_CONFORMITY_COLS`** 에 `(snake_case, camelCase)` 추가
3. **`report_model.CANONICAL_FIELDS`** 에 `camelCase` 추가
4. **폼 프로파일** `header_fields` 에 항목 추가 (적절한 위치)
5. 커밋 → 푸시 → 다음 실행 시 자동 반영

### 라디오 필드 추가

```json
{ "label": "새라디오",
  "method": "radio",
  "ncr_key": "someBooleanField",
  "tabs_before": 1 }
```

값이 `예/Y/yes/true/1/T` 면 ← + Space, 그 외는 기본 유지.

### Tab 카운트 조정
- 실사용 후 어긋난 필드 발견 시 그 필드의 `tabs_before` 를 1→2 (또는 더) 로 조정
- 루트 원인: UNIERP 폼에 disabled/hidden 필드가 Tab 순서에 있는지 여부

---

## 6. 파일 지도

| 경로 | 역할 |
|---|---|
| `시작.bat` | 원클릭 실행 (UAC → 자동 업데이트 → 서버) |
| `바탕화면에 바로가기 만들기.bat` | 바탕화면 아이콘 생성 (1회) |
| `진단.bat` | UIA/Win32 창 enumerate (문제 진단용) |
| `main.py` | FastAPI 서버 진입점 |
| `run_worker.py` | 헤드리스 CLI (테스트용, 옵션) |
| `update.py` | 업데이트 CLI 래퍼 |
| `src/utils/updater.py` | 업데이트 핵심 로직 (git pull / archive zip / 백업/롤백) |
| `src/data_source/db_source.py` | Neon Postgres SELECT (동적 컬럼 감지) |
| `src/data_source/report_model.py` | `NcrReport` dataclass, `CANONICAL_FIELDS` |
| `src/rpa/ncr_connector.py` | 오케스트레이터 (`launch_and_connect`, `input_report`, `_execute_sequence_tab_mode`, `_type_step_value`) |
| `src/rpa/window_controller.py` | pywinauto 창 제어 (F3 메뉴, ensure_maximized) |
| `src/rpa/ncr_field_map.py` | 폼 프로파일 → InputSequence |
| `src/rpa/input_sequence.py` | `InputStep`, `InputMethod` (RADIO_YES_NO 포함) |
| `src/web/app.py` | REST/WS 엔드포인트 20+ |
| `src/web/state.py` | 세션 상태 (배치 검토 큐) |
| `src/web/templates/index.html` | 대시보드 |
| `src/web/static/js/app.js` | 대시보드 JS |
| `config/settings.json` | ERP·소스·서버 설정 |
| `config/forms/_defaults/부적합판정등록.json` | 판정등록 폼 프로파일 (Git 관리) |
| `config/forms/부적합판정등록.json` | user override (있으면 우선, 자동 업데이트 대상 아님) |
| `PRIVATE/app_db.json` | Neon DB URL (gitignore) |
| `PRIVATE/HANDOFF.md` | AI 인수인계 문서 (gitignore) |
| `.version` | 현재 커밋 SHA (gitignore) |
| `.no_auto_update` | 이 파일 있으면 자동 업데이트 스킵 |

---

## 7. 이 가이드 유지보수 규칙

**코드/폼/DB 스키마가 바뀌면 이 문서도 반드시 함께 업데이트한다.**

특히:
- 폼 프로파일 필드 순서/tabs_before 변경 → §2 표 갱신
- 새 필드 추가 → §2 표 + §5 워크플로 예시 반영
- 자동 업데이트 로직 개선 → §3 반영
- 새 트러블슈팅 사례 발견 → §4 추가

`CLAUDE.md` 에도 명시되어 있음: AI 세션이 rpa-ncr 코드 수정 시 이 가이드를 동기로 갱신할 것.

---

**최종 갱신**: 커밋 `126a745` (2026-09-16) — Tab 모드 + 자동 업데이트 리팩터 + QC 필드 8개 추가
