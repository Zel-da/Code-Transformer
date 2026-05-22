"""
시퀀스 실행 엔진.
InputStep 리스트를 받아 순서대로 실행하고,
stop/pause 이벤트와 포커스 감시를 처리한다.
"""

import time
import threading
import logging
from typing import Callable, Optional

from core.window_controller import WindowController
from core.popup_handler import PopupHandler
from core.exceptions import FocusLostError, StepTimeoutError
from steps.input_step import InputStep, InputMethod

logger = logging.getLogger(__name__)


def retry_on_failure(max_retries: int = 3, delay: float = 1.0):
    """UI 작업 함수에 재시도 로직을 추가하는 데코레이터."""
    def decorator(func: Callable) -> Callable:
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except FocusLostError:
                    raise  # 포커스 이탈은 즉시 전파
                except Exception as e:
                    if attempt == max_retries:
                        raise
                    logger.warning("재시도 %d/%d — %s: %s", attempt + 1, max_retries, func.__name__, e)
                    time.sleep(delay)
        return wrapper
    return decorator


class SequenceRunner:
    """
    InputStep 리스트를 순서대로 실행한다.
    - stop_event: set()되면 현재 스텝 완료 후 중단
    - pause 플래그: set 중이면 스텝 시작 전 폴링 대기
    """

    def __init__(
        self,
        controller: WindowController,
        popup_handler: PopupHandler,
        stop_event: Optional[threading.Event] = None,
        on_step_complete: Optional[Callable[[InputStep, int, int], None]] = None,
    ):
        self._ctrl = controller
        self._popup = popup_handler
        self._stop_event = stop_event or threading.Event()
        self._paused = False
        self._on_step_complete = on_step_complete  # (step, index, total) → None

    # ------------------------------------------------------------------
    # 실행 제어
    # ------------------------------------------------------------------

    def stop(self) -> None:
        self._stop_event.set()

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def _wait_if_paused(self) -> None:
        while self._paused and not self._stop_event.is_set():
            self._stop_event.wait(0.5)

    def _is_stopped(self) -> bool:
        return self._stop_event.is_set()

    # ------------------------------------------------------------------
    # 메인 실행
    # ------------------------------------------------------------------

    def run(self, steps: list[InputStep]) -> dict:
        """
        스텝 리스트를 실행하고 결과 요약을 반환한다.
        Returns:
            {"ok": bool, "completed": int, "total": int, "stopped_at": int | None, "error": str | None}
        """
        total = len(steps)
        completed = 0
        stopped_at = None
        error_msg = None

        for i, step in enumerate(steps):
            self._wait_if_paused()

            if self._is_stopped():
                stopped_at = i
                logger.info("시퀀스 중단 (stop_event) — step %d/%d", i, total)
                break

            logger.info("[%d/%d] %s", i + 1, total, step)

            try:
                self._execute_step(step)
                completed += 1
                if self._on_step_complete:
                    self._on_step_complete(step, i, total)
            except FocusLostError as e:
                error_msg = f"포커스 이탈: {e}"
                stopped_at = i
                logger.error(error_msg)
                break
            except Exception as e:
                if step.optional:
                    logger.warning("선택 스텝 실패 (무시): %s — %s", step, e)
                    completed += 1
                else:
                    error_msg = f"스텝 실패: {step} — {e}"
                    stopped_at = i
                    logger.error(error_msg)
                    break

        ok = stopped_at is None and error_msg is None
        return {
            "ok": ok,
            "completed": completed,
            "total": total,
            "stopped_at": stopped_at,
            "error": error_msg,
        }

    # ------------------------------------------------------------------
    # 개별 스텝 실행
    # ------------------------------------------------------------------

    def _execute_step(self, step: InputStep) -> None:
        method = step.method

        if method == InputMethod.SKIP:
            if step.tab_after:
                self._ctrl.press_tab(step.tab_after)

        elif method == InputMethod.TYPE:
            self._ctrl.paste_text(str(step.value))
            if step.tab_after:
                self._ctrl.press_tab(step.tab_after)

        elif method == InputMethod.SEND_KEYS:
            self._ctrl.send_keys(str(step.value))
            if step.tab_after:
                self._ctrl.press_tab(step.tab_after)

        elif method == InputMethod.CLICK_AT:
            x, y = step.value
            self._ctrl.click_relative(x, y)

        elif method == InputMethod.DOUBLE_CLICK_AT:
            x, y = step.value
            self._ctrl.double_click_relative(x, y)

        elif method == InputMethod.POPUP_SEARCH:
            self._popup.popup_search_and_select(str(step.value))
            if step.tab_after:
                self._ctrl.press_tab(step.tab_after)

        elif method == InputMethod.DISMISS_DIALOG:
            count = self._popup.dismiss_loop(context=step.label)
            if count:
                logger.info("팝업 %d개 자동 닫음 (context=%r)", count, step.label)

        elif method == InputMethod.WAIT:
            time.sleep(float(step.value))

        elif method == InputMethod.PRESS_ENTER:
            self._ctrl.press_enter()
            if step.tab_after:
                self._ctrl.press_tab(step.tab_after)

        elif method == InputMethod.PRESS_ESC:
            self._ctrl.press_esc()

        elif method == InputMethod.PRESS_TAB:
            self._ctrl.press_tab(max(step.tab_after, 1))

        elif method == InputMethod.PASTE_COLUMN:
            self._ctrl.paste_column(list(step.value))

        elif method == InputMethod.DROPDOWN_SELECT:
            # 드롭다운 처리: 워크플로에서 커스텀 구현 필요
            # meta["index"] = N 번째 항목 선택
            index = step.meta.get("index", 0)
            for _ in range(index):
                self._ctrl.send_keys("down")
            self._ctrl.press_enter()

        else:
            logger.warning("알 수 없는 InputMethod: %s", method)

        if step.delay_after > 0:
            time.sleep(step.delay_after)
