"""웹 애플리케이션 세션 상태 관리 (OCR_EU에서 포팅, NCR용)."""
import asyncio
import json
import threading
from typing import Any

from fastapi import WebSocket

from src.data_source.report_model import NcrReport


class AppState:
    """서버 전체에서 공유하는 애플리케이션 상태."""

    def __init__(self, settings: dict[str, Any]):
        self.settings = settings

        # 데이터 조회 상태
        self.reports: list[NcrReport] = []
        self.fetching: bool = False
        self.fetch_error: str = ""

        # ERP 상태
        self.erp_running: bool = False
        self.erp_pause_event = threading.Event()  # set = 일시정지 중, clear = 진행
        self.erp_stop_event = threading.Event()
        self.erp_mode: str = "pywinauto"
        self.erp_connected: bool = False
        self.erp_queue: list[dict[str, Any]] = []
        self.erp_logs: list[str] = []
        # 검토 모드: input_report 끝난 뒤 사용자가 완료확인/재실행/처음부터 결정할 때까지 대기
        self.erp_review_index: int | None = None        # 검토 중인 큐 인덱스
        self.erp_review_report: Any = None              # 검토 중인 NcrReport
        self.erp_review_steps: list[dict[str, Any]] = []  # 현 보고의 17 스텝 미리보기
        self.erp_review_resolved = threading.Event()    # 사용자가 결정하면 set
        self.erp_review_action: str = ""                # "confirmed" | "stopped" | ""
        self.erp_connector: Any = None                  # 재실행/처음부터 핸들러가 접근

        # WebSocket 연결
        self._progress_clients: list[WebSocket] = []
        self._erp_clients: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def add_progress_client(self, ws: WebSocket) -> None:
        async with self._lock:
            self._progress_clients.append(ws)

    async def remove_progress_client(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self._progress_clients:
                self._progress_clients.remove(ws)

    async def add_erp_client(self, ws: WebSocket) -> None:
        async with self._lock:
            self._erp_clients.append(ws)

    async def remove_erp_client(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self._erp_clients:
                self._erp_clients.remove(ws)

    async def broadcast_progress(self, data: dict) -> None:
        """진행률 WebSocket 클라이언트들에게 메시지를 브로드캐스트한다."""
        message = json.dumps(data, ensure_ascii=False)
        async with self._lock:
            disconnected = []
            for ws in self._progress_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.append(ws)
            for ws in disconnected:
                self._progress_clients.remove(ws)

    async def broadcast_erp(self, data: dict) -> None:
        """ERP 로그 WebSocket 클라이언트들에게 메시지를 브로드캐스트한다."""
        message = json.dumps(data, ensure_ascii=False)
        async with self._lock:
            disconnected = []
            for ws in self._erp_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.append(ws)
            for ws in disconnected:
                self._erp_clients.remove(ws)

    def broadcast_progress_sync(self, loop: asyncio.AbstractEventLoop, data: dict) -> None:
        """동기 스레드에서 진행률을 브로드캐스트한다.

        loop가 이미 닫혔으면(테스트 종료/uvicorn 셧다운 경계) 조용히 무시한다.
        """
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast_progress(data), loop)
        except RuntimeError:
            pass

    def broadcast_erp_sync(self, loop: asyncio.AbstractEventLoop, data: dict) -> None:
        """동기 스레드에서 ERP 로그를 브로드캐스트한다 (loop 닫힘 안전)."""
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast_erp(data), loop)
        except RuntimeError:
            pass
