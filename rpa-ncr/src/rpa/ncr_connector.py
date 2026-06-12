"""NCR → UNIERP 부적합보고서 자동 입력 오케스트레이터.

OCR_EU의 erp_connector.ERPConnector 구조를 본떠 단일 보고(단일 품목) 입력에
맞게 정리한 버전. 인보이스 라인아이템/불입예정 로직은 제거하고, 부적합보고서
헤더 입력 + 저장 + 에러창 자동처리에 집중한다.
"""
import threading
import time
from typing import Any

from src.data_source.report_model import NcrReport
from src.rpa.fallback_controller import FallbackController
from src.rpa.input_sequence import InputMethod, InputStep
from src.rpa.ncr_field_map import NcrReportFieldMap
from src.rpa.window_controller import FocusLostError, WindowController
from src.utils.config_loader import ConfigLoader
from src.utils.file_utils import get_config_dir
from src.utils.logger import get_logger

logger = get_logger(__name__)


class StoppedByUserError(Exception):
    """사용자가 중지 버튼을 눌러 입력이 도중에 멈췄을 때 발생.

    이 예외가 잡히면 호출자는 보고를 COMPLETED로 마킹하지 않고
    PENDING으로 되돌려 다시 처리할 수 있게 해야 한다.
    """
    pass


class NCRConnector:
    """부적합 보고를 UNIERP 부적합보고서 폼에 Tab 기반으로 입력한다."""

    def __init__(
        self,
        settings: dict[str, Any],
        field_mapping: dict[str, Any] | None = None,
        mode: str = "pywinauto",
    ):
        erp_cfg = settings.get("erp", {})
        self._settings = erp_cfg
        self._window_title = erp_cfg.get("window_title", "UNIERP")
        self._input_delay = erp_cfg.get("input_delay", 0.3)
        self._retry_count = erp_cfg.get("retry_count", 3)
        self._retry_delay = erp_cfg.get("retry_delay", 1.0)
        self._first_field_tabs = int(erp_cfg.get("first_field_tabs", 2))
        self._save_shortcut = erp_cfg.get("save_shortcut", "")
        self._mode = mode

        if field_mapping is None:
            field_mapping = ConfigLoader.load(
                get_config_dir() / "field_mapping.json", use_cache=False
            )
        self._field_mapping = field_mapping
        self._field_map = NcrReportFieldMap(field_mapping)

        self._process_name = erp_cfg.get("process_name", "")
        self._window_controller = WindowController(
            self._window_title, self._input_delay, process_name=self._process_name,
        )
        self._fallback_controller = FallbackController(self._input_delay)

        self._connected = False
        self._stop_event: threading.Event | None = None
        self._pause_event: threading.Event | None = None
        self._log_callback: Any = None
        self._error_events: list[str] = []
        self._valid_items: set[str] | None = None
        # 포커스 이탈 감시 (100ms 폴링 워치독)
        self._focus_lost_event = threading.Event()
        self._watchdog_stop = threading.Event()
        self._watchdog_thread: threading.Thread | None = None
        self._watchdog_interval = float(erp_cfg.get("focus_watchdog_interval_sec", 0.1))

    # ------------------------------------------------------------------
    # 콜백 / 상태
    # ------------------------------------------------------------------

    def set_stop_event(self, event: threading.Event) -> None:
        self._stop_event = event

    def set_pause_event(self, event: threading.Event) -> None:
        self._pause_event = event

    def set_log_callback(self, callback: Any) -> None:
        self._log_callback = callback

    def _emit_log(self, msg: str) -> None:
        logger.info(msg)
        if self._log_callback:
            self._log_callback(msg)

    def _is_stopped(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    def _is_paused(self) -> bool:
        return self._pause_event is not None and self._pause_event.is_set()

    def _wait_if_paused(self) -> None:
        """일시정지 중이면 재개/중지될 때까지 대기. 워치독의 포커스 체크도 무력화한다."""
        if not self._is_paused():
            return
        self._emit_log("⏸ 일시정지 — 재개 또는 중지 대기 중...")
        while self._is_paused():
            if self._is_stopped():
                return
            time.sleep(0.1)
        # 재개 시 일시정지 동안 쌓였을 수 있는 포커스 이탈 신호를 클리어
        self._focus_lost_event.clear()
        self._emit_log("▶ 재개 — 다음 스텝부터 계속")

    # ------------------------------------------------------------------
    # 연결 / 실행
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """이미 실행 중인 ERP에 연결한다."""
        if self._mode == "pywinauto":
            self._connected = self._window_controller.connect()
            if self._connected:
                self._window_controller.bring_to_front()
                return True
            self._emit_log("pywinauto 연결 실패 → pyautogui 폴백 시도")
        self._connected = self._fallback_controller.connect()
        if self._connected:
            self._mode = "pyautogui"
        return self._connected

    def launch_and_connect(self) -> bool:
        """ERP 실행 + 로그인 후 연결한다."""
        wc = self._window_controller
        launch_path = self._settings.get("launch_path", "")
        login_pw = self._settings.get("login_pw", "")

        if not launch_path:
            self._emit_log("ERP 실행 경로가 설정되지 않았습니다 (erp.launch_path)")
            # 이미 떠 있는 창에 연결 시도
            return self.connect()

        self._emit_log("ERP 프로그램 실행 중...")
        if not wc.launch_erp(launch_path, timeout=60):
            self._emit_log("ERP 실행 실패")
            return False
        self._emit_log("ERP 윈도우 감지됨")

        if login_pw:
            self._emit_log("로그인 중...")
            if wc.login(login_pw):
                self._emit_log("로그인 완료")
            else:
                self._emit_log("로그인 실패 — 이미 로그인된 상태일 수 있음")

        self._connected = wc.is_connected()
        return self._connected

    def is_connected(self) -> bool:
        if self._mode == "pywinauto":
            return self._window_controller.is_connected()
        return self._fallback_controller.is_connected()

    def disconnect(self) -> None:
        self._connected = False
        logger.info("ERP 연결 해제")

    # ------------------------------------------------------------------
    # 보고 입력 (메인 진입점)
    # ------------------------------------------------------------------

    def _is_form_already_open(self) -> bool:
        """부적합등록 폼이 이미 화면에 열려있는지 확인.

        식별: '발행팀' 라벨은 부적합등록 폼 입력 영역에만 있고 검색 패널에는
        없는 텍스트라 마커로 사용한다. (검색 패널엔 발생일/공장/진행상태/발행번호)
        """
        if self._mode != "pywinauto":
            return False
        wc = self._window_controller
        if not wc._main_window:
            return False
        marker = self._field_mapping.get("_form_open_marker", "발행팀")
        try:
            for lbl in wc._main_window.descendants(control_type="Text"):
                try:
                    if lbl.element_info.name == marker:
                        return True
                except Exception:
                    continue
        except Exception as e:
            logger.debug("폼 열림 감지 실패(무시): %s", e)
        return False

    def input_report(self, report: NcrReport, navigate: bool = True) -> None:
        """단일 부적합 보고를 ERP 폼에 입력한다.

        Args:
            report: 보고 데이터
            navigate: True면 메뉴찾기로 새 폼 열기, False면 현재 폼/포커스에서 바로 시작
                (처음부터 재실행할 때 사용자가 직전 폼을 닫은 뒤 호출하는 시나리오용)

        포커스 이탈 워치독이 보고 시작~끝 동안 100ms 간격으로 포그라운드 창을
        확인. 다른 창이 활성화되면 즉시 FocusLostError → 입력 중단.
        실패 시 예외를 던진다 (FocusLostError는 호출자가 배치 중단 처리).
        """
        if not self._connected:
            raise RuntimeError("ERP에 연결되지 않았습니다.")

        target_menu = self._settings.get("target_menu", "부적합보고서등록")
        wc = self._window_controller
        self._error_events = []

        self._emit_log(f"===== 보고 #{report.id} 입력 시작 =====")

        # (선택) 품목 마스터 검증
        self._validate_item(report)

        # 좌표 클릭 정확도를 위해 최대화
        if self._mode == "pywinauto" and not wc.ensure_maximized():
            self._emit_log("⚠ ERP 윈도우 최대화 실패 — 좌표가 어긋날 수 있습니다")

        # 메뉴 진입 — 이미 폼 열려있으면 생략(폼 두 개 방지)
        if navigate and self._mode == "pywinauto":
            if self._is_form_already_open():
                self._emit_log("✓ 부적합등록 폼이 이미 열려있음 — 메뉴 진입 생략")
                wc.bring_to_front()
            else:
                self._emit_log(f"메뉴 진입: {target_menu}")
                wc.navigate_to_menu(target_menu)
                time.sleep(2)
                wc.bring_to_front()

        # 포커스 워치독 시작 — 100ms마다 ERP가 포그라운드인지 확인
        self._start_focus_watchdog()

        try:
            # § 3.2 좌표 기반 — 각 스텝이 자기 좌표로 직접 클릭해 포커스를 잡으므로
            # 옛 Tab×first_field_tabs 루프와 스텝별 Tab 이동은 불필요.
            sequence = self._field_map.build_sequence(report)
            total = len(sequence.steps)
            for i, step in enumerate(sequence.steps):
                self._wait_if_paused()
                if self._is_stopped():
                    self._emit_log("중지 요청 감지 — 입력 중단")
                    raise StoppedByUserError(f"스텝 {i+1}/{total} 진입 전 중지")
                self._check_focus_lost()

                if step.method == InputMethod.SKIP:
                    self._emit_log(f"[{i+1}/{total}] {step.field_name} → 비어있음, 건너뜀")
                    continue

                if step.method in (InputMethod.POPUP_SEARCH, InputMethod.POPUP_SEARCH_ENTER) and not step.value:
                    self._emit_log(f"[{i+1}/{total}] {step.field_name} → 빈 값, 팝업 건너뜀")
                    continue

                coord_str = f"@ ref({step.ref_x},{step.ref_y})" if step.ref_x is not None else ""
                self._emit_log(f"[{i+1}/{total}] {step.field_name} = '{step.value}' "
                               f"({step.method.value}) {coord_str}")
                self._execute_step_tab_based(step)

                # 입력 직후 검색/확인 팝업 감지 — ERP가 모호한 값에 검색창을 띄우면
                # 다음 좌표 클릭이 엉뚱한 곳에 들어가는 걸 막는다. 팝업이 떠 있으면
                # 자동 일시정지 → 사용자가 선택/처리 후 [재개] 또는 [재실행]
                if self._mode == "pywinauto":
                    self._handle_popup_if_any(step)

            # 그리드(다행)는 단일 품목 스키마에서 미사용
            if self._field_mapping.get("grid_columns"):
                self._emit_log("⚠ grid_columns가 설정되어 있으나 그리드 입력은 아직 구현되지 않았습니다(단일 품목 모드).")

            self._check_focus_lost()
            self._check_error_dialog("헤더 입력 후")

            # 저장
            self._save()
            self._check_error_dialog("저장 후")

            if self._error_events:
                self._emit_log(f"⚠ 자동 처리된 에러 다이얼로그 {len(self._error_events)}건:")
                for i, ev in enumerate(self._error_events, 1):
                    self._emit_log(f"  {i}. {ev}")

            self._emit_log(f"===== 보고 #{report.id} 입력 완료 =====")
        finally:
            self._stop_focus_watchdog()

    # ------------------------------------------------------------------
    # 저장
    # ------------------------------------------------------------------

    def _save(self) -> None:
        wc = self._window_controller
        if self._save_shortcut:
            self._emit_log(f"저장: 단축키 {self._save_shortcut}")
            wc.send_keys(self._save_shortcut)
            time.sleep(0.5)
            return

        save_action = self._field_mapping.get("actions", {}).get("save")
        if save_action and (save_action.get("auto_id") or save_action.get("text")):
            self._emit_log("저장: 버튼 클릭")
            step = InputStep(
                field_name="save", value="", method=InputMethod.CLICK,
                control_type=save_action.get("control_type", "Button"),
                auto_id=save_action.get("auto_id", ""),
                erp_field_name=save_action.get("text", "저장"),
            )
            self._execute_with_retry(step)
            time.sleep(0.5)
            return

        self._emit_log("⚠ 저장 방법 미설정 (erp.save_shortcut 또는 actions.save) — 저장 건너뜀")

    # ------------------------------------------------------------------
    # 스텝 실행
    # ------------------------------------------------------------------

    def _execute_step_tab_based(self, step: InputStep) -> None:
        """좌표 클릭으로 필드 포커스 → 메서드별 입력. ref 좌표 없으면 현재 포커스 기준."""
        wc = self._window_controller

        # § 3.2 좌표 우선 — 필드 박스 중앙 클릭으로 포커스 확정
        if step.ref_x is not None and step.ref_y is not None and self._mode == "pywinauto":
            wc.left_click_at(step.ref_x, step.ref_y)
            time.sleep(0.15)  # 포커스 안정화

        if step.method == InputMethod.TYPE_TEXT:
            wc.type_into_focused(step.value, step.clear_before)
            time.sleep(step.delay_after)
        elif step.method == InputMethod.POPUP_SEARCH:
            wc.popup_search_and_select(step.value, enter_confirm=False)
        elif step.method == InputMethod.POPUP_SEARCH_ENTER:
            wc.popup_search_and_select(step.value, enter_confirm=True)
        elif step.method == InputMethod.DROPDOWN_SELECT:
            # UNIERP ComboBox: 클릭으로 열림 → ↓N → Enter로 확정
            wc.dropdown_select_down(int(step.value))
            time.sleep(0.1)
            wc.send_keys("{ENTER}")
        elif step.method == InputMethod.DISMISS_DIALOG:
            wc.dismiss_dialog_if_exists(timeout=float(step.value) if step.value else 2.0)
        elif step.method == InputMethod.CLICK:
            self._execute_with_retry(step)
        elif step.method == InputMethod.KEY_PRESS:
            wc._key_press(step)

    def _send_tab(self) -> None:
        if self._mode == "pywinauto":
            self._window_controller.send_tab()
        else:
            self._fallback_controller.execute_step(InputStep(
                field_name="tab_next", value="tab",
                method=InputMethod.KEY_PRESS, delay_after=0.1,
            ))

    def _execute_with_retry(self, step: InputStep) -> None:
        last_error = None
        for attempt in range(self._retry_count):
            try:
                if self._mode == "pywinauto":
                    self._window_controller.execute_step(step)
                else:
                    self._fallback_controller.execute_step(step)
                return
            except FocusLostError:
                raise
            except Exception as e:
                last_error = e
                if attempt < self._retry_count - 1:
                    logger.warning("입력 재시도 (%d/%d): %s - %s",
                                   attempt + 1, self._retry_count, step.field_name, e)
                    time.sleep(self._retry_delay)
        raise RuntimeError(f"입력 실패 (최대 재시도 초과): {step.field_name} - {last_error}")

    def _handle_popup_if_any(self, step: InputStep) -> None:
        """입력 직후 ERP가 검색/확인 팝업을 띄웠는지 확인.

        - 같은 PID의 자식 팝업이면 ERP의 검색창 → 자동 일시정지 + 사용자 개입 요청
        - 에러 다이얼로그는 _check_error_dialog로 자동 닫기 (기존 처리)
        """
        wc = self._window_controller
        try:
            import ctypes
            user32 = ctypes.windll.user32
            erp_hwnd = wc._main_window.handle if wc._main_window else None
            if not erp_hwnd:
                return

            # 잠깐 대기 — 팝업이 뜨는 데 시간이 걸릴 수 있음
            time.sleep(0.3)
            fg = user32.GetForegroundWindow()
            if not fg or fg == erp_hwnd:
                return  # ERP 메인이 활성 → 정상

            # ERP 프로세스의 자식 팝업인가? (같은 PID이면 ERP 내부 팝업)
            import ctypes.wintypes
            pid_fg = ctypes.wintypes.DWORD()
            pid_erp = ctypes.wintypes.DWORD()
            user32.GetWindowThreadProcessId(fg, ctypes.byref(pid_fg))
            user32.GetWindowThreadProcessId(erp_hwnd, ctypes.byref(pid_erp))
            if pid_fg.value != pid_erp.value:
                return  # 다른 프로그램 — 워치독이 처리

            # 팝업 제목 가져와 분류
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(fg, buf, 256)
            title = buf.value or ""

            # 에러/확인 다이얼로그면 자동 닫기
            if any(kw in title for kw in ("오류", "경고", "확인", "Error", "Warning")):
                wc.dismiss_dialog_if_exists(timeout=0.3)
                self._error_events.append(f"{step.field_name}: {title}")
                self._emit_log(f"⚠ 자동 처리된 다이얼로그: {title}")
                return

            # 그 외 — 보통 검색 팝업. 사용자 개입 필요
            self._emit_log(f"🔍 [{step.field_name}] 입력 후 팝업 감지: {title!r} — "
                           f"자동 일시정지. ERP에서 직접 선택/처리 후 [재개]")
            if self._pause_event:
                self._pause_event.set()
        except Exception as e:
            logger.debug("팝업 감지 실패(무시): %s", e)

    def _check_error_dialog(self, context: str = "") -> None:
        """에러 다이얼로그가 떠 있으면 Enter로 닫고 발생 지점을 기록한다."""
        try:
            if self._window_controller.dismiss_dialog_if_exists(timeout=0.3):
                self._error_events.append(context or "unknown")
                self._emit_log(f"⚠ 에러 다이얼로그 자동 처리됨: {context}")
        except Exception as e:
            logger.debug("에러 다이얼로그 체크 무시: %s", e)

    # ------------------------------------------------------------------
    # 포커스 이탈 워치독 (다른 창 클릭 시 즉시 중단)
    # ------------------------------------------------------------------

    def _start_focus_watchdog(self) -> None:
        """100ms마다 ERP가 포그라운드인지 확인하는 백그라운드 스레드 시작.

        다른 프로세스 창이 활성화되면 self._focus_lost_event 발동.
        메인 입력 루프는 스텝 사이에서 이 이벤트를 보고 FocusLostError 발생.

        ensure_foreground는 ERP 자체 팝업(같은 PID)은 통과시키므로
        UNIERP의 메뉴찾기/확인창 등은 오탐하지 않는다.
        """
        if self._mode != "pywinauto":
            return  # 폴백 모드에서는 윈도우 핸들이 없어 동작 안 함
        self._focus_lost_event.clear()
        self._watchdog_stop.clear()

        def watch() -> None:
            wc = self._window_controller
            interval = self._watchdog_interval
            while not self._watchdog_stop.is_set():
                # 일시정지 중에는 사용자가 다른 창을 자유롭게 보도록 포커스 체크 생략
                if self._is_paused():
                    self._focus_lost_event.clear()
                    self._watchdog_stop.wait(interval)
                    continue
                try:
                    wc.ensure_foreground()
                except FocusLostError as e:
                    self._focus_lost_event.set()
                    self._emit_log(f"⚠ 워치독: 다른 창 활성화 감지 — 다음 스텝에서 중단합니다 ({e})")
                    return
                except Exception as e:
                    logger.debug("워치독 검사 무시: %s", e)
                # busy-wait 줄이려고 interval만큼 대기 (stop 즉시 반응)
                self._watchdog_stop.wait(interval)

        self._watchdog_thread = threading.Thread(target=watch, daemon=True, name="focus-watchdog")
        self._watchdog_thread.start()
        logger.info("포커스 워치독 시작 (간격 %.2fs)", self._watchdog_interval)

    def _stop_focus_watchdog(self) -> None:
        """워치독 스레드 정지."""
        self._watchdog_stop.set()
        t = self._watchdog_thread
        if t and t.is_alive():
            t.join(timeout=1.0)
        self._watchdog_thread = None
        logger.debug("포커스 워치독 종료")

    def _check_focus_lost(self) -> None:
        """워치독이 포커스 이탈을 감지했으면 FocusLostError를 발생시킨다.

        스텝 사이마다 호출해 다른 창 클릭 즉시(100ms 내) 입력을 중단시킨다.
        """
        if self._focus_lost_event.is_set():
            raise FocusLostError("다른 창이 활성화되어 입력을 중단합니다 (워치독 감지)")

    # ------------------------------------------------------------------
    # 검토 모드 — 스텝별 재실행 + 시퀀스 미리보기
    # ------------------------------------------------------------------

    def build_sequence_info(self, report: NcrReport) -> list[dict[str, Any]]:
        """field_mapping 기준 17 스텝을 UI에 보여줄 수 있는 dict 리스트로 변환."""
        sequence = self._field_map.build_sequence(report)
        return [
            {
                "idx": i,
                "label": s.field_name,
                "value": s.value,
                "method": s.method.value,
                "tab_after": s.tab_after,
                "skippable": s.method == InputMethod.SKIP,
                "ref_x": s.ref_x,
                "ref_y": s.ref_y,
                "form_label": s.form_label,
            }
            for i, s in enumerate(sequence.steps)
        ]

    def redo_step(self, report: NcrReport, step_index: int) -> None:
        """N번 스텝 값을 좌표 기반으로 다시 입력한다.

        - ref 좌표 있으면 그 필드로 자동 포커스 + 입력 (사용자 추가 클릭 불필요)
        - ref 좌표 없으면 현재 포커스 필드에 타이핑
        - SKIP 스텝은 아무 것도 안 함
        """
        if not self._connected:
            raise RuntimeError("ERP에 연결되지 않았습니다.")
        sequence = self._field_map.build_sequence(report)
        if step_index < 0 or step_index >= len(sequence.steps):
            raise ValueError(f"잘못된 step_index: {step_index} (0~{len(sequence.steps)-1})")
        step = sequence.steps[step_index]
        if step.method == InputMethod.SKIP:
            self._emit_log(f"[재실행 #{step_index+1}] {step.field_name} → SKIP (할 일 없음)")
            return
        if step.method in (InputMethod.POPUP_SEARCH, InputMethod.POPUP_SEARCH_ENTER) and not step.value:
            self._emit_log(f"[재실행 #{step_index+1}] {step.field_name} → 빈 값")
            return
        self._emit_log(f"[재실행 #{step_index+1}] {step.field_name} = '{step.value}' ({step.method.value})")
        self._execute_step_tab_based(step)
        # Tab은 보내지 않음 — 사용자가 포커스를 직접 관리한다

    # ------------------------------------------------------------------
    # 품목 검증 (선택)
    # ------------------------------------------------------------------

    def _validate_item(self, report: NcrReport) -> None:
        if self._valid_items is None:
            self._valid_items = self._load_valid_items()
        if not self._valid_items:
            return  # 마스터 없음 → 검증 비활성화
        code = report.get_str("itemCode")
        if code and code not in self._valid_items:
            self._emit_log(f"⚠ 미등록 품목코드: '{code}' (검증 마스터 기준) — 입력은 계속합니다")

    @staticmethod
    def _load_valid_items() -> set[str]:
        path = get_config_dir() / "valid_items.txt"
        if not path.is_file():
            return set()
        try:
            with open(path, encoding="utf-8") as f:
                return {line.strip() for line in f if line.strip()}
        except Exception:
            return set()
