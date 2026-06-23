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


def _safe_write(stream, text: str) -> None:
    """stdout/stderr 가 cp949 등 제한된 인코딩이어도 라틴 확장 문자(ǰ 등)에서 죽지 않게.
    PYTHONIOENCODING=utf-8 이면 그냥 write 가 통하지만, 누락된 환경에서도 동작."""
    try:
        stream.write(text)
    except UnicodeEncodeError:
        enc = getattr(stream, "encoding", None) or "utf-8"
        stream.write(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def run_step(script: str, extra: list[str], name: str) -> tuple[str, int, float, str]:
    """반환: (name, exit_code, elapsed_seconds, tail_text). 어떤 예외도 단계 실패로 흡수."""
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            [PY, os.path.join(HERE, script), *extra],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            cwd=HERE,
        )
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        print(f"[run_all] === {name} === ({elapsed:.1f}s, exit=?) — 실행 자체 실패: {exc!r}")
        return name, 99, elapsed, f"spawn error: {exc!r}"

    elapsed = time.perf_counter() - t0
    out = (proc.stdout or "").strip().splitlines()[-3:]
    err = (proc.stderr or "").strip().splitlines()[-3:]
    tail = " | ".join(out + err)[:400]

    print(f"[run_all] === {name} === ({elapsed:.1f}s, exit={proc.returncode})")
    if proc.stdout:
        _safe_write(sys.stdout, proc.stdout)
    if proc.stderr:
        _safe_write(sys.stderr, proc.stderr)
    return name, proc.returncode, elapsed, tail


def main() -> int:
    print(f"[run_all] start, python={PY}")
    # 명시적 루프 — list comprehension 안에서 예외가 터지면 그 즉시 모든 결과가 날아가서
    # notify 도 호출 안 되는 사고가 났었음(2026-06-10~06-23 13일간 silent 실패).
    results: list[tuple[str, int, float, str]] = []
    for s, e, n in STEPS:
        try:
            results.append(run_step(s, e, n))
        except Exception as exc:
            print(f"[run_all] === {n} === 단계 전체 예외: {exc!r}")
            results.append((n, 98, 0.0, f"step exception: {exc!r}"))
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
