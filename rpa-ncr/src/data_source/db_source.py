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

# snake_case → camelCase 별칭 SELECT (ApiSource와 키 일치)
_SELECT_COLUMNS = """
    id,
    report_date      AS "reportDate",
    item_code        AS "itemCode",
    model_name       AS "modelName",
    process_name     AS "processName",
    defect_type      AS "defectType",
    description,
    image_url        AS "imageUrl",
    sync_status      AS "syncStatus",
    registrant_name  AS "registrantName",
    ncr_type         AS "ncrType",
    factory,
    shipment_unit    AS "shipmentUnit",
    lost_man_hours   AS "lostManHours",
    defect_qty       AS "defectQty",
    occurrence_date  AS "occurrenceDate",
    issuing_team     AS "issuingTeam",
    plant_cd         AS "plantCd",
    process_cd       AS "processCd",
    flaw_type_cd     AS "flawTypeCd",
    dept_cd          AS "deptCd",
    ncr_gbn_cd       AS "ncrGbnCd",
    product_type     AS "productType"
"""

_TABLE = "non_conformity_reports"


def _resolve_database_url(cfg: dict[str, Any]) -> str:
    """DB URL을 settings → env → PRIVATE/app_db.json 순으로 해석한다."""
    url = (cfg.get("database_url") or "").strip()
    if url:
        return url
    env = os.getenv("DATABASE_URL")
    if env:
        return env
    path = get_private_dir() / "app_db.json"
    if path.is_file():
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("database_url", "")
    return ""


class DbSource(DataSource):
    def __init__(self, cfg: dict[str, Any]):
        self._url = _resolve_database_url(cfg)
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

    # ------------------------------------------------------------------
    # 조회
    # ------------------------------------------------------------------

    def fetch_pending(self) -> list[NcrReport]:
        from psycopg2.extras import RealDictCursor
        sql = (
            f"SELECT {_SELECT_COLUMNS} FROM {_TABLE} "
            f"WHERE sync_status = %s ORDER BY created_at"
        )
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, (ReportStatus.PENDING.value,))
                rows = cur.fetchall()
        reports = [NcrReport.from_db_row(dict(r)) for r in rows]
        logger.info("PENDING 보고 %d건 조회 (DB)", len(reports))
        return reports

    def get_report(self, report_id: int) -> NcrReport | None:
        from psycopg2.extras import RealDictCursor
        sql = f"SELECT {_SELECT_COLUMNS} FROM {_TABLE} WHERE id = %s"
        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, (report_id,))
                row = cur.fetchone()
        if not row:
            return None
        return NcrReport.from_db_row(dict(row))

    # ------------------------------------------------------------------
    # 상태 업데이트
    # ------------------------------------------------------------------

    def _update_status(self, report_id: int, status: ReportStatus, error: str | None = None) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                if status == ReportStatus.FAILED:
                    cur.execute(
                        f"UPDATE {_TABLE} SET sync_status = %s, "
                        f"sync_last_error = %s, "
                        f"sync_attempt_count = COALESCE(sync_attempt_count, 0) + 1, "
                        f"updated_at = now() WHERE id = %s",
                        (status.value, (error or "")[:1000], report_id),
                    )
                else:
                    cur.execute(
                        f"UPDATE {_TABLE} SET sync_status = %s, updated_at = now() "
                        f"WHERE id = %s",
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
