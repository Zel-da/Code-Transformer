"""파일 경로 유틸리티 (OCR_EU에서 포팅, NCR용으로 정리)."""
import sys
from pathlib import Path


def get_project_root() -> Path:
    """프로젝트 루트 디렉토리를 반환한다."""
    if getattr(sys, "frozen", False):
        # PyInstaller 번들: exe 옆에 config/, PRIVATE/ 등이 위치
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


def get_config_dir() -> Path:
    """설정 디렉토리 경로를 반환한다."""
    root = get_project_root()
    # PyInstaller --collect 시 _internal/config/ 에 배치됨
    internal = root / "_internal" / "config"
    if internal.is_dir():
        return internal
    return root / "config"


def get_log_dir() -> Path:
    """로그 디렉토리 경로를 반환하고 없으면 생성한다."""
    log_dir = get_project_root() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def get_private_dir() -> Path:
    """PRIVATE 디렉토리 경로를 반환한다 (Neon DB URL 등 비밀 설정).

    PyInstaller 번들에서는 exe 옆 PRIVATE/ 를 우선 사용한다.
    """
    return get_project_root() / "PRIVATE"


def ensure_dir(path: str | Path) -> Path:
    """디렉토리가 존재하지 않으면 생성한다."""
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path
