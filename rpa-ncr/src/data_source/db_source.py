"""공용 Neon Postgres 직접 연결 데이터 소스.

erp_query/sync_items.py 의 URL 해석 + psycopg2 연결 패턴을 미러한다.
URL 우선순위: settings.db.database_url → env DATABASE_URL → PRIVATE/app_db.json[database_url].

snake_case 컬럼을 SQL AS 별칭으로 camelCase 키로 바꿔 ApiSource와 동일한
NcrReport dict를 산출한다. DB 직접 경로는 API에 없는 sync_last_error /
sync_attempt_count 컬럼까지 기록할 수 있다.
"""
import json
import os
from typing import Any

from src.data_source.base import DataSource, ReportStatus
from src.data_source.report_model import NcrReport
from src.utils.file_utils import get_private_dir
from src.utils.logger import get_logger

logger = get_logger(__name__)

# 항상 존재한다고 가정하는 핵심 컬럼 (snake_case → camelCase 별칭)
_CORE_SELECT_PARTS: tuple[str, ...] = (
    "r.id",
    'r.report_date      AS "reportDate"',
    'r.item_code        AS "itemCode"',
    'r.model_name       AS "modelName"',
    'r.process_name     AS "processName"',
    'r.defect_type      AS "defectType"',
    "r.description",
    'r.image_url        AS "imageUrl"',
    'r.sync_status      AS "syncStatus"',
    'r.registrant_name  AS "registrantName"',
    'r.ncr_type         AS "ncrType"',
    "r.factory",
    'r.shipment_unit    AS "shipmentUnit"',
    'r.lost_man_hours   AS "lostManHours"',
    'r.defect_qty       AS "defectQty"',
    'r.occurrence_date  AS "occurrenceDate"',
    'r.issuing_team     AS "issuingTeam"',
    'r.plant_cd         AS "plantCd"',
    'r.process_cd       AS "processCd"',
    'r.flaw_type_cd     AS "flawTypeCd"',
    'r.dept_cd          AS "deptCd"',
    'r.ncr_gbn_cd       AS "ncrGbnCd"',
    'r.product_type     AS "productType"',
    'r.vendor_cd        AS "vendorCd"',
    'r.vendor_nm        AS "vendorNm"',
    'ic.name            AS "itemName"',  # item_codes 마스터에서 늘 따올 수 있음
    # itemGroupCd(ig.group_cd)는 item_groups 테이블 존재 여부에 따라 동적으로 추가
)

# 동적으로 존재 여부를 확인하는 선택 컬럼 (snake_case → camelCase 별칭).
# Drizzle 스키마에는 있지만 Neon에 아직 push 안 됐을 수도 있어 정보스키마로 검증.
_OPTIONAL_NON_CONFORMITY_COLS: tuple[tuple[str, str], ...] = (
    ("remarks",            "remarks"),
    ("shipment_date_from", "shipmentDateFrom"),
    ("shipment_date_to",   "shipmentDateTo"),
    ("manager_cd",         "managerCd"),
    ("manager_nm",         "managerNm"),
    ("ncr_number",         "ncrNumber"),
    # 부적합판정등록(S) — QC 분석 필드 (Replit 웹폼 QC 페이지 저장분)
    ("claim_status",              "claimStatus"),
    ("parts_cost",                "partsCost"),
    ("labor_cost",                "laborCost"),
    ("related_dept_status",       "relatedDeptStatus"),
    ("judgment_result",           "judgmentResult"),
    ("qc_corrective_result",      "qcCorrectiveResult"),
    ("corrective_action_status",  "correctiveActionStatus"),
    ("quality_opinion",           "qualityOpinion"),
    # QC/재시도 상태 (UI 표시 + 서버 라우트와 동일 기준으로 필터링하기 위해 조회)
    ("qc_status",            "qcStatus"),
    ("sync_attempt_count",   "syncAttemptCount"),
    ("sync_last_error",      "syncLastError"),
    ("sync_next_retry_at",   "syncNextRetryAt"),
)

# RPA 입력 대상이 되기 위해 필요한 QC 상태 (artifacts/api-server/routes/rpa.ts 와 동일 기준)
_RPA_ELIGIBLE_QC_STATUS = "APPROVED"

# 재시도 최대 횟수 (artifacts/api-server/routes/rpa.ts 의 MAX_ATTEMPTS 와 일치)
_MAX_ATTEMPTS = 5


def _backoff_minutes(attempt: int) -> int:
    """재시도 백오프 (지수, 최대 60분). rpa.ts 의 backoffMinutes 와 동일 공식."""
    return min(2 ** max(1, attempt), 60)

# 항상 포함되는 기본 FROM 절. item_groups는 존재 여부 확인 후 동적으로 JOIN 추가.
_FROM_BASE = (
    "non_conformity_reports r "
    "LEFT JOIN item_codes ic ON ic.code = r.item_code"
)
_FROM_ITEM_GROUPS_JOIN = " LEFT JOIN item_groups ig ON ig.group_nm = ic.category"


def _resolve_database_url(cfg: dict[str, Any]) -> str:
    """DB URL을 settings → PRIVATE/app_db.json → env 순으로 해석한다.

    PRIVATE/app_db.json을 env보다 우선시키는 이유: 개발 PC의 셸 환경에
    다른 프로젝트용 DATABASE_URL이 떠 있을 수 있어, 앱별 명시 파일을
    더 신뢰한다.
    """
    url = (cfg.get("database_url") or "").strip()
    if url:
        return url
    path = get_private_dir() / "app_db.json"
    if path.is_file():
        try:
            with open(path, encoding="utf-8") as f:
                file_url = (json.load(f).get("database_url") or "").strip()
            if file_url:
                return file_url
        except Exception as e:
            logger.warning("PRIVATE/app_db.json 읽기 실패, env DATABASE_URL로 폴백: %s", e)
    env = os.getenv("DATABASE_URL")
    if env:
        return env
    return ""


class DbSource(DataSource):
    def __init__(self, cfg: dict[str, Any]):
        self._url = _resolve_database_url(cfg)
        # 첫 조회에서 정보스키마 보고 (select_clause, from_clause) 튜플 캐시
        self._query_parts: tuple[str, str] | None = None
        # 신규 컬럼 존재 여부 캐시 (fetch_pending / mark_* 에서 참조)
        self._existing_cols: set[str] = set()
        # 담당 공장 필터 (SA00=아산, SH00=화성 등). 빈 리스트면 전체 조회.
        raw_filter = cfg.get("plant_filter") or []
        if isinstance(raw_filter, str):
            raw_filter = [raw_filter]
        self._plant_filter: list[str] = [str(p).strip() for p in raw_filter if str(p).strip()]
        self._include_null_plant: bool = bool(cfg.get("include_null_plant", False))
        # PROCESSING 갇힘 자동 회수 임계값 (분). RPA 정상 처리는 초~수분이라
        # 5시간이면 실 처리와 절대 겹치지 않는 안전 여백.
        stale_minutes = cfg.get("stale_processing_minutes", 300)
        try:
            self._stale_minutes = max(1, int(stale_minutes))
        except (TypeError, ValueError):
            self._stale_minutes = 300
        if not self._url:
            logger.warning(
                "DB URL 미설정 — settings.db.database_url / env DATABASE_URL / "
                "PRIVATE/app_db.json 중 하나를 채워야 합니다."
            )

    def _connect(self):
        import psycopg2  # 지연 import (드라이런/패키징 편의)
        if not self._url:
            raise RuntimeError("DB URL이 설정되지 않았습니다.")
        return psycopg2.connect(self._url)

    def _get_query_parts(self, cur) -> tuple[str, str]:
        """(SELECT 절, FROM 절) 튜플을 정보스키마 기반으로 동적 빌드해 캐시.

        - non_conformity_reports의 선택적 컬럼들 존재 여부 확인
        - item_groups 테이블 존재 여부 확인 → 없으면 JOIN 생략 + itemGroupCd 제외
        한 번 빌드 후 인스턴스 변수에 캐시.
        """
        if self._query_parts:
            return self._query_parts

        # non_conformity_reports 컬럼 존재 여부
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='non_conformity_reports'"
        )
        existing_cols = {(r["column_name"] if isinstance(r, dict) else r[0]) for r in cur.fetchall()}
        # mark_completed/mark_failed 에서도 참조하도록 캐시
        self._existing_cols = existing_cols

        # item_groups 테이블 존재 여부 (없으면 JOIN/itemGroupCd 생략)
        cur.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name='item_groups'"
        )
        has_item_groups = cur.fetchone() is not None

        parts = list(_CORE_SELECT_PARTS)

        # itemGroup: 직접 컬럼 우선 + JOIN fallback
        if "item_group" in existing_cols:
            parts.append('COALESCE(r.item_group, ic.category) AS "itemGroup"')
        else:
            parts.append('ic.category AS "itemGroup"')

        # itemGroupCd: item_groups 테이블이 있을 때만
        if has_item_groups:
            parts.append('ig.group_cd AS "itemGroupCd"')
        else:
            logger.warning(
                "item_groups 테이블이 없습니다 — RPA #9 품목그룹 필드는 비워집니다. "
                "ERP에서 sync_item_groups.py로 동기화하세요."
            )

        # 신규 컬럼: 존재할 때만 SELECT (Replit 푸시 전후 모두 안전)
        for snake, camel in _OPTIONAL_NON_CONFORMITY_COLS:
            if snake in existing_cols:
                parts.append(f'r.{snake} AS "{camel}"')

        select_clause = ",\n    ".join(parts)
        from_clause = _FROM_BASE + (_FROM_ITEM_GROUPS_JOIN if has_item_groups else "")

        self._query_parts = (select_clause, from_clause)
        logger.info(
            "DbSource 쿼리 캐시: %d 컬럼 (신규 %d개, item_groups=%s)",
            len(parts),
            sum(1 for s, _ in _OPTIONAL_NON_CONFORMITY_COLS if s in existing_cols),
            "있음" if has_item_groups else "없음",
        )
        return self._query_parts

    # ------------------------------------------------------------------
    # 조회
    # ------------------------------------------------------------------

    def _recover_stale_processing(self, cur) -> list[int]:
        """PROCESSING 상태로 임계값 넘긴 보고들을 PENDING 으로 자동 복원.

        RPA 워커 크래시/네트워크 단절로 mark_completed·mark_failed 호출이
        누락되면 이 보고는 다시 조회되지 않아 담당자가 손 못 대는 유령
        상태로 갇힌다. 정상 처리 시간은 초~수분이라 5시간 임계값이면
        실제 작업과 절대 겹치지 않는다.
        """
        cur.execute(
            "UPDATE non_conformity_reports "
            "SET sync_status = %s, "
            "    sync_last_error = COALESCE(sync_last_error, '') || %s, "
            "    sync_attempt_count = COALESCE(sync_attempt_count, 0) + 1, "
            "    updated_at = now() "
            f"WHERE sync_status = %s AND updated_at < now() - interval '{self._stale_minutes} minutes' "
            "RETURNING id",
            (
                ReportStatus.PENDING.value,
                f"\n[auto-recovered] PROCESSING > {self._stale_minutes}분 경과로 PENDING 복원",
                ReportStatus.PROCESSING.value,
            ),
        )
        rows = cur.fetchall()
        # RealDictCursor / 일반 cursor 양쪽 안전 처리
        recovered: list[int] = []
        for r in rows:
            if isinstance(r, dict):
                recovered.append(int(r["id"]))
            else:
                recovered.append(int(r[0]))
        return recovered

    def fetch_pending(self) -> list[NcrReport]:
        """RPA 입력 대상 보고 목록.

        필터 (artifacts/api-server/routes/rpa.ts 와 동일 기준):
          - sync_status = 'PENDING'
          - qc_status = 'APPROVED' (컬럼 존재 시) — QC 승인 안 난 보고는 제외
          - sync_next_retry_at IS NULL 또는 지금 이전 — 백오프 중인 보고는 제외

        이로써 웹에서 QC 승인 안 된 보고가 로컬 RPA 큐에 섞이지 않고,
        최근 실패 후 재시도 대기 중인 보고가 즉시 다시 뜨지도 않는다.
        """
        from psycopg2.extras import RealDictCursor
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 1) 조회 전 stale PROCESSING 자동 회수
                recovered = self._recover_stale_processing(cur)
                if recovered:
                    logger.warning(
                        "stale PROCESSING 자동 복원 %d건 → PENDING (임계값 %d분). ids=%s",
                        len(recovered), self._stale_minutes,
                        ",".join(str(i) for i in recovered),
                    )
                conn.commit()

                # 2) PENDING 목록 조회 (방금 복원한 것도 포함)
                select_clause, from_clause = self._get_query_parts(cur)
                where_parts = ["r.sync_status = %s"]
                params: list[Any] = [ReportStatus.PENDING.value]

                if "qc_status" in self._existing_cols:
                    where_parts.append("r.qc_status = %s")
                    params.append(_RPA_ELIGIBLE_QC_STATUS)
                else:
                    logger.warning(
                        "qc_status 컬럼이 Neon 에 없어 QC 승인 필터를 건너뜁니다 "
                        "— Replit 백엔드 schema push 가 필요합니다."
                    )

                if "sync_next_retry_at" in self._existing_cols:
                    where_parts.append(
                        "(r.sync_next_retry_at IS NULL OR r.sync_next_retry_at <= now())"
                    )

                # 담당 공장 필터 (plant_cd 기준). 리스트 비어있으면 전체.
                if self._plant_filter:
                    placeholders = ",".join(["%s"] * len(self._plant_filter))
                    if self._include_null_plant:
                        where_parts.append(f"(r.plant_cd IN ({placeholders}) OR r.plant_cd IS NULL)")
                    else:
                        where_parts.append(f"r.plant_cd IN ({placeholders})")
                    params.extend(self._plant_filter)

                sql = (
                    f"SELECT {select_clause} FROM {from_clause} "
                    f"WHERE {' AND '.join(where_parts)} ORDER BY r.created_at"
                )
                cur.execute(sql, params)
                rows = cur.fetchall()
        reports = [NcrReport.from_db_row(dict(r)) for r in rows]
        if self._plant_filter:
            null_tag = "+NULL" if self._include_null_plant else ""
            filter_desc = ",".join(self._plant_filter) + null_tag
            logger.info("PENDING(QC승인) 보고 %d건 조회 (DB, plant=%s)", len(reports), filter_desc)
        else:
            logger.info("PENDING(QC승인) 보고 %d건 조회 (DB, 전체 공장)", len(reports))
        return reports

    def get_report(self, report_id: int) -> NcrReport | None:
        from psycopg2.extras import RealDictCursor
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                select_clause, from_clause = self._get_query_parts(cur)
                sql = f"SELECT {select_clause} FROM {from_clause} WHERE r.id = %s"
                cur.execute(sql, (report_id,))
                row = cur.fetchone()
        if not row:
            return None
        return NcrReport.from_db_row(dict(row))

    # ------------------------------------------------------------------
    # 상태 업데이트 (단일 테이블, JOIN 없음)
    # ------------------------------------------------------------------

    def _simple_status_update(self, report_id: int, status: ReportStatus) -> None:
        """단순 상태 전이 (PROCESSING / REVIEW 용). qc_status/재시도 미건드림."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE non_conformity_reports SET sync_status = %s, updated_at = now() "
                    "WHERE id = %s",
                    (status.value, report_id),
                )
            conn.commit()

    def mark_processing(self, report_id: int) -> None:
        self._simple_status_update(report_id, ReportStatus.PROCESSING)
        logger.info("보고 #%d PROCESSING (DB)", report_id)

    def mark_completed(self, report_id: int) -> None:
        """ERP 입력 성공 — sync_status=COMPLETED + qc_status APPROVED→ERP_SYNCED.

        qc_status 를 ERP_SYNCED 로 함께 전이시켜 웹 ledger/manage 뱃지가
        "ERP 등록 완료" 로 표시되도록 한다. artifacts/api-server/routes/rpa.ts
        의 성공 경로와 동일한 전이.
        """
        # 캐시 비어있으면 (fetch_pending 이전에 호출) 1회 로드
        if not self._existing_cols:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    self._get_query_parts(cur)
        has_qc = "qc_status" in self._existing_cols
        has_retry_cols = "sync_last_error" in self._existing_cols

        set_parts = ["sync_status = %s"]
        params: list[Any] = [ReportStatus.COMPLETED.value]
        if has_qc:
            set_parts.append(
                "qc_status = CASE WHEN qc_status = 'APPROVED' THEN 'ERP_SYNCED' ELSE qc_status END"
            )
        if has_retry_cols:
            set_parts.append("sync_last_error = NULL")
            set_parts.append("sync_next_retry_at = NULL")
        set_parts.append("updated_at = now()")

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE non_conformity_reports SET {', '.join(set_parts)} WHERE id = %s",
                    (*params, report_id),
                )
            conn.commit()
        logger.info("보고 #%d COMPLETED (DB) + qc_status→ERP_SYNCED", report_id)

    def mark_failed(self, report_id: int, error: str) -> None:
        """ERP 입력 실패 — attempt_count++ + 백오프.

        - attempts < MAX_ATTEMPTS: sync_status=PENDING, sync_next_retry_at = now + backoff
          → fetch_pending 이 백오프 시간 지나면 자동으로 다시 집어감
        - attempts >= MAX_ATTEMPTS: sync_status=FAILED, 더 이상 재시도 안 함
        artifacts/api-server/routes/rpa.ts 의 실패 경로와 동일한 로직.
        """
        error_msg = (error or "")[:1000]
        logger.error("보고 #%d 입력 실패 (DB): %s", report_id, error_msg)

        with self._connect() as conn:
            with conn.cursor() as cur:
                # 현재 attempt_count 조회해서 다음 값 결정
                cur.execute(
                    "SELECT COALESCE(sync_attempt_count, 0) FROM non_conformity_reports WHERE id = %s",
                    (report_id,),
                )
                row = cur.fetchone()
                current_attempts = int(row[0]) if row else 0
                new_attempts = current_attempts + 1

                if new_attempts >= _MAX_ATTEMPTS:
                    # 영구 실패
                    cur.execute(
                        "UPDATE non_conformity_reports SET "
                        "sync_status = %s, "
                        "sync_attempt_count = %s, "
                        "sync_last_error = %s, "
                        "sync_next_retry_at = NULL, "
                        "updated_at = now() WHERE id = %s",
                        (ReportStatus.FAILED.value, new_attempts, error_msg, report_id),
                    )
                    logger.warning(
                        "보고 #%d 최대 재시도(%d) 도달 → FAILED 확정",
                        report_id, _MAX_ATTEMPTS,
                    )
                else:
                    # 재시도 예정 — PENDING 으로 되돌리되 next_retry 로 백오프
                    backoff_min = _backoff_minutes(new_attempts)
                    cur.execute(
                        "UPDATE non_conformity_reports SET "
                        "sync_status = %s, "
                        "sync_attempt_count = %s, "
                        "sync_last_error = %s, "
                        f"sync_next_retry_at = now() + interval '{backoff_min} minutes', "
                        "updated_at = now() WHERE id = %s",
                        (ReportStatus.PENDING.value, new_attempts, error_msg, report_id),
                    )
                    logger.info(
                        "보고 #%d 재시도 %d/%d 예약 (%d분 후)",
                        report_id, new_attempts, _MAX_ATTEMPTS, backoff_min,
                    )
            conn.commit()

    def mark_pending(self, report_id: int) -> None:
        """PROCESSING → PENDING 복원 + 재시도 상태 전부 클리어.

        사용자 중지(stop) 로 호출되므로 attempt_count/last_error/next_retry_at
        전부 초기화해 즉시 다시 처리 가능한 깨끗한 상태로 돌림.
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE non_conformity_reports SET sync_status = %s, "
                    "sync_attempt_count = 0, sync_last_error = NULL, "
                    "sync_next_retry_at = NULL, "
                    "updated_at = now() WHERE id = %s",
                    (ReportStatus.PENDING.value, report_id),
                )
            conn.commit()
        logger.info("보고 #%d PENDING 복원 (DB)", report_id)

    def mark_review(self, report_id: int) -> None:
        """UNIERP 저장 완료 → REVIEW. 사용자 확인 대기 상태.

        이 상태에 있는 보고는 fetch_pending 에서 제외되므로 UNIERP 이중
        입력이 자동 방지된다.
        """
        self._simple_status_update(report_id, ReportStatus.REVIEW)
        logger.info("보고 #%d REVIEW (DB)", report_id)

    def fetch_review(self) -> list[NcrReport]:
        """REVIEW 상태 보고 목록. 워커/서버 재시작 후 큐 복원용."""
        from psycopg2.extras import RealDictCursor
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                select_clause, from_clause = self._get_query_parts(cur)
                sql = (
                    f"SELECT {select_clause} FROM {from_clause} "
                    f"WHERE r.sync_status = %s ORDER BY r.updated_at"
                )
                cur.execute(sql, (ReportStatus.REVIEW.value,))
                rows = cur.fetchall()
        reports = [NcrReport.from_db_row(dict(r)) for r in rows]
        logger.info("REVIEW 보고 %d건 조회 (DB)", len(reports))
        return reports

    # ------------------------------------------------------------------
    # 헬스체크
    # ------------------------------------------------------------------

    def health(self) -> tuple[bool, str]:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return True, "DB 연결 OK (Neon)"
        except Exception as e:
            return False, f"DB 연결 실패: {e}"
