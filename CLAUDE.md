# CLAUDE.md — Claude Code 진입 지시

**이 파일은 새 Claude Code 세션이 시작될 때 자동으로 로드됩니다.**

## 필수 첫 행동

1. **`PRIVATE/HANDOFF.md` 를 먼저 읽으세요.**
   - 시크릿(DB URL·API 키·비밀번호) 포함 완전 인수인계 문서
   - gitignore 되어 있어 GitHub 에 없음. 로컬 파일만 있음
   - 없으면 사용자에게 "HANDOFF.md 가 없습니다. 이전 세션 안내 요청드립니다" 라고 알림

2. `git log --oneline -20` 으로 최근 커밋 파악.

3. 사용자 응답은 **반드시 한국어**, 냉철·간결.

## 프로젝트 한 줄

수산중공업 NCR(부적합 보고) 관리 시스템. 웹 폼 등록 → QC 검토 → RPA 가 UNIERP 자동입력.

## 4계층 요약

- **Frontend** — `artifacts/ncr-app` (React+Vite, Replit 배포)
- **Backend** — `artifacts/api-server` (Express+Drizzle, Replit 배포, Neon Postgres)
- **ETL** — `erp_query/` (Python, K-System → Neon, 사내 PC Task Scheduler 4회/일)
- **RPA 워커** — `rpa-ncr/` (Python, pywinauto, 사내 PC 수동 실행)

## 절대 지킬 것

- **`PRIVATE/` 어떤 파일도 git add 하지 말 것.** gitignore 되어 있어도 항상 확인.
- **`git push` 는 사용자 명시 승인 후.** 커밋만 하고 대기가 기본.
- **파괴적 git 명령 (`push --force`, `reset --hard` 등) 은 명시 요청 없이 금지.**
- **CLAUDE.md 에는 시크릿 절대 X.** 시크릿은 `PRIVATE/HANDOFF.md` 에만.

## 자주 하는 실수 방지

- **한국어 파일명** git status 에서 escape 됨 → `git -c core.quotepath=false status` 로 정상 표시
- **`PYTHONIOENCODING=utf-8` 항상 설정** (cp949 사고 방지, HANDOFF §6.1 참조)
- **pnpm workspace** — `npm install` 하면 preinstall 훅이 에러. 항상 `pnpm`
- **orval codegen 결과물** (`lib/api-zod/`, `lib/api-client-react/`) **직접 편집 금지**. `openapi.yaml` 편집 후 `pnpm --filter @workspace/api-spec run codegen`
- **`rpa/` 폴더** = deprecated 스텁. 현행은 **`rpa-ncr/`**

## 사용자 표현 사전

| 표현 | 뜻 |
|---|---|
| `ㄱㄱ` | 진행 (승인) |
| `냉철하게 분석` | 완곡 표현 없이 정직히 |
| `찐 배포`·`라이브 반영` | Replit 재배포 필요한지 물어봄 |

## 문서 지도

- **`PRIVATE/HANDOFF.md`** — AI 용 완전 브리핑 (여기부터 읽기)
- `replit.md` — 프로젝트 개요 (Replit 자동 참조)
- `rpa-ncr/docs/INDEX.html` — 실사용자 대상 가이드 (작업자·QC·RPA운영자·IT관리자)
- `rpa-ncr/README.md` — RPA 워커 설치·운영
- `erp_query/README.md` + `DEPLOY.md` — 동기화 배포

## 상태 확인 (빠른 체크)

```bash
# 최근 커밋
git -C /c/Users/Administrator/Downloads/Code-Transformer log --oneline -10

# ERP 동기화 상태 (Windows 사내 PC)
# PowerShell: Get-ScheduledTask -TaskName "ErpItemSync" | Get-ScheduledTaskInfo

# Neon DB 상태 분포
# python + psycopg2 (HANDOFF §7.6 참조)
```

---

**다음 단계**: `PRIVATE/HANDOFF.md` 열어서 §0 부터 순서대로.
