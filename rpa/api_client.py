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
        """동기화 대기 중인 보고서 목록을 반환한다."""
        resp = self._session.post(f"{self._base}/api/rpa/trigger", timeout=30)
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "RPA trigger: processed=%d completed=%d failed=%d skipped=%d",
            data.get("processed", 0),
            data.get("completed", 0),
            data.get("failed", 0),
            data.get("skipped", 0),
        )
        return data.get("reports", [])

    def get_report(self, report_id: int) -> Optional[dict]:
        """단일 보고서 상세를 조회한다."""
        resp = self._session.get(f"{self._base}/api/reports/{report_id}", timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # 상태 업데이트
    # ------------------------------------------------------------------

    def mark_completed(self, report_id: int, erp_ref: Optional[str] = None) -> dict:
        """ERP 입력 성공 — 서버에 COMPLETED 상태 반영."""
        body: dict = {"syncStatus": "COMPLETED"}
        if erp_ref:
            body["erpRef"] = erp_ref
        resp = self._session.patch(
            f"{self._base}/api/reports/{report_id}",
            json=body,
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("보고서 #%d COMPLETED", report_id)
        return resp.json()

    def mark_failed(self, report_id: int, error: str) -> dict:
        """ERP 입력 실패 — 서버에 FAILED 상태 및 오류 메시지 반영."""
        resp = self._session.patch(
            f"{self._base}/api/reports/{report_id}",
            json={"syncStatus": "FAILED", "syncLastError": error},
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("보고서 #%d FAILED: %s", report_id, error)
        return resp.json()
