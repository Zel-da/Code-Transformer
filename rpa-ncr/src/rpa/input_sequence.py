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
    # § 3.2: 1920×1080 기준 박스 중앙 좌표 (윈도우 상대 + 비례 스케일링)
    ref_x: int | None = None
    ref_y: int | None = None
    # § 14: 폼 라벨 텍스트 — 좌표 클릭 실패 시 라벨로 동적 검색하는 폴백용
    form_label: str = ""
    # Tab 모드 전용: 이 스텝 진입 전 몇 번 Tab 을 눌러 이동할지 (기본 1)
    # 비활성/자동채움 필드가 사이에 있으면 2 이상으로 설정해 건너뛰기
    tabs_before: int = 1

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
