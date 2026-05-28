"""JSON 설정 로드/저장 유틸리티 (OCR_EU에서 포팅)."""
import json
from pathlib import Path
from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)


class ConfigLoader:
    """JSON 설정 파일을 로드하고 저장하는 클래스."""

    _cache: dict[str, Any] = {}

    @classmethod
    def load(cls, path: str | Path, use_cache: bool = True) -> dict[str, Any]:
        """JSON 설정 파일을 로드한다."""
        path = Path(path)
        key = str(path.resolve())

        if use_cache and key in cls._cache:
            return cls._cache[key]

        if not path.exists():
            logger.error(f"설정 파일을 찾을 수 없습니다: {path}")
            raise FileNotFoundError(f"설정 파일을 찾을 수 없습니다: {path}")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if use_cache:
            cls._cache[key] = data

        logger.debug(f"설정 파일 로드됨: {path}")
        return data

    @classmethod
    def save(cls, path: str | Path, data: dict[str, Any]) -> None:
        """설정을 JSON 파일로 저장한다."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

        key = str(path.resolve())
        cls._cache[key] = data
        logger.debug(f"설정 파일 저장됨: {path}")

    @classmethod
    def clear_cache(cls) -> None:
        """캐시를 초기화한다."""
        cls._cache.clear()

    @classmethod
    def get_nested(cls, data: dict, *keys: str, default: Any = None) -> Any:
        """중첩된 딕셔너리에서 값을 가져온다."""
        current = data
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key, default)
            else:
                return default
        return current
