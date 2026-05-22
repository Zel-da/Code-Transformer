"""
InputStep / InputMethod 정의.
각 필드 입력 방식을 열거형으로 표현하고,
실행 가능한 InputStep 데이터클래스로 감싼다.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class InputMethod(Enum):
    SKIP = "skip"                    # Tab만 눌러 지나감 (입력 없음)
    TYPE = "type"                    # 클립보드 붙여넣기 (한글/특수문자 안전)
    SEND_KEYS = "send_keys"          # keyboard.send_keys (ASCII / 단축키)
    CLICK_AT = "click_at"            # 기준 해상도 상대 좌표 클릭
    DOUBLE_CLICK_AT = "double_click_at"
    POPUP_SEARCH = "popup_search"    # 팝업 검색창에 값 입력 후 첫 결과 선택
    DROPDOWN_SELECT = "dropdown"     # 드롭다운에서 값 선택
    DISMISS_DIALOG = "dismiss"       # 에러 다이얼로그 닫기 (체크포인트)
    WAIT = "wait"                    # 지정 초 대기 (UI 로딩 여유)
    PRESS_ENTER = "press_enter"      # Enter 한 번
    PRESS_ESC = "press_esc"          # ESC (편집→포커스 모드 전환)
    PRESS_TAB = "press_tab"          # Tab (tab_after 개수)
    PASTE_COLUMN = "paste_column"    # 열 전체 클립보드 페이스트 (그리드)


@dataclass
class InputStep:
    method: InputMethod
    value: Any = ""                  # TYPE/SEND_KEYS/POPUP_SEARCH: 문자열, CLICK_AT: (x,y), PASTE_COLUMN: list[str]
    tab_after: int = 0               # 실행 후 Tab을 몇 번 눌러 다음 셀로 이동할지
    delay_after: float = 0.0         # 실행 후 추가 대기 (초)
    label: str = ""                  # 디버깅/로그용 필드명
    retry: int = 0                   # 실패 시 재시도 횟수 (0 = 재시도 없음)
    optional: bool = False           # True이면 실패해도 계속 진행
    meta: dict = field(default_factory=dict)  # 확장 데이터 (dropdown index 등)

    def __repr__(self) -> str:
        return f"InputStep({self.method.value}, label={self.label!r}, value={str(self.value)[:30]!r})"


# ------------------------------------------------------------------
# 자주 쓰는 스텝 생성 헬퍼
# ------------------------------------------------------------------

def skip(label: str = "", tab_after: int = 1) -> InputStep:
    return InputStep(method=InputMethod.SKIP, label=label, tab_after=tab_after)

def type_text(value: str, label: str = "", tab_after: int = 1, delay_after: float = 0.0) -> InputStep:
    return InputStep(method=InputMethod.TYPE, value=value, label=label, tab_after=tab_after, delay_after=delay_after)

def click_at(ref_x: int, ref_y: int, label: str = "") -> InputStep:
    return InputStep(method=InputMethod.CLICK_AT, value=(ref_x, ref_y), label=label)

def double_click_at(ref_x: int, ref_y: int, label: str = "") -> InputStep:
    return InputStep(method=InputMethod.DOUBLE_CLICK_AT, value=(ref_x, ref_y), label=label)

def popup_search(value: str, label: str = "", tab_after: int = 0) -> InputStep:
    return InputStep(method=InputMethod.POPUP_SEARCH, value=value, label=label, tab_after=tab_after)

def press_enter(label: str = "", tab_after: int = 0) -> InputStep:
    return InputStep(method=InputMethod.PRESS_ENTER, label=label, tab_after=tab_after)

def press_esc(label: str = "") -> InputStep:
    return InputStep(method=InputMethod.PRESS_ESC, label=label)

def wait_step(seconds: float, label: str = "대기") -> InputStep:
    return InputStep(method=InputMethod.WAIT, value=seconds, label=label)

def dismiss_dialog(label: str = "에러 체크") -> InputStep:
    return InputStep(method=InputMethod.DISMISS_DIALOG, label=label)

def paste_column(values: list[str], label: str = "") -> InputStep:
    return InputStep(method=InputMethod.PASTE_COLUMN, value=values, label=label)
