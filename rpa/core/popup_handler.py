"""
팝업·다이얼로그 감지 및 처리 모듈.
- ERP 내부 팝업: 자동 dismiss (Enterf 또는 OK 클릭)
- 외부 프로세스 팝업: FocusLostError 발생 → 즉시 중단
"""

import ctypes
import time
import logging
from typing import Optional

import keyboard as kb
from pywinauto.uia_element_info import UIAElementInfo
from pywinauto.controls.uia_controls import UIAWrapper

from core.exceptions import FocusLostError, PopupError

logger = logging.getLogger(__name__)

user32 = ctypes.windll.user32


class PopupHandler:
    def __init__(self, main_hwnd: int, main_pid: int):
        self._main_hwnd = main_hwnd
        self._main_pid = main_pid
        self._error_events: list[dict] = []

    # ------------------------------------------------------------------
    # 팝업 탐지
    # ------------------------------------------------------------------

    def find_popup(self) -> Optional[UIAWrapper]:
        """
        포그라운드 윈도우가 메인 ERP 창이 아니면 팝업으로 간주해 반환한다.
        Desktop.windows()에 안 나오는 owned child 창도 핸들 직접 래핑으로 처리.
        """
        fg = user32.GetForegroundWindow()
        if not fg or fg == self._main_hwnd:
            return None
        try:
            from comtypes.client import GetModule  # noqa: F401
            iuia = UIAElementInfo._iuia  # type: ignore[attr-defined]
            elem = iuia.ElementFromHandle(fg)
            wrapper = UIAWrapper(UIAElementInfo(elem))
            return wrapper
        except Exception as e:
            logger.debug("팝업 핸들 래핑 실패: %s", e)
            return None

    def wait_for_popup(self, timeout: float = 3.0) -> Optional[UIAWrapper]:
        """팝업이 나타날 때까지 폴링 대기."""
        end = time.time() + timeout
        while time.time() < end:
            p = self.find_popup()
            if p:
                return p
            time.sleep(0.1)
        return None

    def wait_for_popup_close(self, popup: UIAWrapper, timeout: float = 5.0) -> bool:
        """팝업이 닫힐 때까지 대기."""
        end = time.time() + timeout
        while time.time() < end:
            try:
                if not popup.exists():
                    return True
            except Exception:
                return True
            time.sleep(0.1)
        return False

    # ------------------------------------------------------------------
    # 자동 처리
    # ------------------------------------------------------------------

    def safe_dismiss(self, context: str = "", timeout: float = 0.3) -> bool:
        """
        팝업이 있으면 dismiss를 시도한다.
        - 같은 PID → ERP 내부 에러 다이얼로그 → Enter로 닫고 이벤트 누적
        - 다른 PID → 외부 창 → FocusLostError 발생
        Returns: 팝업이 있었으면 True
        """
        popup = self.wait_for_popup(timeout)
        if not popup:
            return False

        try:
            popup_pid = popup.process_id()
        except Exception:
            popup_pid = None

        if popup_pid is not None and popup_pid != self._main_pid:
            raise FocusLostError(
                f"외부 프로세스 창 감지 (pid={popup_pid}): {popup.window_text()}"
            )

        title = popup.window_text()
        logger.warning("[팝업 자동 닫기] context=%r title=%r", context, title)
        kb.send("enter")
        self._error_events.append({"context": context, "title": title, "time": time.time()})
        return True

    def dismiss_loop(self, context: str = "", max_dismiss: int = 3) -> int:
        """연속으로 최대 max_dismiss개 팝업을 닫는다. 닫은 수 반환."""
        count = 0
        while count < max_dismiss:
            if not self.safe_dismiss(context=context, timeout=0.3):
                break
            count += 1
        return count

    # ------------------------------------------------------------------
    # 입력 다이얼로그 처리 (검색 팝업)
    # ------------------------------------------------------------------

    def popup_search_and_select(self, search_text: str, timeout: float = 5.0) -> bool:
        """
        검색 텍스트 입력 후 결과 첫 항목 더블클릭 패턴.
        구체적인 결과 리스트 UIA 구조는 워크플로에서 오버라이드한다.
        """
        popup = self.wait_for_popup(timeout)
        if not popup:
            logger.error("검색 팝업이 열리지 않음 (timeout=%.1f)", timeout)
            return False

        import pyperclip
        pyperclip.copy(search_text)
        kb.send("ctrl+v")
        kb.send("enter")

        # 결과 로딩 대기 (워크플로에서 세분화 필요)
        time.sleep(0.5)

        # 첫 번째 항목 더블클릭 (UIA descendants 순서)
        try:
            items = popup.descendants(control_type="ListItem")
            if not items:
                items = popup.descendants(control_type="DataItem")
            if items:
                items[0].double_click_input()
                self.wait_for_popup_close(popup)
                return True
            logger.warning("검색 결과 항목을 찾지 못함")
            return False
        except Exception as e:
            logger.error("검색 결과 선택 실패: %s", e)
            return False

    # ------------------------------------------------------------------
    # 누적 에러 리포트
    # ------------------------------------------------------------------

    def report_errors(self) -> list[dict]:
        """자동 처리된 에러 이벤트 목록을 반환한다."""
        return list(self._error_events)

    def clear_errors(self) -> None:
        self._error_events.clear()
