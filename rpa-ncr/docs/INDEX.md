<!--
title: NCR 시스템 문서 목차
subtitle: 어떤 역할이면 어느 문서를 봐야 하는가
-->

<div class="doc-header">
NCR(부적합 보고) 시스템은 <strong>현장 작업자 → QC 담당 → RPA 워커 → UNIERP</strong> 4단계로
흐릅니다. 아래에서 본인 역할을 골라 시작하세요. 각 문서는 <strong>요약(5분)</strong>과
<strong>상세(20~30분)</strong> 두 편으로 나뉩니다.
</div>

## 역할별 문서

<div class="grid-2" markdown="1">

<div markdown="1">

### 현장 작업자
<span class="role-badge role-worker">신고 등록자</span>

부적합을 발견해서 **모바일/PC 로 보고서를 등록**하는 사람.

- [요약 (한 페이지)](작업자_요약.html)
- [상세 (폼 필드·자동채움·사진 첨부)](작업자_상세.html)

</div>

<div markdown="1">

### QC 담당자
<span class="role-badge role-qc">검토·조치방향</span>

등록된 보고를 **검토·조치방향 결정** 하는 사람.

- [요약 (한 페이지)](QC_요약.html)
- [상세 (검토 흐름·상태 관리·코멘트)](QC_상세.html)

</div>

<div markdown="1">

### RPA 운영자
<span class="role-badge role-operator">UNIERP 자동입력</span>

`시작.bat` 을 실행해 **UNIERP 부적합보고서등록 화면에 자동 입력** 하는 사람.

- [요약 (한 페이지)](RPA운영자_요약.html)
- [설치 상세](RPA운영자_설치_상세.html) *(기존 설치가이드 갱신본)*
- [사용 상세 — T1/T2 반영](RPA운영자_사용_상세.html) *(기존 사용가이드 갱신본)*

</div>

<div markdown="1">

### IT / 관리자
<span class="role-badge role-admin">모니터링·복구</span>

**전체 흐름 이해·동기화 관찰·갇힌 보고 복구**를 담당하는 사람.

- [요약 (한 페이지)](IT관리자_요약.html)
- [상세 (아키텍처·트러블슈팅)](IT관리자_상세.html)

</div>

</div>

---

## 최근 시스템 변경 (알아둘 것)

| 변경 | 영향 대상 | 의미 |
|---|---|---|
| **PROCESSING 자동회수 (T1)** | RPA 운영자 · IT 관리자 | 5시간 넘게 갇힌 보고는 다음 조회에서 자동 PENDING 복원. 이제 손으로 DB 열 필요 없음. |
| **REVIEW 상태 도입 (T2)** | RPA 운영자 · QC 담당자 | UNIERP 저장 완료 후 <span class="tag tag-review">REVIEW</span> 로 승격. 서버·브라우저 재시작해도 검토 대기 안 사라짐. |
| **동기화 4회/일 (T3)** | 현장 작업자 · QC 담당자 | ERP 신규 자재/거래처가 앱 검색에 반영되기까지 최대 **12h → 5h** 로 단축. |

## 시스템 전체 흐름 한 장

```
[현장 작업자]        [QC 담당자]         [RPA 운영자]        [UNIERP]
    │                    │                    │                 │
  모바일/PC            대시보드              시작.bat             │
    │                    │                    │                 │
    ├─ 폼 작성          ├─ 검토               ├─ 조회             │
    ├─ ERP 자동검색      ├─ 조치방향          ├─ 자동입력          │
    ├─ 사진 첨부         ├─ 코멘트            ├─ 배치 검토         │
    │                    │                    │                 │
    ↓                    ↓                    ↓                 ↓
  PENDING            IN_REVIEW ~          PROCESSING           저장
                    APPROVED               → REVIEW              │
                        │                    → COMPLETED        │
                        └─────── 알림 ────────┘                  │
```

## 상태 값 참조표

| 상태 | 의미 | 다음 상태 |
|---|---|---|
| <span class="tag tag-pending">PENDING</span> | 등록 완료, RPA 대기 중 | PROCESSING |
| <span class="tag tag-processing">PROCESSING</span> | RPA 가 UNIERP 에 입력 중 | REVIEW / FAILED |
| <span class="tag tag-review">REVIEW</span> | UNIERP 저장 완료, 사용자 최종 확인 대기 | COMPLETED |
| <span class="tag tag-completed">COMPLETED</span> | 확인 완료, 종결 | — |
| <span class="tag tag-failed">FAILED</span> | 실패, 로그 확인 필요 | (재시도로 PENDING) |

## 문의

- 시스템 오류·잘못된 데이터: **IT/관리자**
- 폼 사용법·자동채움 안 됨: **RPA 운영자** 또는 **IT/관리자**
- 보고 내용 수정·조치방향: **QC 담당자**
