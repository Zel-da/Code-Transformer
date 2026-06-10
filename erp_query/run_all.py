"""
일일 동기화 통합 러너: 4개 sync를 순차 실행, 결과 요약, 실패 시 알림.

각 sync는 독립 트랜잭션이라 한 단계 실패해도 나머지 시도. 끝에서 누적 결과로 통지.

사용 (run_sync.bat에서 호출):
    python run_all.py
종료 코드:
    0 = 전부 성공
    1 = 일부 또는 전부 실패 (실패 단계명을 stdout/알림에 포함)
"""

import os
import subprocess
import sys
import time

from notify import notify

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable  # venv python

# (이름, argv 추가 인자, 표시명)
STEPS = [
    ("sync_items.py",     ["--scope", "produced"],                                       "items"),
    ("sync_orders.py",    [],                                                            "orders"),
    ("sync_vendors.py",   ["--table", "B_BIZ_PARTNER",
                           "--cd-col", "BP_CD", "--nm-col", "BP_NM",
                           "--tax-col", "BP_RGST_NO", "--valid-col", "USAGE_FLAG"],      "vendors"),
    ("sync_shipments.py", [],                                                            "shipments"),
]


def run_step(script: str, extra: list[str], name: str) -> tuple[str, int, float, str]:
    """반환: (name, exit_code, elapsed_seconds, tail_text)"""
    t0 = time.perf_counter()
    proc = subprocess.run(
        [PY, os.path.join(HERE, script), *extra],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=HERE,
    )
    elapsed = time.perf_counter() - t0
    # stdout과 stderr 중 의미 있는 마지막 몇 줄
    out = (proc.stdout or "").strip().splitlines()[-3:]
    err = (proc.stderr or "").strip().splitlines()[-3:]
    tail = " | ".join(out + err)[:400]
    # 콘솔에도 그대로
    print(f"[run_all] === {name} === ({elapsed:.1f}s, exit={proc.returncode})")
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    return name, proc.returncode, elapsed, tail


def main() -> int:
    print(f"[run_all] start, python={PY}")
    results = [run_step(s, e, n) for s, e, n in STEPS]
    total = sum(r[2] for r in results)
    failures = [r for r in results if r[1] != 0]

    summary_lines = [f"{r[0]}: {('OK' if r[1]==0 else 'FAIL')} ({r[2]:.1f}s)" for r in results]
    print(f"[run_all] done in {total:.1f}s — {len(failures)} 실패")
    for line in summary_lines:
        print(f"  {line}")

    if failures:
        msg = "[ERP sync] 동기화 실패\n" + "\n".join(
            f"- {r[0]}: exit={r[1]} ({r[2]:.1f}s)\n  tail: {r[3]}"
            for r in failures
        ) + f"\n전체 소요: {total:.1f}s"
        notify(msg, level="error")
        return 1

    # 성공이면 알림 안 보냄 (노이즈 방지). 필요시 ERP_NOTIFY_SUCCESS=1 환경변수로 켤 수 있음.
    if os.getenv("ERP_NOTIFY_SUCCESS") == "1":
        notify("[ERP sync] 정상 완료\n" + "\n".join(summary_lines), level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
