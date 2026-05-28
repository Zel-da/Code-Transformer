"""로깅 설정 모듈 (OCR_EU에서 포팅, 기본 로거명 rpa_ncr)."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logger(
    name: str = "rpa_ncr",
    log_dir: str = "logs",
    level: str = "INFO",
    max_file_size_mb: int = 10,
    backup_count: int = 5,
) -> logging.Logger:
    """애플리케이션 로거를 설정하고 반환한다.

    Args:
        name: 로거 이름
        log_dir: 로그 파일 저장 디렉토리
        level: 로깅 레벨 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        max_file_size_mb: 로그 파일 최대 크기 (MB)
        backup_count: 백업 로그 파일 수

    Returns:
        설정된 Logger 인스턴스
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger

    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 콘솔 핸들러
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # 파일 핸들러 (모든 모듈 로그를 단일 rpa_ncr.log로 모은다)
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        log_path / "rpa_ncr.log",
        maxBytes=max_file_size_mb * 1024 * 1024,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def get_logger(name: str = "rpa_ncr") -> logging.Logger:
    """모듈 로거를 반환한다.

    모든 모듈 로거를 최상위 'rpa_ncr' 로거의 자식으로 만들어 단일 로그
    파일/콘솔로 전파(propagate)시킨다. 최상위 로거는 main.py 또는 최초
    호출 시 setup_logger로 핸들러가 구성된다.
    """
    if name == "rpa_ncr":
        logger = logging.getLogger(name)
        if not logger.handlers:
            return setup_logger(name)
        return logger

    # 최상위 앱 로거 보장 (핸들러가 없으면 기본 설정)
    root = logging.getLogger("rpa_ncr")
    if not root.handlers:
        setup_logger("rpa_ncr")

    short = name.rsplit(".", 1)[-1]
    child = root.getChild(short)  # 'rpa_ncr.<module>' → root로 전파
    return child
