"""
UNIERP 실행 + 로그인 워크플로.

흐름:
  1. UNIERP 프로세스가 이미 실행 중인지 확인
  2. 실행 중이면 창에 연결, 아니면 exe 실행 후 창 대기
  3. 로그인 창 감지 → 아이디/비밀번호 입력 → 로그인
  4. 메인 창 로딩 대기

사용:
  lw = LoginWorkflow(settings)
  ctrl = lw.ensure_ready()   # WindowController 반환 (이미 로그인된 상태)
"""

import logging
import os
import subprocess
import time
from typing import Optional

import psutil
import pyperclip
import keyboard as kb
from pywinauto import Application

from core.window_controller import WindowController
from core.exceptions import WindowNotFoundError

logger = logging.getLogger(__name__)


class LoginWorkflow:
    def __init__(self, settings: dict):
        """
        Args:
            settings: settings.json 전체 딕셔너리
        """
        cfg = settings.get("launch", {})
        erp_cfg = settings.get("erp", {})

        self._exe_path: str = os.getenv("UNIERP_EXE_PATH") or cfg.get("exe_path", "")
        self._exe_name: str = cfg.get("exe_name", "UNIERP.exe")          # 프로세스 이름 (실행 중 확인용)
        self._startup_timeout: float = cfg.get("startup_timeout_sec", 20.0)
        self._login_title_pattern: str = cfg.get("login_window_title", ".*로그인.*")
        self._main_title_pattern: str = erp_cfg.get("window_title_pattern", ".*UNIERP.*")
        self._ref_w: int = erp_cfg.get("ref_w", 1920)
        self._ref_h: int = erp_cfg.get("ref_h", 1080)

        self._username: str = os.getenv("UNIERP_USERNAME") or cfg.get("username", "")
        self._password: str = os.getenv("UNIERP_PASSWORD") or cfg.get("password", "")

        # 로그인 창 좌표 (기준 해상도 기준, 캘리브레이션 후 채울 것)
        login_coords = settings.get("login_coords", {})
        self._coord_id_field   = tuple(login_coords.get("id_field",       [0, 0]))   # TODO
        self._coord_pw_field   = tuple(login_coords.get("pw_field",       [0, 0]))   # TODO
        self._coord_login_btn  = tuple(login_coords.get("login_btn",      [0, 0]))   # TODO

        self._timing = settings.get("timing", {})

    # ------------------------------------------------------------------
    # 메인 진입점
    # ------------------------------------------------------------------

    def ensure_ready(self) -> WindowController:
        """
        UNIERP가 실행·로그인 완료된 상태의 WindowController를 반환한다.
        - 이미 실행 중이면 연결만
        - 실행 중이 아니면 실행 → 로그인
        """
        if self._is_running():
            logger.info("UNIERP 이미 실행 중 — 기존 창에 연결")
            ctrl = self._connect_main()
            return ctrl

        logger.info("UNIERP 실행 시작: %s", self._exe_path)
        self._launch()
        self._wait_for_login_window()
        self._do_login()
        ctrl = self._wait_for_main_window()
        return ctrl

    # ------------------------------------------------------------------
    # 1. 실행 중 여부 확인
    # ------------------------------------------------------------------

    def _is_running(self) -> bool:
        """exe_name 프로세스가 실행 중인지 확인한다."""
        target = self._exe_name.lower()
        for proc in psutil.process_iter(["name"]):
            try:
                if proc.info["name"] and proc.info["name"].lower() == target:
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return False

    # ------------------------------------------------------------------
    # 2. 실행
    # ------------------------------------------------------------------

    def _launch(self) -> None:
        """UNIERP 실행 파일을 실행한다."""
        if not self._exe_path:
            raise WindowNotFoundError(
                "UNIERP 실행 경로가 설정되지 않았습니다. "
                ".env의 UNIERP_EXE_PATH 또는 settings.json의 launch.exe_path를 설정하세요."
            )
        if not os.path.isfile(self._exe_path):
            raise FileNotFoundError(f"UNIERP 실행 파일을 찾을 수 없습니다: {self._exe_path}")

        subprocess.Popen(
            [self._exe_path],
            cwd=os.path.dirname(self._exe_path),
        )
        logger.info("UNIERP 실행 완료, 로그인 창 대기 중...")

    # ------------------------------------------------------------------
    # 3. 로그인 창 대기
    # ------------------------------------------------------------------

    def _find_login_window(self):
        """로그인 창을 찾아 반환한다. 없으면 None."""
        try:
            app = Application(backend="uia").connect(
                title_re=self._login_title_pattern, timeout=1
            )
            win = app.window(title_re=self._login_title_pattern)
            if win.exists():
                return win
        except Exception:
            pass
        return None

    def _wait_for_login_window(self, timeout: Optional[float] = None):
        """로그인 창이 나타날 때까지 대기한다."""
        timeout = timeout or self._startup_timeout
        logger.info("로그인 창 대기 (최대 %.0f초)...", timeout)
        end = time.time() + timeout
        while time.time() < end:
            win = self._find_login_window()
            if win:
                logger.info("로그인 창 감지됨")
                time.sleep(0.5)   # 창 완전 렌더링 대기
                return win
            time.sleep(0.5)
        raise WindowNotFoundError(
            f"UNIERP 로그인 창이 {timeout:.0f}초 내에 나타나지 않았습니다."
        )

    # ------------------------------------------------------------------
    # 4. 로그인
    # ------------------------------------------------------------------

    def _do_login(self) -> None:
        """
        로그인 창에 아이디/비밀번호를 입력하고 로그인한다.

        좌표 방식(기본)과 Tab 방식 중 하나를 선택한다.
        현재는 Tab 방식(좌표 캘리브레이션 불필요)으로 구현.
        좌표 방식으로 전환하려면 _coord_id_field / _coord_pw_field / _coord_login_btn을 채울 것.
        """
        logger.info("로그인 시도 — 사용자: %s", self._username)

        use_coords = all(
            c != (0, 0) for c in [self._coord_id_field, self._coord_pw_field]
        )

        if use_coords:
            self._login_with_coords()
        else:
            self._login_with_tab()

        logger.info("로그인 입력 완료 — 메인 창 대기 중")

    def _login_with_tab(self) -> None:
        """
        Tab 순서로 아이디 → 비밀번호 → Enter 입력.
        폼 첫 포커스가 아이디 필드에 있다고 가정.
        TODO: 실제 폼의 Tab 순서 확인 후 tab_count 조정
        """
        time.sleep(0.3)

        # 아이디 입력
        pyperclip.copy(self._username)
        kb.send("ctrl+v")
        time.sleep(0.1)

        # 비밀번호 필드로 이동 (Tab 1회 — TODO: 실제 폼에 맞게 조정)
        kb.send("tab")
        time.sleep(0.1)

        # 비밀번호 입력
        pyperclip.copy(self._password)
        kb.send("ctrl+v")
        time.sleep(0.1)

        # 로그인 (Enter)
        kb.send("enter")

    def _login_with_coords(self) -> None:
        """
        좌표 기반 로그인 (캘리브레이션 완료 후 사용).
        login_coords 섹션이 채워진 경우 이 경로로 실행된다.
        """
        import pywinauto.mouse as pymouse

        def click(ref_xy):
            # 로그인 창은 고정 크기일 수 있으므로 절대 좌표 직접 사용
            # 창 상대 비례 좌표가 필요하면 WindowController.abs_coords 활용
            pymouse.click(coords=(int(ref_xy[0]), int(ref_xy[1])))
            time.sleep(0.1)

        click(self._coord_id_field)
        pyperclip.copy(self._username)
        kb.send("ctrl+v")
        time.sleep(0.1)

        click(self._coord_pw_field)
        pyperclip.copy(self._password)
        kb.send("ctrl+v")
        time.sleep(0.1)

        click(self._coord_login_btn)

    # ------------------------------------------------------------------
    # 5. 메인 창 대기 + 연결
    # ------------------------------------------------------------------

    def _wait_for_main_window(self, timeout: float = 30.0) -> WindowController:
        """로그인 후 메인 창이 열릴 때까지 대기하고 WindowController를 반환한다."""
        logger.info("메인 창 대기 (최대 %.0f초)...", timeout)
        end = time.time() + timeout
        while time.time() < end:
            try:
                app = Application(backend="uia").connect(
                    title_re=self._main_title_pattern, timeout=1
                )
                win = app.window(title_re=self._main_title_pattern)
                if win.exists():
                    logger.info("UNIERP 메인 창 확인 — 로그인 완료")
                    ctrl = WindowController(self._main_title_pattern, self._ref_w, self._ref_h)
                    ctrl.connect(timeout=10)
                    ctrl.ensure_maximized()
                    return ctrl
            except Exception:
                pass
            time.sleep(1.0)

        raise WindowNotFoundError(
            f"로그인 후 메인 창이 {timeout:.0f}초 내에 나타나지 않았습니다. "
            "자격증명이 올바른지 확인하세요."
        )

    def _connect_main(self) -> WindowController:
        """이미 실행 중인 UNIERP 메인 창에 연결한다."""
        ctrl = WindowController(self._main_title_pattern, self._ref_w, self._ref_h)
        ctrl.connect(timeout=10)
        ctrl.ensure_maximized()
        return ctrl
