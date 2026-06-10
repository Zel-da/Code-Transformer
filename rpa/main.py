"""
⚠ DEPRECATED — `rpa-ncr/` 가 현행.

이 `rpa/` 폴더는 초기 스켈레톤이고 캘리브레이션이 미완료입니다.
워크플로의 폼 입력 시퀀스가 전부 TODO 상태라 실제 ERP 입력이 안 됩니다.

실수로 운영에서 돌리는 걸 막기 위해 즉시 에러로 종료합니다.
실제 워커는 `rpa-ncr/main.py` 또는 `rpa-ncr/run_worker.py` 를 사용하세요.
"""

import sys


def main() -> None:
    sys.stderr.write(
        "[DEPRECATED] rpa/ 는 초기 스켈레톤입니다 (캘리브레이션 미완료).\n"
        "현행 RPA 워커는 rpa-ncr/ 입니다. 거기서 실행하세요.\n"
        "  cd rpa-ncr && python main.py\n",
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
