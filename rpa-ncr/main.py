"""NCR → UNIERP RPA 자동 입력 프로그램 진입점 (웹 UI)."""
import ctypes

# DPI awareness 조기 설정 — pywinauto import 전에 물리 픽셀 좌표를 보장
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except (OSError, AttributeError):
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except (OSError, AttributeError):
        pass

import socket
import sys
import webbrowser
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
project_root = Path(__file__).resolve().parent
if getattr(sys, "frozen", False):
    project_root = Path(sys.executable).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from src.utils.config_loader import ConfigLoader
from src.utils.file_utils import get_config_dir, get_log_dir
from src.utils.logger import setup_logger


def _show_error(message: str) -> None:
    """콘솔이 없을 때(windowed exe) Windows 메시지 박스로 에러를 표시한다."""
    try:
        ctypes.windll.user32.MessageBoxW(0, message, "RPA_NCR 오류", 0x10)
    except Exception:
        pass


def _find_free_port(host: str, start_port: int, max_tries: int = 20) -> int:
    """start_port부터 순회하며 사용 가능한 포트를 반환한다."""
    for offset in range(max_tries):
        port = start_port + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"포트 {start_port}~{start_port + max_tries - 1} 모두 사용 중입니다.")


def main():
    """애플리케이션 메인 함수."""
    settings = ConfigLoader.load(get_config_dir() / "settings.json")

    log_cfg = settings.get("logging", {})
    logger = setup_logger(
        name="rpa_ncr",
        log_dir=str(get_log_dir()),
        level=log_cfg.get("level", "INFO"),
        max_file_size_mb=log_cfg.get("max_file_size_mb", 10),
        backup_count=log_cfg.get("backup_count", 5),
    )

    logger.info("=== NCR → UNIERP RPA 자동 입력 프로그램 시작 ===")

    try:
        import uvicorn

        from src.web.app import create_app

        web_cfg = settings.get("web", {})
        host = web_cfg.get("host", "127.0.0.1")
        preferred_port = web_cfg.get("port", 8010)

        port = _find_free_port(host, preferred_port)
        if port != preferred_port:
            logger.info(f"포트 {preferred_port} 사용 중 → {port} 사용")

        app = create_app(settings)

        # windowed exe에서 sys.stdout이 None일 수 있음
        if sys.stdout is None:
            import io
            sys.stdout = io.StringIO()
            sys.stderr = io.StringIO()

        print("=" * 50)
        print("  NCR → UNIERP RPA 자동 입력 서버")
        print(f"  http://{host}:{port}")
        print()
        print("  ※ 이 창을 닫으면 서버가 종료됩니다")
        print("=" * 50)

        webbrowser.open(f"http://{host}:{port}")
        uvicorn.run(app, host=host, port=port)
    except Exception as e:
        logger.critical(f"애플리케이션 실행 실패: {e}", exc_info=True)
        _show_error(f"애플리케이션 실행 실패:\n{e}\n\n로그 파일을 확인하세요:\n{get_log_dir()}")
        sys.exit(1)
    finally:
        logger.info("=== 프로그램 종료 ===")


if __name__ == "__main__":
    main()
