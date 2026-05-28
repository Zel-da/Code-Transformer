"""pywinauto 기반 윈도우 제어 모듈."""
import ctypes
import time
from typing import Any

from src.rpa.input_sequence import InputMethod, InputStep
from src.utils.logger import get_logger

logger = get_logger(__name__)

_user32 = ctypes.windll.user32


class FocusLostError(Exception):
    """ERP 윈도우에서 포커스가 이탈됐을 때 발생."""
    pass


def retry_on_failure(max_retries: int = 3, delay: float = 1.0):
    """실패 시 재시도하는 데코레이터."""
    def decorator(func):
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        logger.warning(
                            f"{func.__name__} 실패 (시도 {attempt + 1}/{max_retries}): {e}"
                        )
                        time.sleep(delay)
            raise last_error
        return wrapper
    return decorator


class WindowController:
    """pywinauto를 사용한 ERP 윈도우 제어기."""

    def __init__(self, window_title: str, input_delay: float = 0.3):
        self._window_title = window_title
        self._input_delay = input_delay
        self._app = None
        self._main_window = None
        self._last_grid_click_pos: tuple[int, int] | None = None
        # 메뉴찾기 팝업 위치 캐시 — 첫 F3에서 감지 → 이후 호출에서 포커스 보장용 클릭
        self._menu_finder_pos: tuple[int, int] | None = None

    def connect(self) -> bool:
        """ERP 윈도우에 연결한다.

        Returns:
            연결 성공 여부
        """
        try:
            from pywinauto import Application

            # 기존 프로세스에 연결
            self._app = Application(backend="uia").connect(
                title_re=f".*{self._window_title}.*",
                timeout=10,
            )
            self._main_window = self._app.window(title_re=f".*{self._window_title}.*")
            self._main_window.wait("ready", timeout=10)

            logger.info(f"ERP 윈도우 연결됨: {self._window_title}")
            return True

        except Exception as e:
            logger.error(f"ERP 윈도우 연결 실패: {e}")
            return False

    def launch_erp(self, launch_path: str, timeout: float = 60.0) -> bool:
        """ERP 프로그램을 실행한다.

        1. 이미 UNIERP 메인 윈도우가 있으면 바로 연결
        2. 없으면 .appref-ms 실행 → "로그인" 창 대기

        Args:
            launch_path: .appref-ms 또는 .exe 경로
            timeout: 최대 대기 시간(초)

        Returns:
            실행 성공 여부 (로그인 창 또는 메인 윈도우 감지)
        """
        import os
        from pywinauto import Application

        logger.info(f"ERP 실행: {launch_path}")

        # 이미 메인 윈도우가 실행 중인지 확인
        try:
            app = Application(backend="uia").connect(
                title_re=f".*{self._window_title}.*",
                timeout=3,
            )
            self._app = app
            self._main_window = app.window(title_re=f".*{self._window_title}.*")
            logger.info("ERP 이미 실행 중 — 기존 윈도우 사용")
            return True
        except Exception:
            pass

        # .appref-ms 실행 (ClickOnce)
        try:
            os.startfile(launch_path)
        except Exception as e:
            logger.error(f"ERP 실행 실패: {e}")
            return False

        # "로그인" 창 대기
        logger.info("로그인 창 대기 중...")
        start = time.time()
        while time.time() - start < timeout:
            try:
                app = Application(backend="uia").connect(
                    title="로그인",
                    timeout=3,
                )
                self._app = app
                self._login_window = app.window(title="로그인")
                logger.info("로그인 창 감지됨")
                return True
            except Exception:
                pass

            # 혹시 로그인 없이 바로 메인 윈도우가 뜨는 경우
            try:
                app = Application(backend="uia").connect(
                    title_re=f".*{self._window_title}.*",
                    timeout=2,
                )
                self._app = app
                self._main_window = app.window(title_re=f".*{self._window_title}.*")
                logger.info("메인 윈도우 직접 감지됨 (로그인 건너뜀)")
                return True
            except Exception:
                pass

            time.sleep(2)

        logger.error(f"로그인 창 대기 타임아웃 ({timeout}초)")
        return False

    def login(self, password: str, timeout: float = 30.0) -> bool:
        """로그인 창에서 비밀번호를 입력하고 로그인한다.

        UIA로 비밀번호 필드를 찾는다:
        1. PasswordBox 컨트롤 탐색
        2. Edit 컨트롤 중 키워드 매칭 (pw, pass, 비밀, 암호)
        3. Edit 컨트롤 중 두 번째 (ID=첫번째, PW=두번째)

        Args:
            password: 비밀번호
            timeout: 메인 윈도우 대기 시간(초)

        Returns:
            로그인 성공 여부
        """
        from pywinauto import Application, keyboard

        # 이미 메인 윈도우가 있으면 로그인 불필요
        if self._main_window:
            try:
                if self._main_window.exists():
                    logger.info("이미 로그인된 상태")
                    return True
            except Exception:
                pass

        # 로그인 창 확인
        login_win = getattr(self, "_login_window", None)
        if not login_win:
            logger.warning("로그인 창이 없습니다")
            return False

        try:
            login_win.set_focus()
            time.sleep(0.5)

            pw_field = None

            # 1차: PasswordBox 컨트롤 (가장 확실)
            try:
                pw_boxes = login_win.descendants(control_type="PasswordBox")
                if pw_boxes:
                    pw_field = pw_boxes[0]
                    logger.info(f"PasswordBox 발견: {pw_field.element_info.automation_id}")
            except Exception:
                pass

            # 2차: Edit 컨트롤 중 키워드 매칭
            if not pw_field:
                try:
                    edits = login_win.descendants(control_type="Edit")
                    for edit in edits:
                        try:
                            name = (edit.element_info.name or "").lower()
                            auto_id = (edit.element_info.automation_id or "").lower()
                            if any(kw in name + auto_id for kw in ("pw", "pass", "비밀", "암호")):
                                pw_field = edit
                                logger.info(f"비밀번호 Edit 발견 (키워드): {edit.element_info.automation_id}")
                                break
                        except Exception:
                            continue
                except Exception:
                    pass

            # 3차: Edit 컨트롤 중 두 번째 (ID=첫번째, PW=두번째)
            if not pw_field:
                try:
                    edits = login_win.descendants(control_type="Edit")
                    if len(edits) >= 2:
                        pw_field = edits[1]
                        logger.info(f"비밀번호 Edit 발견 (두 번째): {pw_field.element_info.automation_id}")
                    elif edits:
                        # Edit 1개뿐이면 그게 PW (ID는 자동 입력)
                        pw_field = edits[0]
                        logger.info("Edit 1개만 있음 → PW 필드로 사용")
                except Exception:
                    pass

            if pw_field:
                pw_field.click_input()
                time.sleep(0.2)
                pw_field.type_keys(password, with_spaces=True)
            else:
                logger.info("비밀번호 필드 탐색 실패 → Tab으로 이동")
                keyboard.send_keys("{TAB}")
                time.sleep(0.2)
                keyboard.send_keys(password, with_spaces=True)

            time.sleep(0.3)
            keyboard.send_keys("{ENTER}")
            logger.info("로그인 Enter 전송")

            # 로그인 후 스플래시/공지 창 대기 → Enter로 닫기
            time.sleep(2)
            for attempt in range(5):
                fg = _user32.GetForegroundWindow()
                # 메인 윈도우가 아닌 다른 창이 떠있으면 Enter
                if fg and fg != getattr(self._login_window, 'handle', None):
                    logger.info(f"로그인 후 팝업 감지 (시도 {attempt+1}) → Enter")
                    keyboard.send_keys("{ENTER}")
                    time.sleep(1)
                else:
                    break

        except Exception as e:
            logger.error(f"로그인 입력 실패: {e}")
            return False

        # 메인 윈도우 대기
        logger.info("UNIERP 메인 윈도우 대기 중...")
        start = time.time()
        while time.time() - start < timeout:
            try:
                app = Application(backend="uia").connect(
                    title_re=f".*{self._window_title}.*",
                    timeout=3,
                )
                self._app = app
                self._main_window = app.window(title_re=f".*{self._window_title}.*")
                self._main_window.wait("ready", timeout=10)
                logger.info(f"UNIERP 메인 윈도우 연결됨: {self._main_window.window_text()}")
                return True
            except Exception:
                time.sleep(2)

        logger.error(f"메인 윈도우 대기 타임아웃 ({timeout}초)")
        return False

    def navigate_to_menu(self, menu_name: str) -> bool:
        """메뉴찾기로 메뉴 이동한다.

        1) F3 키로 '메뉴찾기' 창 호출 (좌표 클릭 대체 — 모니터/해상도 무관)
        2) 검색 필드에 메뉴명 입력 → Enter

        Args:
            menu_name: 메뉴 이름 (예: "계약조건품의서등록")

        Returns:
            이동 성공 여부
        """
        from pywinauto import keyboard

        if not self._main_window:
            return False

        try:
            # 전체화면으로 전환
            self._main_window.set_focus()
            time.sleep(0.3)
            self._main_window.maximize()
            time.sleep(0.5)

            # 1단계: F3으로 메뉴찾기 창 호출 (메인 윈도우에 직접 전송, 포그라운드 강제)
            try:
                self._main_window.type_keys("{F3}", set_foreground=True)
            except Exception:
                keyboard.send_keys("{F3}")
            logger.info("메뉴찾기: F3 키 전송")
            time.sleep(0.6)

            # 2단계: 캐시된 메뉴찾기 팝업 위치가 있으면 클릭으로 포커스 보장
            #  - 첫 호출에서는 캐시가 비어있어 스킵 (F3만으로 포커스 OK)
            #  - 두 번째 이상에서는 F3은 열리지만 이전 메뉴 탭에 포커스가 남아있어
            #    팝업 위치 클릭으로 강제 전환
            import pywinauto.mouse as pymouse
            if self._menu_finder_pos is not None:
                cx, cy = self._menu_finder_pos
                pymouse.click(coords=(cx, cy))
                logger.info(f"메뉴찾기 캐시 위치 클릭: ({cx},{cy})")
                time.sleep(0.2)

            # 3단계: 팝업 감지 → 위치 캐시 (다음 호출용)
            popup = self._find_popup_window()
            if popup is not None:
                try:
                    rect = popup.rectangle()
                    cx = (rect.left + rect.right) // 2
                    cy = rect.top + 40  # 팝업 상단(입력 필드 근처)
                    self._menu_finder_pos = (cx, cy)
                    logger.info(f"메뉴찾기 팝업 위치 캐시: ({cx},{cy})")
                except Exception as e:
                    logger.warning(f"팝업 위치 캐시 실패: {e}")
            else:
                logger.info("메뉴찾기 팝업 감지 안 됨 (캐시 갱신 스킵)")

            # 2단계: 메뉴명 입력 → Enter (클립보드로 입력 — 괄호 등 특수문자 안전)
            import pyperclip
            keyboard.send_keys("^a")
            time.sleep(0.1)
            pyperclip.copy(menu_name)
            keyboard.send_keys("^v")
            time.sleep(0.5)
            keyboard.send_keys("{ENTER}")
            logger.info(f"메뉴 이동: '{menu_name}'")

            # 페이지 로딩 대기
            time.sleep(2)
            return True

        except Exception as e:
            logger.error(f"메뉴 이동 실패: {e}")
            return False

    def is_connected(self) -> bool:
        """연결 상태를 확인한다."""
        if not self._main_window:
            return False
        try:
            return self._main_window.exists()
        except Exception:
            return False

    @retry_on_failure(max_retries=3, delay=1.0)
    def execute_step(self, step: InputStep) -> None:
        """입력 단계를 실행한다.

        Args:
            step: 실행할 입력 단계
        """
        if not self._main_window:
            raise RuntimeError("ERP 윈도우에 연결되지 않았습니다.")

        logger.debug(f"입력 실행: {step}")

        if step.method == InputMethod.SKIP:
            # SKIP은 Tab으로만 지나감 — 여기서는 아무 것도 안 함
            return
        elif step.method == InputMethod.TYPE_TEXT:
            self._type_text(step)
        elif step.method == InputMethod.SELECT_ITEM:
            self._select_item(step)
        elif step.method == InputMethod.CLICK:
            self._click(step)
        elif step.method == InputMethod.KEY_PRESS:
            self._key_press(step)
        elif step.method == InputMethod.WAIT:
            time.sleep(float(step.value) if step.value else 1.0)

        time.sleep(step.delay_after)

    def _type_text(self, step: InputStep) -> None:
        """텍스트를 입력한다."""
        control = self._find_control(step)
        if control:
            if step.clear_before:
                control.set_edit_text("")
            control.type_keys(step.value, with_spaces=True)
        else:
            # 컨트롤 미발견 — 현재 포커스된 곳에 입력
            self.type_into_focused(step.value, step.clear_before)

    def _select_item(self, step: InputStep) -> None:
        """콤보박스 항목을 선택한다."""
        control = self._find_control(step)
        if control:
            try:
                control.select(step.value)
            except Exception:
                # 텍스트 직접 입력으로 폴백
                control.set_edit_text(step.value)
        else:
            # 컨트롤 미발견 — 현재 포커스된 곳에 텍스트 입력
            self.type_into_focused(step.value, step.clear_before)

    def _click(self, step: InputStep) -> None:
        """버튼을 클릭한다."""
        control = self._find_control(step)
        if control:
            control.click()

    def _key_press(self, step: InputStep) -> None:
        """키를 입력한다 (포커스 변경 없이)."""
        from pywinauto import keyboard
        keyboard.send_keys(step.value)

    def send_tab(self) -> None:
        """Tab 키를 보내 다음 필드로 이동한다."""
        from pywinauto import keyboard
        self.ensure_foreground()
        keyboard.send_keys("{TAB}")

    def type_into_focused(self, value: str, clear_before: bool = True) -> None:
        """현재 포커스된 컨트롤에 텍스트를 입력한다."""
        from pywinauto import keyboard
        self.ensure_foreground()
        if clear_before:
            keyboard.send_keys("^a")
            time.sleep(0.05)
        keyboard.send_keys(value, with_spaces=True)

    def type_grid_cell(self, value: str) -> None:
        """그리드 셀에 빠르게 입력한다 (포그라운드 체크 생략)."""
        from pywinauto import keyboard
        keyboard.send_keys(value, with_spaces=True)

    def _find_control(self, step: InputStep) -> Any:
        """UI 컨트롤을 찾는다.

        우선순위: auto_id → erp_field_name(title) → tab_order(인덱스).
        pywinauto child_window()는 lazy spec을 반환하므로
        .exists()로 실제 존재 여부를 확인한 뒤 반환한다.
        """
        if not self._main_window:
            return None

        try:
            # Priority 1: auto_id (가장 확실한 매칭)
            if step.auto_id:
                ctrl = self._main_window.child_window(auto_id=step.auto_id)
                if ctrl.exists(timeout=0):
                    logger.debug(f"컨트롤 발견 (auto_id): {step.field_name} → {step.auto_id}")
                    return ctrl
                logger.debug(f"컨트롤 미발견 (auto_id): {step.field_name} → {step.auto_id}")

            # Priority 2: erp_field_name + control_type (title 매칭)
            if step.erp_field_name:
                ctrl = self._main_window.child_window(
                    title=step.erp_field_name,
                    control_type=step.control_type,
                )
                if ctrl.exists(timeout=0):
                    logger.debug(f"컨트롤 발견 (title): {step.field_name} → {step.erp_field_name}")
                    return ctrl
                logger.debug(f"컨트롤 미발견 (title): {step.field_name} → {step.erp_field_name}")

            # Priority 3: tab_order 인덱스 (같은 control_type 중 순서)
            if step.tab_order > 0:
                edits = self._main_window.children(control_type=step.control_type)
                if step.tab_order <= len(edits):
                    logger.debug(
                        f"컨트롤 발견 (tab_order): {step.field_name} → "
                        f"[{step.tab_order}]/{len(edits)}"
                    )
                    return edits[step.tab_order - 1]

        except Exception as e:
            logger.warning(f"컨트롤 찾기 실패: {step.field_name} - {e}")

        logger.debug(f"컨트롤 미발견: {step.field_name} — focused 입력으로 대체")
        return None

    def bring_to_front(self) -> None:
        """ERP 윈도우를 전면으로 가져온다 (내부 포커스 유지)."""
        if not self._main_window:
            return
        try:
            self._main_window.set_focus()
        except Exception as e:
            logger.warning(f"윈도우 포커스 실패: {e}")

    def ensure_maximized(self) -> bool:
        """ERP 윈도우를 강제로 최대화한다.

        좌표 기반 클릭(1행 1열, 불입예정 그리드 등)이 정확하려면 최대화 상태여야 한다.
        - 최대화 상태면 즉시 True 반환
        - 아니면 set_focus → maximize 호출, 실패 시 1회 재시도
        """
        if not self._main_window:
            return False
        try:
            if self._main_window.is_maximized():
                return True
            self._main_window.set_focus()
            time.sleep(0.2)
            self._main_window.maximize()
            time.sleep(0.5)
            if self._main_window.is_maximized():
                logger.info("ERP 윈도우 최대화 완료")
                return True
            # 1회 재시도
            self._main_window.maximize()
            time.sleep(0.5)
            ok = self._main_window.is_maximized()
            if ok:
                logger.info("ERP 윈도우 최대화 완료 (재시도)")
            else:
                logger.warning("ERP 윈도우 최대화 실패 — 좌표 클릭이 어긋날 수 있음")
            return ok
        except Exception as e:
            logger.warning(f"최대화 실패: {e}")
            return False

    def is_foreground(self) -> bool:
        """ERP 윈도우가 현재 포그라운드인지 확인한다."""
        if not self._main_window:
            return False
        try:
            return _user32.GetForegroundWindow() == self._main_window.handle
        except Exception:
            return False

    def ensure_foreground(self) -> None:
        """ERP가 포그라운드인지 확인한다.

        다른 창이 포그라운드이면 FocusLostError를 발생시킨다.
        사용자가 다른 작업을 하면 즉시 중지하기 위함.
        """
        if not self._main_window:
            return
        try:
            hwnd = self._main_window.handle
            fg = _user32.GetForegroundWindow()
            if fg == hwnd:
                return

            # 포커스가 ERP 팝업(자식 윈도우)일 수 있으니 체크
            # 팝업은 별도 윈도우이므로 ERP 프로세스 소속인지 확인
            import ctypes.wintypes
            pid = ctypes.wintypes.DWORD()
            _user32.GetWindowThreadProcessId(fg, ctypes.byref(pid))
            erp_pid = ctypes.wintypes.DWORD()
            _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(erp_pid))
            if pid.value == erp_pid.value:
                return  # ERP의 팝업 윈도우 → OK

            # 다른 프로그램이 포그라운드 → 포커스 이탈
            raise FocusLostError("ERP 윈도우에서 포커스가 이탈되었습니다. 입력을 중지합니다.")

        except FocusLostError:
            raise
        except Exception as e:
            logger.debug(f"포그라운드 체크 실패: {e}")

    def dismiss_dialog_if_exists(self, timeout: float = 1.0) -> bool:
        """대화상자가 떠 있으면 Enter로 닫는다.

        고정 sleep 대신 0.1초 간격으로 폴링하여 대화상자를 빠르게 감지한다.
        """
        from pywinauto import keyboard

        erp_hwnd = self._main_window.handle if self._main_window else None

        # 폴링: 0.1초 간격으로 대화상자 감지
        elapsed = 0.0
        while elapsed < timeout:
            fg = _user32.GetForegroundWindow()
            if fg and fg != erp_hwnd:
                # 대화상자 감지!
                logger.info("대화상자 감지 → Enter")
                keyboard.send_keys("{ENTER}")
                time.sleep(0.15)

                # 닫혔는지 확인
                fg2 = _user32.GetForegroundWindow()
                if fg2 == erp_hwnd:
                    logger.info("대화상자 닫힘 확인 (Enter)")
                    return True

                # 안 닫혔으면 확인 버튼 클릭
                logger.info("Enter로 안 닫힘 → 확인 버튼 클릭 시도")
                try:
                    from pywinauto import Desktop
                    desktop = Desktop(backend="uia")
                    for win in desktop.windows():
                        try:
                            if win.handle == erp_hwnd:
                                continue
                            buttons = win.children(control_type="Button")
                            for btn in buttons:
                                text = btn.window_text()
                                if text in ("확인", "OK", "ok", "Yes", "예"):
                                    btn.click_input()
                                    logger.info(f"확인 버튼 클릭: '{text}'")
                                    time.sleep(0.15)
                                    return True
                        except Exception:
                            continue
                except Exception as e:
                    logger.warning(f"확인 버튼 클릭 실패: {e}")
                return True

            time.sleep(0.1)
            elapsed += 0.1

        logger.info("대화상자 없음 — 건너뜀")
        return False

    def check_and_dismiss_dialog(self) -> bool:
        """대화상자가 떠 있으면 즉시 Enter로 닫는다 (sleep 없음).

        그리드 입력 중 빠른 체크용. dismiss_dialog_if_exists와 달리 대기하지 않는다.
        """
        from pywinauto import keyboard

        fg = _user32.GetForegroundWindow()
        erp_hwnd = self._main_window.handle if self._main_window else None

        if fg == erp_hwnd or not fg:
            return False

        # 같은 프로세스인지 확인 (ERP 대화상자)
        import ctypes.wintypes
        pid = ctypes.wintypes.DWORD()
        _user32.GetWindowThreadProcessId(fg, ctypes.byref(pid))
        erp_pid = ctypes.wintypes.DWORD()
        _user32.GetWindowThreadProcessId(erp_hwnd, ctypes.byref(erp_pid))

        if pid.value != erp_pid.value:
            return False  # 다른 프로그램 → 무시 (FocusLostError는 다른 곳에서 처리)

        logger.info("대화상자 감지 (즉시) → Enter")
        keyboard.send_keys("{ENTER}")
        time.sleep(0.1)
        return True

    # ── 좌표 유틸 ──

    def _window_relative_coords(self, ref_x: int, ref_y: int,
                                 ref_w: int = 1920, ref_h: int = 1080) -> tuple[int, int]:
        """ERP 윈도우 기준 상대 좌표를 절대 좌표로 변환한다.

        특정 해상도 전체화면에서의 좌표(ref_x, ref_y)를 비율로 계산하여
        현재 ERP 윈도우 위치에 맞는 절대 좌표를 반환한다.
        듀얼 모니터/다른 해상도에서도 정확하게 동작한다.

        Args:
            ref_x, ref_y: 기준 해상도에서의 좌표
            ref_w, ref_h: 기준 해상도 (기본 1920x1080)
        """
        if not self._main_window:
            return ref_x, ref_y
        try:
            win_rect = self._main_window.rectangle()
            win_w = win_rect.right - win_rect.left
            win_h = win_rect.bottom - win_rect.top
            abs_x = win_rect.left + int(win_w * ref_x / ref_w)
            abs_y = win_rect.top + int(win_h * ref_y / ref_h)
            logger.debug(
                f"좌표 변환: ref=({ref_x},{ref_y})/{ref_w}x{ref_h}"
                f" win=({win_rect.left},{win_rect.top} {win_w}x{win_h})"
                f" → abs=({abs_x},{abs_y})"
            )
            return abs_x, abs_y
        except Exception:
            return ref_x, ref_y

    # ── 새 ERP 워크플로우 메서드 ──

    def click_right_button(self, double_click: bool = False) -> None:
        """현재 포커스된 필드 오른쪽의 버튼을 클릭한다."""
        if not self._main_window:
            return

        rect = self._get_focused_rect()
        if not rect:
            logger.warning("포커스된 컨트롤의 좌표를 찾을 수 없습니다")
            return

        click_x = rect.right + 15
        click_y = rect.top + (rect.bottom - rect.top) // 2

        logger.info(
            f"오른쪽 버튼 클릭: rect=({rect.left},{rect.top},{rect.right},{rect.bottom})"
            f" → click=({click_x},{click_y}), double={double_click}"
        )

        import pywinauto.mouse as pymouse
        if double_click:
            pymouse.double_click(coords=(click_x, click_y))
        else:
            pymouse.click(coords=(click_x, click_y))

        time.sleep(0.15)

    def popup_search_and_select(self, search_text: str, enter_confirm: bool = False) -> None:
        """팝업을 이용한 검색 및 선택.

        1. 옆 버튼 클릭 → 팝업 대기
        2. Tab → 검색어 입력 → Enter 조회
        3-a. enter_confirm=False: 첫 번째 행 더블클릭 (거래처)
        3-b. enter_confirm=True: Enter로 확인 (국가코드)
        """
        if not self._main_window:
            return

        logger.info(f"팝업 검색: '{search_text}' (enter_confirm={enter_confirm})")
        from pywinauto import keyboard

        # 1. 옆 버튼 클릭
        self.click_right_button()

        # 2. 팝업 대기
        popup = self._wait_for_popup(timeout=5.0)
        if not popup:
            logger.warning("팝업 윈도우를 찾을 수 없습니다")
            return
        try:
            logger.info(f"팝업 감지됨: '{popup.window_text()}'")
        except Exception:
            logger.info("팝업 감지됨")

        # 3. Tab → 검색 필드 이동
        time.sleep(0.15)
        keyboard.send_keys("{TAB}")
        time.sleep(0.1)

        # 4. 검색어 입력
        keyboard.send_keys(search_text, with_spaces=True)
        time.sleep(0.1)

        # 5. Enter로 조회
        keyboard.send_keys("{ENTER}")
        time.sleep(1.0)

        # 6. 확인
        if enter_confirm:
            # 국가코드 등: Enter로 확인
            keyboard.send_keys("{ENTER}")
            time.sleep(0.3)
            logger.info(f"팝업 Enter 확인 완료: '{search_text}'")
        else:
            # 거래처 등: 첫 번째 행 더블클릭
            self._double_click_first_result(popup)
            time.sleep(0.5)
            logger.info(f"팝업 더블클릭 완료: '{search_text}'")

    def double_click_first_popup_item(self) -> None:
        """현재 열려있는 팝업의 첫 번째 항목을 더블클릭한다."""
        popup = self._wait_for_popup(timeout=2.0)
        if not popup:
            logger.warning("팝업 윈도우를 찾을 수 없습니다")
            return

        self._double_click_first_in_window(popup)
        time.sleep(0.3)

    def dropdown_select_down(self, down_count: int) -> None:
        """드롭다운에서 아래방향키를 N번 눌러 항목을 선택한다.

        Args:
            down_count: 아래방향키 횟수
        """
        from pywinauto import keyboard

        logger.debug(f"드롭다운 선택: 아래방향키 {down_count}회")
        self.ensure_foreground()

        for _ in range(down_count):
            keyboard.send_keys("{DOWN}")
            time.sleep(0.03)

    def click_tab_item(self, tab_name: str, auto_id: str = "") -> None:
        """탭 이름으로 탭을 클릭한다."""
        if not self._main_window:
            return
        try:
            if auto_id:
                tab_item = self._main_window.child_window(
                    auto_id=auto_id, control_type="TabItem",
                )
            else:
                # 같은 이름 탭이 여러 개일 수 있으므로 found_index=0
                tab_item = self._main_window.child_window(
                    title=tab_name, control_type="TabItem",
                    found_index=0,
                )
            if tab_item.exists(timeout=2):
                tab_item.click_input()
                logger.info(f"탭 클릭: '{tab_name}'")
                time.sleep(0.15)
            else:
                logger.warning(f"탭을 찾을 수 없음: '{tab_name}'")
        except Exception as e:
            logger.warning(f"탭 클릭 실패: '{tab_name}' - {e}")

    def right_click_focused(self, y_offset: int = 0) -> None:
        """현재 포커스된 위치에서 우클릭한다.

        Args:
            y_offset: Y좌표 추가 오프셋 (양수=아래, 음수=위)
        """
        rect = self._get_focused_rect()
        if not rect:
            logger.warning("포커스된 컨트롤 좌표를 찾을 수 없습니다")
            return

        click_x = rect.left + (rect.right - rect.left) // 2
        click_y = rect.top + (rect.bottom - rect.top) // 2 + y_offset

        import pywinauto.mouse as pymouse
        logger.info(f"우클릭: ({click_x}, {click_y}) y_offset={y_offset}")
        pymouse.right_click(coords=(click_x, click_y))
        time.sleep(0.3)

    def right_click_grid_empty(self) -> None:
        """계약내역 그리드의 빈 행 영역에서 우클릭한다.

        ERP 윈도우 기준 상대 좌표 사용 (모니터 위치 무관).
        기준: 1920x1080 전체화면에서 (658, 544)
        """
        if not self._main_window:
            return

        import pywinauto.mouse as pymouse

        click_x, click_y = self._window_relative_coords(658, 544, 1920, 1080)

        logger.info(f"그리드 빈 영역 우클릭: ({click_x}, {click_y})")
        self._last_grid_click_pos = (click_x, click_y)
        pymouse.right_click(coords=(click_x, click_y))
        time.sleep(0.1)

    def click_context_menu_item(self, item_name: str, x_offset: int = 30, y_offset: int = 10) -> None:
        """컨텍스트 메뉴에서 항목을 클릭한다.

        우클릭 후 나온 메뉴에서 오른쪽+아래로 이동하여 좌클릭.
        """
        import pywinauto.mouse as pymouse
        time.sleep(0.05)

        import ctypes

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        pt = POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))

        click_x = pt.x + x_offset
        click_y = pt.y + y_offset
        logger.info(f"컨텍스트 메뉴 클릭: ({click_x}, {click_y}) from cursor ({pt.x}, {pt.y})")
        pymouse.click(coords=(click_x, click_y))
        time.sleep(0.1)

    def click_first_grid_cell(self) -> None:
        """그리드의 1행 1열을 더블클릭한다 (편집 모드 진입).

        ERP 윈도우 기준 상대 좌표(1920x1080 기준 398, 372)를 변환하여 클릭.
        다중 모니터/해상도 무관.
        """
        import pywinauto.mouse as pymouse

        click_x, click_y = self._window_relative_coords(398, 390, 1920, 1080)
        pymouse.double_click(coords=(click_x, click_y))
        logger.info(f"1행 1열 더블클릭: ({click_x}, {click_y})")
        time.sleep(0.05)

    def single_click_first_grid_cell(self) -> None:
        """그리드의 1행 1열을 단일 클릭한다 (포커스 모드 진입).

        ERP 윈도우 기준 상대 좌표(1920x1080 기준 398, 372)를 변환하여 클릭.
        다중 모니터/해상도 무관. 단일 클릭은 포커스 모드 진입,
        클립보드 붙여넣기는 포커스 모드에서만 동작한다.
        """
        import pywinauto.mouse as pymouse

        click_x, click_y = self._window_relative_coords(398, 390, 1920, 1080)
        pymouse.click(coords=(click_x, click_y))
        logger.info(f"1행 1열 단일클릭 (포커스 모드): ({click_x}, {click_y})")
        time.sleep(0.05)

    def left_click_at(self, x: int, y: int) -> None:
        """1920x1080 기준 좌표를 ERP 윈도우 상대 좌표로 변환하여 좌클릭한다.

        다중 모니터 환경에서도 ERP 윈도우 위치 기준으로 동작.
        """
        import pywinauto.mouse as pymouse
        click_x, click_y = self._window_relative_coords(x, y, 1920, 1080)
        pymouse.click(coords=(click_x, click_y))
        logger.info(f"좌클릭: ref=({x},{y}) → abs=({click_x},{click_y})")
        time.sleep(0.1)

    def right_click_at(self, x: int, y: int) -> None:
        """1920x1080 기준 좌표를 ERP 윈도우 상대 좌표로 변환하여 우클릭한다.

        다중 모니터 환경에서도 ERP 윈도우 위치 기준으로 동작.
        """
        import pywinauto.mouse as pymouse
        click_x, click_y = self._window_relative_coords(x, y, 1920, 1080)
        pymouse.right_click(coords=(click_x, click_y))
        logger.info(f"우클릭: ref=({x},{y}) → abs=({click_x},{click_y})")
        time.sleep(0.15)

    def clipboard_paste_column(self, values: list[str]) -> None:
        """클립보드에 줄바꿈 구분 값을 복사한 뒤 Ctrl+V로 붙여넣는다.

        ERP 그리드 포커스 모드에서 붙여넣으면 전체 행이 자동 채워진다.
        붙여넣기 후 커서는 1행에 유지된다.

        Args:
            values: 각 행에 입력할 값 리스트
        """
        import pyperclip
        from pywinauto import keyboard

        clip_text = "\r\n".join(values)
        pyperclip.copy(clip_text)
        logger.info(f"클립보드 붙여넣기: {len(values)}행")
        keyboard.send_keys("^v")
        time.sleep(0.3)

    def send_down(self) -> None:
        """아래방향키를 보낸다."""
        from pywinauto import keyboard
        keyboard.send_keys("{DOWN}")

    def send_home(self) -> None:
        """Home 키를 보낸다."""
        from pywinauto import keyboard
        keyboard.send_keys("{HOME}")
        time.sleep(0.1)

    def send_keys(self, keys: str) -> None:
        """키 시퀀스를 보낸다."""
        from pywinauto import keyboard
        keyboard.send_keys(keys)
        time.sleep(0.1)

    def send_keys_fast(self, keys: str) -> None:
        """키 시퀀스를 딜레이 없이 보낸다 (그리드 반복 입력용)."""
        from pywinauto import keyboard
        keyboard.send_keys(keys)

    # ── 내부 헬퍼 메서드 ──

    def _get_focused_rect(self) -> Any:
        """포커스된 UI 요소의 사각형 좌표를 반환한다."""
        try:
            from pywinauto.uia_defines import IUIA
            from pywinauto.uia_element_info import UIAElementInfo

            iuia = IUIA()
            focused_elem = iuia.iuia.GetFocusedElement()
            if focused_elem:
                elem_info = UIAElementInfo(focused_elem)
                return elem_info.rectangle
        except Exception as e:
            logger.debug(f"UIA 포커스 요소 사각형 조회 실패: {e}")

        # Fallback: win32 API
        try:
            import ctypes
            import ctypes.wintypes

            class GUITHREADINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize", ctypes.wintypes.DWORD),
                    ("flags", ctypes.wintypes.DWORD),
                    ("hwndActive", ctypes.wintypes.HWND),
                    ("hwndFocus", ctypes.wintypes.HWND),
                    ("hwndCapture", ctypes.wintypes.HWND),
                    ("hwndMenuOwner", ctypes.wintypes.HWND),
                    ("hwndMoveSize", ctypes.wintypes.HWND),
                    ("hwndCaret", ctypes.wintypes.HWND),
                    ("rcCaret", ctypes.wintypes.RECT),
                ]

            user32 = ctypes.windll.user32
            foreground = user32.GetForegroundWindow()
            thread_id = user32.GetWindowThreadProcessId(foreground, None)

            gui_info = GUITHREADINFO()
            gui_info.cbSize = ctypes.sizeof(GUITHREADINFO)
            if user32.GetGUIThreadInfo(thread_id, ctypes.byref(gui_info)):
                hwnd = gui_info.hwndFocus
                if hwnd:
                    rect = ctypes.wintypes.RECT()
                    user32.GetWindowRect(hwnd, ctypes.byref(rect))
                    return rect
        except Exception as e:
            logger.debug(f"Win32 포커스 사각형 조회 실패: {e}")

        return None

    def _wait_for_popup_close(self, popup: Any, timeout: float = 5.0) -> None:
        """팝업이 닫힐 때까지 대기한다. 안 닫히면 Enter를 재시도한다."""
        from pywinauto import keyboard
        start = time.time()
        retry_count = 0
        while time.time() - start < timeout:
            try:
                if not popup.exists():
                    logger.info("팝업 닫힘 확인")
                    return
            except Exception:
                # exists() 호출 실패 = 이미 닫힘
                logger.info("팝업 닫힘 확인 (예외)")
                return

            retry_count += 1
            if retry_count % 5 == 0:
                # 1.5초마다 Enter 재시도
                logger.info("팝업 아직 열려있음 → Enter 재시도")
                keyboard.send_keys("{ENTER}")

            time.sleep(0.3)

        logger.warning(f"팝업이 {timeout}초 내에 닫히지 않음")

    def _wait_for_popup(self, timeout: float = 3.0) -> Any:
        """팝업 윈도우가 나타날 때까지 대기한다."""
        erp_hwnd = self._main_window.handle if self._main_window else None
        start = time.time()
        attempt = 0
        while time.time() - start < timeout:
            attempt += 1
            fg = _user32.GetForegroundWindow()
            logger.debug(
                f"팝업 대기 #{attempt}: fg={fg}, erp={erp_hwnd}, same={fg == erp_hwnd}"
            )
            popup = self._find_popup_window()
            if popup:
                return popup
            time.sleep(0.3)
        logger.warning(f"팝업 대기 타임아웃 ({timeout}초, {attempt}회 시도)")
        return None

    def _find_popup_window(self) -> Any:
        """ERP 팝업 윈도우를 찾는다.

        포그라운드 윈도우가 ERP 메인이 아니면 팝업으로 판단한다.
        ERP 팝업은 자식/소유 윈도우라 Desktop.windows()에 안 나오므로
        핸들로 직접 래핑한다.
        """
        erp_hwnd = self._main_window.handle if self._main_window else None
        fg = _user32.GetForegroundWindow()

        if not fg or fg == erp_hwnd:
            return None

        logger.info(f"팝업 감지: fg={fg}, erp={erp_hwnd}")

        # 핸들로 직접 UIA 래핑 (Desktop.windows()에 안 나오는 자식 윈도우 대응)
        try:
            from pywinauto.uia_element_info import UIAElementInfo
            from pywinauto.controls.uiawrapper import UIAWrapper
            from pywinauto.uia_defines import IUIA

            iuia = IUIA()
            element = iuia.iuia.ElementFromHandle(fg)
            if element:
                elem_info = UIAElementInfo(element)
                popup = UIAWrapper(elem_info)
                title = popup.window_text()
                logger.info(f"팝업 발견 (UIA 직접): '{title}' handle={fg}")
                return popup
        except Exception as e:
            logger.warning(f"UIA 직접 래핑 실패: {e}")

        return None

    def _click_confirm_button(self, popup: Any) -> None:
        """팝업의 확인 버튼을 클릭한다."""
        try:
            # "확인" 텍스트가 있는 버튼 찾기
            buttons = popup.children(control_type="Button")
            for btn in buttons:
                try:
                    text = btn.window_text()
                    if text in ("확인", "OK", "ok", "Yes", "예"):
                        logger.debug(f"확인 버튼 클릭: '{text}'")
                        btn.click_input()
                        return
                except Exception:
                    continue

            # 못 찾으면 마지막 버튼 클릭 (보통 오른쪽 아래가 확인)
            if buttons:
                logger.debug("확인 버튼 텍스트 매칭 실패 → 마지막 버튼 클릭")
                buttons[-1].click_input()
                return

            # 버튼도 없으면 Enter
            logger.debug("확인 버튼 없음 → Enter 키")
            from pywinauto import keyboard
            keyboard.send_keys("{ENTER}")

        except Exception as e:
            logger.warning(f"확인 버튼 클릭 실패: {e}")
            from pywinauto import keyboard
            keyboard.send_keys("{ENTER}")

    def _click_first_item_in_window(self, window: Any) -> None:
        """윈도우 내 첫 번째 데이터 항목을 선택한다."""
        from pywinauto import keyboard

        try:
            # descendants()로 깊이 탐색
            for ctrl_type in ["DataItem", "ListItem", "Row"]:
                try:
                    items = window.descendants(control_type=ctrl_type)
                    if items:
                        items[0].click_input()
                        logger.info(f"{ctrl_type} 첫 번째 항목 선택 (총 {len(items)}개)")
                        return
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"컨트롤 탐색 실패: {e}")

        # 폴백: Tab으로 결과 목록 이동 → Down으로 첫 번째 행 선택
        logger.info("컨트롤 탐색 실패 → Tab+Down으로 첫 번째 행 선택")
        keyboard.send_keys("{TAB}")
        time.sleep(0.1)
        keyboard.send_keys("{DOWN}")
        time.sleep(0.2)

    def _double_click_first_result(self, popup: Any) -> None:
        """팝업 검색 결과의 첫 번째 행을 더블클릭한다 (선택 + 팝업 닫힘)."""
        from pywinauto import keyboard

        # 1차: descendants로 깊이 탐색해서 더블클릭
        try:
            for ctrl_type in ["DataItem", "ListItem", "Row"]:
                try:
                    items = popup.descendants(control_type=ctrl_type)
                    if items:
                        items[0].double_click_input()
                        logger.info(f"{ctrl_type} 첫 번째 행 더블클릭 (총 {len(items)}행)")
                        return
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"descendants 탐색 실패: {e}")

        # 2차: children으로 시도
        try:
            for ctrl_type in ["DataGrid", "List", "Table"]:
                containers = popup.children(control_type=ctrl_type)
                if containers:
                    children = containers[0].children()
                    if children:
                        children[0].double_click_input()
                        logger.info(f"{ctrl_type} 첫 번째 행 더블클릭")
                        return
        except Exception as e:
            logger.debug(f"children 탐색 실패: {e}")

        # 3차 폴백: 키보드로 선택 (Tab→Down→Enter)
        logger.info("컨트롤 탐색 실패 → 키보드로 첫 번째 행 선택")
        keyboard.send_keys("{TAB}")
        time.sleep(0.1)
        keyboard.send_keys("{DOWN}")
        time.sleep(0.1)
        keyboard.send_keys("{ENTER}")
        time.sleep(0.3)

    def _double_click_first_in_window(self, window: Any) -> None:
        """윈도우 내 첫 번째 데이터 항목을 더블클릭한다."""
        try:
            # DataGrid → DataItem
            grids = window.children(control_type="DataGrid")
            if grids:
                items = grids[0].children(control_type="DataItem")
                if items:
                    items[0].double_click_input()
                    logger.debug("DataGrid 첫 번째 항목 더블클릭")
                    return

            # List → ListItem
            lists = window.children(control_type="List")
            if lists:
                list_items = lists[0].children(control_type="ListItem")
                if list_items:
                    list_items[0].double_click_input()
                    logger.debug("List 첫 번째 항목 더블클릭")
                    return

            # Table → Row
            tables = window.children(control_type="Table")
            if tables:
                rows = tables[0].children()
                if rows:
                    rows[0].double_click_input()
                    logger.debug("Table 첫 번째 행 더블클릭")
                    return

            logger.warning("팝업에서 데이터 항목을 찾을 수 없습니다")
        except Exception as e:
            logger.warning(f"팝업 항목 더블클릭 실패: {e}")

    def print_control_identifiers(self) -> str:
        """윈도우의 컨트롤 구조를 출력한다 (디버깅용)."""
        if not self._main_window:
            return "연결되지 않음"
        try:
            self._main_window.print_control_identifiers()
            return "콘솔 출력 확인"
        except Exception as e:
            return f"오류: {e}"
