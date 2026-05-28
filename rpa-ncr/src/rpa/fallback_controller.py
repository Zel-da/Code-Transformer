"""pyautogui 기반 스크린 좌표 제어 모듈 (폴백)."""
import time
from typing import Any

from src.rpa.input_sequence import InputMethod, InputStep
from src.utils.logger import get_logger

logger = get_logger(__name__)


class FallbackController:
    """pyautogui를 사용한 스크린 좌표 기반 제어기.

    pywinauto로 컨트롤을 찾을 수 없는 경우 폴백으로 사용.
    """

    def __init__(self, input_delay: float = 0.3):
        self._input_delay = input_delay
        self._connected = False

        try:
            import pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = input_delay
            self._pyautogui = pyautogui
        except ImportError:
            self._pyautogui = None
            logger.error("pyautogui를 불러올 수 없습니다.")

    def connect(self) -> bool:
        """연결 상태를 확인한다 (pyautogui는 항상 사용 가능)."""
        if self._pyautogui is None:
            return False
        self._connected = True
        logger.info("pyautogui 폴백 컨트롤러 준비됨")
        return True

    def is_connected(self) -> bool:
        return self._connected and self._pyautogui is not None

    def execute_step(self, step: InputStep) -> None:
        """입력 단계를 실행한다."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui를 사용할 수 없습니다.")

        logger.debug(f"폴백 입력 실행: {step}")

        if step.method == InputMethod.TYPE_TEXT:
            self._type_text(step)
        elif step.method == InputMethod.SELECT_ITEM:
            self._type_text(step)  # 선택도 텍스트 입력으로 처리
        elif step.method == InputMethod.CLICK:
            self._click(step)
        elif step.method == InputMethod.KEY_PRESS:
            self._key_press(step)
        elif step.method == InputMethod.WAIT:
            time.sleep(float(step.value) if step.value else 1.0)

        time.sleep(step.delay_after)

    def _type_text(self, step: InputStep) -> None:
        """좌표 클릭 후 텍스트를 입력한다."""
        if step.coordinates:
            x, y = step.coordinates
            self._pyautogui.click(x, y)
            time.sleep(0.1)

        if step.clear_before:
            self._pyautogui.hotkey("ctrl", "a")
            time.sleep(0.05)

        # 한글/특수문자 지원을 위해 pyperclip 사용
        try:
            import pyperclip
            pyperclip.copy(step.value)
            self._pyautogui.hotkey("ctrl", "v")
        except ImportError:
            self._pyautogui.typewrite(step.value, interval=0.02)

    def _click(self, step: InputStep) -> None:
        """좌표를 클릭한다."""
        if step.coordinates:
            x, y = step.coordinates
            self._pyautogui.click(x, y)
        else:
            logger.warning(f"클릭 좌표 없음: {step.field_name}")

    def _key_press(self, step: InputStep) -> None:
        """키를 입력한다."""
        keys = step.value.split("+")
        if len(keys) > 1:
            self._pyautogui.hotkey(*keys)
        else:
            self._pyautogui.press(step.value)

    def locate_on_screen(self, image_path: str) -> tuple[int, int] | None:
        """이미지를 화면에서 찾아 좌표를 반환한다.

        Args:
            image_path: 찾을 이미지 경로

        Returns:
            (x, y) 좌표 또는 None
        """
        if not self._pyautogui:
            return None
        try:
            location = self._pyautogui.locateOnScreen(image_path, confidence=0.8)
            if location:
                center = self._pyautogui.center(location)
                return (center.x, center.y)
        except Exception as e:
            logger.warning(f"이미지 검색 실패: {image_path} - {e}")
        return None
