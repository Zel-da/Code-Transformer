"""
부적합 보고 ERP 입력 워크플로 (골격).

§14 캘리브레이션 완료 후 아래 TODO 항목을 채워 넣는다:
  - ERP 창 제목 패턴
  - 메뉴 진입 좌표 / 단축키
  - 헤더 필드 시퀀스 (InputStep 리스트)
  - 그리드 입력 시퀀스
  - 저장/확인 시퀀스
"""

import logging
import threading
import time
from typing import Optional

from core.window_controller import WindowController
from core.popup_handler import PopupHandler
from core.exceptions import FocusLostError, WindowNotFoundError
from steps.input_step import (
    InputStep,
    click_at, double_click_at,
    type_text, skip, press_enter, press_esc,
    wait_step, dismiss_dialog,
)
from steps.sequence_builder import SequenceRunner

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# ERP 환경 설정 (캘리브레이션 후 채울 것)
# ------------------------------------------------------------------

ERP_WINDOW_TITLE = ".*TODO_ERP_TITLE.*"   # TODO: 실제 창 제목 패턴
REF_W = 1920                               # 기준 해상도 너비
REF_H = 1080                               # 기준 해상도 높이

# 메뉴 진입 좌표 (기준 해상도 기준, 캘리브레이션 후 채울 것)
MENU_COORDS = {
    "open_form": (0, 0),       # TODO: 부적합 보고 폼 열기 버튼/메뉴 좌표
    "new_record": (0, 0),      # TODO: 새 행 추가 버튼 좌표
    "save_btn": (0, 0),        # TODO: 저장 버튼 좌표
}


# ------------------------------------------------------------------
# 워크플로
# ------------------------------------------------------------------

class NcrWorkflow:
    """
    단일 부적합 보고서를 ERP에 입력하는 워크플로.

    사용 예:
        wf = NcrWorkflow()
        wf.connect()
        result = wf.run_report(report_dict)
        wf.disconnect()
    """

    def __init__(self, stop_event: Optional[threading.Event] = None):
        self._ctrl = WindowController(ERP_WINDOW_TITLE, REF_W, REF_H)
        self._popup: Optional[PopupHandler] = None
        self._runner: Optional[SequenceRunner] = None
        self._stop_event = stop_event or threading.Event()
        self._menu_finder_pos: Optional[tuple[int, int]] = None  # 메뉴 포커스 하이브리드 캐시

    # ------------------------------------------------------------------
    # 연결 / 해제
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """ERP 창에 직접 연결한다 (이미 로그인된 상태 가정)."""
        self._ctrl.connect(timeout=15)
        self._ctrl.ensure_maximized()
        self._init_handlers()
        logger.info("NcrWorkflow: ERP 연결 완료")

    def connect_with_controller(self, ctrl: WindowController) -> None:
        """
        LoginWorkflow가 반환한 이미 연결된 WindowController를 주입한다.
        별도 connect() 호출 불필요.
        """
        self._ctrl = ctrl
        self._init_handlers()
        logger.info("NcrWorkflow: 기존 컨트롤러 주입 완료")

    def _init_handlers(self) -> None:
        pid = None
        try:
            pid = self._ctrl.main.process_id()  # type: ignore[union-attr]
        except Exception:
            pass

        self._popup = PopupHandler(
            main_hwnd=self._ctrl.main_hwnd,
            main_pid=pid or 0,
        )
        self._runner = SequenceRunner(
            controller=self._ctrl,
            popup_handler=self._popup,
            stop_event=self._stop_event,
            on_step_complete=self._on_step_complete,
        )

    def disconnect(self) -> None:
        logger.info("NcrWorkflow: 세션 종료")

    # ------------------------------------------------------------------
    # 보고서 입력 (메인 진입점)
    # ------------------------------------------------------------------

    def run_report(self, report: dict) -> dict:
        """
        단일 보고서를 ERP에 입력한다.
        Returns: {"ok": bool, "error": str | None}
        """
        report_id = report.get("id", "?")
        logger.info("===== 보고서 #%s 입력 시작 =====", report_id)

        try:
            self._navigate_to_form()
            self._input_header(report)
            self._input_grid(report)
            self._save()

            errors = self._popup.report_errors() if self._popup else []
            if errors:
                logger.warning("처리 중 자동 닫은 팝업 %d건: %s", len(errors), errors)
            if self._popup:
                self._popup.clear_errors()

            logger.info("===== 보고서 #%s 입력 완료 =====", report_id)
            return {"ok": True, "error": None}

        except FocusLostError as e:
            msg = f"포커스 이탈로 중단: {e}"
            logger.error(msg)
            return {"ok": False, "error": msg}
        except Exception as e:
            msg = f"워크플로 오류: {e}"
            logger.exception(msg)
            return {"ok": False, "error": msg}

    # ------------------------------------------------------------------
    # 세부 단계 — 폼 구조 확인 후 채울 것
    # ------------------------------------------------------------------

    def _navigate_to_form(self) -> None:
        """
        ERP 메뉴에서 부적합 보고 폼을 연다.
        TODO: 실제 단축키 또는 좌표로 교체.
        §7.2 하이브리드 패턴 적용 (두 번째 호출부터 좌표 캐시 사용).
        """
        logger.info("[네비게이션] 폼 열기")

        # 예시: F3 단축키로 메뉴 진입
        self._ctrl.type_keys("{F3}", set_foreground=True)
        time.sleep(0.6)

        if self._menu_finder_pos:
            import pywinauto.mouse as pymouse
            pymouse.click(coords=self._menu_finder_pos)

        popup = self._popup.wait_for_popup(timeout=3) if self._popup else None
        if popup:
            rect = popup.rectangle()
            self._menu_finder_pos = (
                (rect.left + rect.right) // 2,
                rect.top + 40,
            )
            # TODO: 폼 내 검색 or 메뉴 항목 클릭
            self._popup.safe_dismiss(context="메뉴 팝업")  # type: ignore[union-attr]

        # 폼 로딩 대기
        time.sleep(1.0)

        # TODO: 새 행 추가 버튼 클릭
        # self._ctrl.click_relative(*MENU_COORDS["new_record"])
        # time.sleep(0.5)

    def _input_header(self, report: dict) -> None:
        """
        폼 헤더 필드 입력 시퀀스.
        TODO: 폼 구조 확인 후 실제 필드 순서로 채울 것.
        각 필드는 report dict의 키와 매핑.
        """
        logger.info("[헤더 입력] 보고서 #%s", report.get("id"))

        # ----- 예시 시퀀스 (채울 것) -----
        # 주의: report 키는 API 응답(GET /api/reports/:id) 및 config/field_mapping.json과
        #       일치한다. (occurrenceDate/description 등 — defectDesc/occurredAt/reportNo 아님)
        steps: list[InputStep] = [
            dismiss_dialog("헤더 시작 전"),

            # TODO: 아래 주석을 실제 폼 순서/필드로 교체
            # type_text(str(report.get("id", "")),                  label="보고서번호",  tab_after=1),
            # type_text(self._fmt_date(report.get("occurrenceDate")), label="발생일",     tab_after=1),
            # type_text(report.get("deptCd", "") or "",             label="발행팀",      tab_after=1),
            # type_text(report.get("processName", "") or "",        label="공정명",      tab_after=1),
            # type_text(report.get("modelName", "") or "",          label="제품명",      tab_after=1),
            # type_text(report.get("ncrType", "") or "",            label="부적합유형",   tab_after=1),
            # type_text(report.get("description", "") or "",        label="부적합내용",   tab_after=1),

            dismiss_dialog("헤더 입력 완료 후"),
            wait_step(0.2, "헤더 안정화"),
        ]

        if self._runner:
            result = self._runner.run(steps)
            if not result["ok"]:
                raise RuntimeError(f"헤더 입력 실패: {result['error']}")

    def _input_grid(self, report: dict) -> None:
        """
        그리드(상세 행) 입력 시퀀스.
        TODO: 그리드 구조 확인 후 채울 것.
        클립보드 컬럼 페이스트 활용 권장 (§5.2).
        """
        logger.info("[그리드 입력] 보고서 #%s", report.get("id"))

        items = report.get("items", [])
        if not items:
            logger.info("그리드 행 없음 — 건너뜀")
            return

        # TODO: 그리드 첫 셀로 이동 (클릭 또는 Tab)
        # self._ctrl.click_relative(*MENU_COORDS["grid_first_cell"])

        # 예시: 열 전체 클립보드 페이스트 (§5.2)
        # qty_values = [str(item.get("quantity", "")) for item in items]
        # self._ctrl.paste_column(qty_values)
        pass

    def _save(self) -> None:
        """
        저장 버튼 클릭 또는 단축키 실행.
        TODO: 실제 저장 방법으로 교체.
        """
        logger.info("[저장]")

        steps: list[InputStep] = [
            # TODO: 저장 단축키 또는 버튼 좌표로 교체
            # click_at(*MENU_COORDS["save_btn"], label="저장 버튼"),
            # press_enter(label="저장 확인"),
            dismiss_dialog("저장 후"),
            wait_step(0.5, "저장 안정화"),
        ]

        if self._runner:
            result = self._runner.run(steps)
            if not result["ok"]:
                raise RuntimeError(f"저장 실패: {result['error']}")

    # ------------------------------------------------------------------
    # 콜백
    # ------------------------------------------------------------------

    def _on_step_complete(self, step: InputStep, index: int, total: int) -> None:
        logger.debug("  완료 [%d/%d] %s", index + 1, total, step.label or step.method.value)

    # ------------------------------------------------------------------
    # 유틸
    # ------------------------------------------------------------------

    @staticmethod
    def _fmt_date(value: Optional[str]) -> str:
        """
        API의 ISO8601 타임스탬프(예: '2026-05-22T00:00:00.000Z')를
        ERP 입력용 'YYYY-MM-DD'로 변환한다. 값이 없으면 빈 문자열.
        """
        if not value:
            return ""
        s = str(value)
        # ISO 타임스탬프면 'T' 앞 날짜 부분만 사용
        return s.split("T", 1)[0]
