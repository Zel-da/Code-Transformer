"""
저수준 Windows GUI 제어 모듈.
- ERP 창 연결 및 핸들 캐싱
- 창 상대 비례 좌표 변환
- 키 입력 (클립보드 / type_keys / send_keys)
- 포커스 감시
"""

import ctypes
import os
import subprocess
import time
import logging
from typing import Optional

import psutil
import pyperclip
import pywinauto.mouse as pymouse
import keyboard as kb
from pywinauto import Application
from pywinauto.application import WindowSpecification

from core.exceptions import FocusLostError, WindowNotFoundError

logger = logging.getLogger(__name__)

# DPI 인식 설정 (process 시작 시 1회)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

user32 = ctypes.windll.user32


class WindowController:
    """ERP 창 연결 및 입력 제어."""

    def __init__(self, window_title_pattern: str, ref_w: int = 1920, ref_h: int = 1080):
        """
        Args:
            window_title_pattern: 연결할 창 제목 정규식 (예: ".*UNIERP.*")
            ref_w: 기준 해상도 너비 (좌표 캘리브레이션 기준)
            ref_h: 기준 해상도 높이
        """
        self._title_pattern = window_title_pattern
        self._ref_w = ref_w
        self._ref_h = ref_h

        self._app: Optional[Application] = None
        self._main: Optional[WindowSpecification] = None
        self._main_hwnd: Optional[int] = None

        self._acceptable_hwnds: set[int] = set()

    # ------------------------------------------------------------------
    # 연결
    # ------------------------------------------------------------------

    def connect(self, timeout: float = 10.0) -> None:
        """ERP 창에 연결하고 핸들을 캐싱한다."""
        logger.info("ERP 창 연결 시도: %s", self._title_pattern)
        self._app = Application(backend="uia").connect(
            title_re=self._title_pattern, timeout=timeout
        )
        self._main = self._app.window(title_re=self._title_pattern)
        self._main.wait("ready", timeout=timeout)
        self._main_hwnd = self._main.handle
        self._acceptable_hwnds = {self._main_hwnd}
        logger.info("ERP 창 연결 완료 (hwnd=%s)", self._main_hwnd)

    def is_connected(self) -> bool:
        """창이 아직 살아 있는지 가볍게 체크한다."""
        try:
            return self._main is not None and self._main.exists()
        except Exception:
            return False

    def ensure_maximized(self) -> None:
        """창이 최대화 상태인지 보장한다 (좌표 캘리브레이션 전제)."""
        if self._main:
            self._main.maximize()
            time.sleep(0.3)

    def register_popup_hwnd(self, hwnd: int) -> None:
        """허용 팝업 핸들을 추가 등록한다."""
        self._acceptable_hwnds.add(hwnd)

    # ------------------------------------------------------------------
    # 포커스 감시
    # ------------------------------------------------------------------

    def check_focus(self) -> None:
        """현재 포그라운드가 허용 창이 아니면 FocusLostError를 발생시킨다."""
        fg = user32.GetForegroundWindow()
        if fg and fg not in self._acceptable_hwnds:
            raise FocusLostError(
                f"포커스 이탈 감지 — fg hwnd={fg}, 허용={self._acceptable_hwnds}"
            )

    # ------------------------------------------------------------------
    # 좌표 변환
    # ------------------------------------------------------------------

    def abs_coords(self, ref_x: int, ref_y: int) -> tuple[int, int]:
        """기준 해상도의 상대 좌표를 현재 창 크기에 비례 변환해 절대 좌표로 반환한다."""
        if not self._main:
            raise WindowNotFoundError("창이 연결되지 않음")
        rect = self._main.rectangle()
        win_w = rect.right - rect.left
        win_h = rect.bottom - rect.top
        abs_x = rect.left + int(win_w * ref_x / self._ref_w)
        abs_y = rect.top + int(win_h * ref_y / self._ref_h)
        logger.debug("좌표 변환 ref=(%d,%d) → abs=(%d,%d)", ref_x, ref_y, abs_x, abs_y)
        return abs_x, abs_y

    def click_relative(self, ref_x: int, ref_y: int) -> None:
        """기준 해상도 기준 상대 좌표로 클릭한다."""
        self.check_focus()
        x, y = self.abs_coords(ref_x, ref_y)
        pymouse.click(coords=(x, y))
        logger.debug("클릭 (%d, %d)", x, y)

    def double_click_relative(self, ref_x: int, ref_y: int) -> None:
        """기준 해상도 기준 상대 좌표로 더블클릭한다."""
        self.check_focus()
        x, y = self.abs_coords(ref_x, ref_y)
        pymouse.double_click(coords=(x, y))
        logger.debug("더블클릭 (%d, %d)", x, y)

    # ------------------------------------------------------------------
    # 키 입력
    # ------------------------------------------------------------------

    def send_keys(self, keys: str, pause: float = 0.0) -> None:
        """글로벌 send_keys (현재 포커스 창에 전달). 포커스 체크 포함."""
        self.check_focus()
        kb.send(keys)

    def type_keys(self, keys: str, set_foreground: bool = True) -> None:
        """특정 창을 대상으로 type_keys (포커스 강제 가능)."""
        if not self._main:
            raise WindowNotFoundError("창이 연결되지 않음")
        self.check_focus()
        self._main.type_keys(keys, set_foreground=set_foreground)

    def paste_text(self, text: str) -> None:
        """
        클립보드 경유 텍스트 붙여넣기.
        한글, 괄호, 특수문자 등 send_keys 이스케이프 문제를 피하는 안전한 방법.
        """
        self.check_focus()
        pyperclip.copy(text)
        kb.send("ctrl+v")
        logger.debug("클립보드 붙여넣기: %r", text[:40])

    def paste_column(self, values: list[str]) -> None:
        """
        열 전체를 한 번에 붙여넣기 (엑셀형 그리드용).
        줄바꿈으로 이어 붙여 Ctrl+V 한 번에 N행 입력.
        """
        self.check_focus()
        pyperclip.copy("\n".join(values))
        kb.send("ctrl+v")
        time.sleep(0.2)
        logger.debug("컬럼 페이스트: %d행", len(values))

    def press_tab(self, count: int = 1) -> None:
        """Tab을 count번 연속 입력한다 (pause=0 단일 문자열)."""
        self.check_focus()
        kb.send("\t" * count)

    def press_enter(self) -> None:
        self.check_focus()
        kb.send("enter")

    def press_esc(self) -> None:
        self.check_focus()
        kb.send("esc")

    # ------------------------------------------------------------------
    # 유틸리티
    # ------------------------------------------------------------------

    def wait_until(self, condition, timeout: float = 5.0, interval: float = 0.1):
        """조건이 truthy가 될 때까지 폴링 대기. 타임아웃 시 None 반환."""
        end = time.time() + timeout
        while time.time() < end:
            result = condition()
            if result:
                return result
            time.sleep(interval)
        return None

    @property
    def main(self) -> Optional[WindowSpecification]:
        return self._main

    @property
    def main_hwnd(self) -> Optional[int]:
        return self._main_hwnd
