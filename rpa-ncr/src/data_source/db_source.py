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
)

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

    def fetch_pending(self) -> list[NcrReport]:
        from psycopg2.extras import RealDictCursor
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                select_clause, from_clause = self._get_query_parts(cur)
                sql = (
                    f"SELECT {select_clause} FROM {from_clause} "
                    f"WHERE r.sync_status = %s ORDER BY r.created_at"
                )
                cur.execute(sql, (ReportStatus.PENDING.value,))
                rows = cur.fetchall()
        reports = [NcrReport.from_db_row(dict(r)) for r in rows]
        logger.info("PENDING 보고 %d건 조회 (DB)", len(reports))
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

    def _update_status(self, report_id: int, status: ReportStatus, error: str | None = None) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                if status == ReportStatus.FAILED:
                    cur.execute(
                        "UPDATE non_conformity_reports SET sync_status = %s, "
                        "sync_last_error = %s, "
                        "sync_attempt_count = COALESCE(sync_attempt_count, 0) + 1, "
                        "updated_at = now() WHERE id = %s",
                        (status.value, (error or "")[:1000], report_id),
                    )
                else:
                    cur.execute(
                        "UPDATE non_conformity_reports SET sync_status = %s, updated_at = now() "
                        "WHERE id = %s",
                        (status.value, report_id),
                    )
            conn.commit()

    def mark_processing(self, report_id: int) -> None:
        self._update_status(report_id, ReportStatus.PROCESSING)
        logger.info("보고 #%d PROCESSING (DB)", report_id)

    def mark_completed(self, report_id: int) -> None:
        self._update_status(report_id, ReportStatus.COMPLETED)
        logger.info("보고 #%d COMPLETED (DB)", report_id)

    def mark_failed(self, report_id: int, error: str) -> None:
        logger.error("보고 #%d FAILED (DB): %s", report_id, error)
        self._update_status(report_id, ReportStatus.FAILED, error=error)

    def mark_pending(self, report_id: int) -> None:
        """PROCESSING → PENDING 복원 + 재시도 카운터/마지막 오류 클리어."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE non_conformity_reports SET sync_status = %s, "
                    "sync_attempt_count = 0, sync_last_error = NULL, "
                    "updated_at = now() WHERE id = %s",
                    (ReportStatus.PENDING.value, report_id),
                )
            conn.commit()
        logger.info("보고 #%d PENDING 복원 (DB)", report_id)

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
