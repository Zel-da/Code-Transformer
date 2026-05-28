"""입력 시퀀스 정의 모듈."""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class InputMethod(Enum):
    """입력 방식."""
    TYPE_TEXT = "type_text"
    SELECT_ITEM = "select_item"
    CLICK = "click"
    KEY_PRESS = "key_press"
    WAIT = "wait"
    SKIP = "skip"
    CLICK_RIGHT_BUTTON = "click_right_button"
    POPUP_SEARCH = "popup_search"
    DOUBLE_CLICK_FIRST_POPUP = "double_click_first_popup"
    DROPDOWN_SELECT = "dropdown_select"
    POPUP_SEARCH_ENTER = "popup_search_enter"
    DISMISS_DIALOG = "dismiss_dialog"


@dataclass
class InputStep:
    """단일 입력 단계."""
    field_name: str
    value: str
    method: InputMethod = InputMethod.TYPE_TEXT
    control_type: str = "Edit"
    auto_id: str = ""
    coordinates: tuple[int, int] | None = None
    tab_order: int = 0
    delay_after: float = 0.3
    clear_before: bool = True
    erp_field_name: str = ""
    tab_after: bool = True

    def __str__(self) -> str:
        return f"InputStep({self.field_name}={self.value}, method={self.method.value})"


@dataclass
class InputSequence:
    """입력 시퀀스 (여러 InputStep의 순서)."""
    steps: list[InputStep] = field(default_factory=list)
    pre_actions: list[InputStep] = field(default_factory=list)
    post_actions: list[InputStep] = field(default_factory=list)

    def add_step(self, step: InputStep) -> None:
        self.steps.append(step)

    def add_pre_action(self, step: InputStep) -> None:
        self.pre_actions.append(step)

    def add_post_action(self, step: InputStep) -> None:
        self.post_actions.append(step)

    def get_ordered_steps(self) -> list[InputStep]:
        """tab_order로 정렬된 전체 시퀀스를 반환한다."""
        sorted_steps = sorted(self.steps, key=lambda s: s.tab_order)
        return self.pre_actions + sorted_steps + self.post_actions

    @property
    def total_steps(self) -> int:
        return len(self.pre_actions) + len(self.steps) + len(self.post_actions)
