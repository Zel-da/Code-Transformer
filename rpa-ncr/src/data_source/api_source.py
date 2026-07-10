"""리플릿 서버 REST API 데이터 소스.

Code-Transformer/rpa/api_client.py 의 검증된 요청 형태를 그대로 사용한다.
  - GET  /api/reports/pending           → PENDING 보고 배열(bare array)
  - GET  /api/reports/:id               → 단건 (404면 없음)
  - PATCH /api/reports/:id/sync-status  → {"syncStatus": ..., "resetRetry"?: bool}
PATCH 엔드포인트는 오류 메시지 필드를 받지 않으므로 실패 사유는 로컬 로그에만 남긴다.
"""
import os
from typing import Any

import requests

from src.data_source.base import DataSource, ReportStatus
from src.data_source.report_model import NcrReport
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ApiSource(DataSource):
    def __init__(self, cfg: dict[str, Any]):
        base = cfg.get("base_url") or os.getenv("NCR_API_BASE", "http://localhost:3000")
        self._base = base.rstrip("/")
        self._timeout = cfg.get("timeout_seconds", 30)
        self._reset_retry = bool(cfg.get("reset_retry_on_processing", False))
        secret = cfg.get("secret") or os.getenv("NCR_API_SECRET", "")

        self._session = requests.Session()
        headers = {"Content-Type": "application/json"}
        if secret:
            headers["X-RPA-Secret"] = secret
        self._session.headers.update(headers)

    # ------------------------------------------------------------------
    # 조회
    # ------------------------------------------------------------------

    def fetch_pending(self) -> list[NcrReport]:
        resp = self._session.get(f"{self._base}/api/reports/pending", timeout=self._timeout)
        resp.raise_for_status()
        rows = resp.json()  # bare array
        reports = [NcrReport.from_api_dict(r) for r in rows]
        for r in reports:
            self._enrich(r)
        logger.info("PENDING 보고 %d건 조회 (API)", len(reports))
        return reports

    def get_report(self, report_id: int) -> NcrReport | None:
        resp = self._session.get(f"{self._base}/api/reports/{report_id}", timeout=self._timeout)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        report = NcrReport.from_api_dict(resp.json())
        self._enrich(report)
        return report

    def _enrich(self, report: NcrReport) -> None:
        """item_codes 마스터에서 itemGroup(category)/itemName을 보강한다.

        최신 서버 응답엔 itemGroup이 이미 포함되지만, 빈 경우(또는 구버전 서버)에
        대비해 /api/items?search=로 보강한다. DbSource는 SQL COALESCE로 보강한다.
        """
        code = report.get_str("itemCode")
        if not code:
            return
        # 이미 itemGroup이 채워져 있고 itemName도 있으면 추가 호출 생략
        if report.fields.get("itemGroup") and report.fields.get("itemName"):
            return
        try:
            resp = self._session.get(
                f"{self._base}/api/items",
                params={"search": code, "limit": 5},
                timeout=self._timeout,
            )
            if not resp.ok:
                return
            items = resp.json() or []
            picked = next((it for it in items if it.get("code") == code), None) or (items[0] if items else None)
            if picked:
                # 이미 있는 값은 덮어쓰지 않음 (서버가 정한 값 우선)
                if not report.fields.get("itemGroup"):
                    report.fields["itemGroup"] = picked.get("category")
                if not report.fields.get("itemName"):
                    report.fields["itemName"] = picked.get("name")
        except Exception as e:
            logger.warning("itemGroup 보강 실패 (#%s): %s", report.id, e)

    # ------------------------------------------------------------------
    # 상태 업데이트
    # ------------------------------------------------------------------

    def _set_status(self, report_id: int, status: ReportStatus, reset_retry: bool = False) -> None:
        body: dict[str, Any] = {"syncStatus": status.value}
        if reset_retry:
            body["resetRetry"] = True
        resp = self._session.patch(
            f"{self._base}/api/reports/{report_id}/sync-status",
            json=body,
            timeout=self._timeout,
        )
        resp.raise_for_status()

    def mark_processing(self, report_id: int) -> None:
        self._set_status(report_id, ReportStatus.PROCESSING, reset_retry=self._reset_retry)
        logger.info("보고 #%d PROCESSING (API)", report_id)

    def mark_completed(self, report_id: int) -> None:
        self._set_status(report_id, ReportStatus.COMPLETED)
        logger.info("보고 #%d COMPLETED (API)", report_id)

    def mark_failed(self, report_id: int, error: str) -> None:
        # 엔드포인트가 오류 필드를 받지 않으므로 로컬 로그에만 상세를 남긴다.
        logger.error("보고 #%d FAILED (API): %s", report_id, error)
        self._set_status(report_id, ReportStatus.FAILED)

    def mark_pending(self, report_id: int) -> None:
        """PROCESSING 상태를 PENDING으로 되돌린다 (사용자 중지 후 재시도 가능하게)."""
        self._set_status(report_id, ReportStatus.PENDING, reset_retry=True)
        logger.info("보고 #%d PENDING 복원 (API)", report_id)

    def mark_review(self, report_id: int) -> None:
        """UNIERP 저장 완료 → REVIEW (사용자 검토 대기). 재시작 대비 DB 승격."""
        self._set_status(report_id, ReportStatus.REVIEW)
        logger.info("보고 #%d REVIEW (API)", report_id)

    def fetch_review(self) -> list[NcrReport]:
        """REVIEW 상태 보고 목록 (서버가 filter 지원 시). 폴백: 전체 조회 후 필터."""
        try:
            resp = self._session.get(
                f"{self._base}/api/reports",
                params={"syncStatus": "REVIEW", "pageSize": 500},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            body = resp.json()
            # /api/reports 는 페이지네이션 응답: {reports, total, ...}
            rows = body.get("reports") if isinstance(body, dict) else body
            if not isinstance(rows, list):
                rows = []
            reports = [NcrReport.from_api_dict(r) for r in rows]
            for r in reports:
                self._enrich(r)
            logger.info("REVIEW 보고 %d건 조회 (API)", len(reports))
            return reports
        except Exception as e:
            logger.warning("fetch_review 실패, 빈 목록으로 폴백: %s", e)
            return []

    # ------------------------------------------------------------------
    # 헬스체크
    # ------------------------------------------------------------------

    def health(self) -> tuple[bool, str]:
        try:
            resp = self._session.get(f"{self._base}/api/reports/pending", timeout=self._timeout)
            resp.raise_for_status()
            return True, f"API 연결 OK ({self._base})"
        except Exception as e:
            return False, f"API 연결 실패 ({self._base}): {e}"
