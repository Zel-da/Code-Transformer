"""
NCR API 서버와 통신하는 클라이언트.
- PENDING 보고서 목록 조회
- 처리 결과 콜백 (성공/실패)
"""

import logging
import os
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

API_BASE = os.getenv("NCR_API_BASE", "http://localhost:3000")
API_SECRET = os.getenv("NCR_API_SECRET", "")  # 서버 측 공유 시크릿 (추후 설정)


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if API_SECRET:
        h["X-RPA-Secret"] = API_SECRET
    return h


class NcrApiClient:
    def __init__(self, base_url: str = API_BASE):
        self._base = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update(_headers())

    # ------------------------------------------------------------------
    # 보고서 조회
    # ------------------------------------------------------------------

    def get_pending_reports(self) -> list[dict]:
        """
        동기화 대기(PENDING) 보고서 목록을 반환한다.

        서버 라우트: GET /api/reports/pending  (reports.ts)
        → PENDING 상태 보고서 배열을 그대로 반환한다.
        (이전 구현은 POST /api/rpa/trigger 를 호출했으나, 그 엔드포인트는
         서버 측에서 처리 결과를 랜덤 시뮬레이션하는 목업이라 RPA 클라이언트가
         실제 입력 대상을 받는 용도로는 맞지 않아 교체함.)
        """
        resp = self._session.get(f"{self._base}/api/reports/pending", timeout=30)
        resp.raise_for_status()
        reports = resp.json()
        logger.info("PENDING 보고서 %d건 조회", len(reports))
        return reports

    def get_report(self, report_id: int) -> Optional[dict]:
        """단일 보고서 상세를 조회한다. (GET /api/reports/:id)"""
        resp = self._session.get(f"{self._base}/api/reports/{report_id}", timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # 상태 업데이트
    # ------------------------------------------------------------------
    #
    # 서버 라우트: PATCH /api/reports/:id/sync-status  (reports.ts)
    # 허용 본문:  { "syncStatus": PENDING|PROCESSING|COMPLETED|FAILED,
    #              "resetRetry": bool(optional) }
    # ※ 이 엔드포인트는 syncLastError / erpRef 를 받지 않는다. 오류 메시지는
    #   로컬 로그(rpa.log)에만 남기고, 서버 측 재시도·백오프 집계는 서버가 담당.

    def _set_sync_status(
        self, report_id: int, status: str, reset_retry: bool = False
    ) -> dict:
        body: dict = {"syncStatus": status}
        if reset_retry:
            body["resetRetry"] = True
        resp = self._session.patch(
            f"{self._base}/api/reports/{report_id}/sync-status",
            json=body,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def mark_processing(self, report_id: int) -> dict:
        """ERP 입력 시작 — 서버에 PROCESSING 상태 반영."""
        result = self._set_sync_status(report_id, "PROCESSING")
        logger.info("보고서 #%d PROCESSING", report_id)
        return result

    def mark_completed(self, report_id: int) -> dict:
        """ERP 입력 성공 — 서버에 COMPLETED 상태 반영."""
        result = self._set_sync_status(report_id, "COMPLETED")
        logger.info("보고서 #%d COMPLETED", report_id)
        return result

    def mark_failed(self, report_id: int, error: str) -> dict:
        """ERP 입력 실패 — 서버에 FAILED 상태 반영 (오류 상세는 로컬 로그)."""
        logger.info("보고서 #%d FAILED: %s", report_id, error)
        return self._set_sync_status(report_id, "FAILED")
