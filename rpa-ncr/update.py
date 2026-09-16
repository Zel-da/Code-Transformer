"""rpa-ncr 자동 업데이트 CLI (얇은 래퍼).

사용법:
    python update.py                 # 확인 + 새 버전 있으면 적용
    python update.py --check         # 확인만 (exit code 1 = 새 버전 있음)
    python update.py --force         # 최신이어도 강제 재다운로드

실제 로직은 src/utils/updater.py 참조 (git pull 우선 → archive.zip 폴백,
백업/롤백, SSL fallback, 보존 규칙).

시작.bat 이 부팅 시 이 스크립트를 호출한다 (.no_auto_update 파일 있으면 스킵).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    # 프로젝트 루트 = 이 스크립트 옆
    root = Path(__file__).resolve().parent
    # src/ 를 import path 에 추가 (src.utils.updater 임포트용)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    # 이 스크립트 위치를 cwd 로 강제 (상대 경로 이슈 방지)
    os.chdir(root)

    from src.utils.updater import run  # 지연 임포트

    args = sys.argv[1:]
    check_only = "--check" in args
    force = "--force" in args

    return run(root, check_only=check_only, force=force)


if __name__ == "__main__":
    sys.exit(main())
