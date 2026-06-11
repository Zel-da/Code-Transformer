"""데이터 소스 추상화.

부적합 보고를 받아오고 동기화 상태를 보고하는 공통 인터페이스.
settings["source"] 값("api" | "db")에 따라 구현을 선택한다.
두 구현 모두 동일한 NcrReport를 반환하므로 상위 레이어는 소스에 무관하다.
"""
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from src.data_source.report_model import NcrReport


class ReportStatus(str, Enum):
    """서버 동기화 상태 (artifacts/api-server reports.ts enum과 일치)."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class DataSource(ABC):
    """부적합 보고 데이터 소스 인터페이스."""

    @abstractmethod
    def fetch_pending(self) -> list[NcrReport]:
        """동기화 대기(PENDING) 보고 목록을 반환한다."""

    @abstractmethod
    def get_report(self, report_id: int) -> NcrReport | None:
        """단일 보고를 조회한다. 없으면 None."""

    @abstractmethod
    def mark_processing(self, report_id: int) -> None:
        """ERP 입력 시작 — PROCESSING 으로 표시."""

    @abstractmethod
    def mark_completed(self, report_id: int) -> None:
        """ERP 입력 성공 — COMPLETED 로 표시."""

    @abstractmethod
    def mark_failed(self, report_id: int, error: str) -> None:
        """ERP 입력 실패 — FAILED 로 표시 (오류 상세는 로컬 로그/가능 시 DB)."""

    @abstractmethod
    def mark_pending(self, report_id: int) -> None:
        """사용자 중지로 입력이 도중에 멈춤 — 다시 처리할 수 있게 PENDING 으로 되돌림."""

    @abstractmethod
    def health(self) -> tuple[bool, str]:
        """소스 도달 가능성 점검. (ok, message) 반환."""

    @property
    def name(self) -> str:
        return self.__class__.__name__


def get_source(settings: dict[str, Any]) -> DataSource:
    """settings["source"] 에 맞는 DataSource 구현을 생성한다."""
    src = (settings.get("source") or "api").lower()
    if src == "db":
        from src.data_source.db_source import DbSource
        return DbSource(settings.get("db", {}))
    if src == "api":
        from src.data_source.api_source import ApiSource
        return ApiSource(settings.get("api", {}))
    raise ValueError(f"알 수 없는 source: {src!r} (api 또는 db)")
