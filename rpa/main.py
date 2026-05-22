"""
NCR RPA 메인 진입점.

실행 방법:
    python main.py [--once] [--report-id N]

옵션:
    --once        단일 실행 후 종료 (기본: poll_interval_seconds 주기로 반복)
    --report-id N 특정 보고서 ID만 처리 (테스트용)
    --dry-run     API에서 목록만 조회하고 ERP 입력은 건너뜀
"""

import argparse
import logging
import os
import sys
import threading
import time

from dotenv import load_dotenv

load_dotenv()

# ------------------------------------------------------------------
# 로깅 설정
# ------------------------------------------------------------------

logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("rpa.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("main")


def _load_settings() -> dict:
    import json
    settings_path = os.path.join(os.path.dirname(__file__), "config", "settings.json")
    with open(settings_path, encoding="utf-8") as f:
        return json.load(f)


def run_once(
    report_id: int | None = None,
    dry_run: bool = False,
    stop_event: threading.Event | None = None,
) -> dict:
    """
    PENDING 보고서를 한 번 처리한다.
    Returns: {"processed": int, "completed": int, "failed": int}
    """
    from api_client import NcrApiClient
    from workflows.ncr_workflow import NcrWorkflow

    settings = _load_settings()
    poll_interval = settings["api"].get("poll_interval_seconds", 60)

    client = NcrApiClient(base_url=settings["api"]["base_url"])

    if report_id is not None:
        report = client.get_report(report_id)
        if not report:
            logger.error("보고서 #%d 없음", report_id)
            return {"processed": 0, "completed": 0, "failed": 0}
        reports = [report]
    else:
        reports = client.get_pending_reports()

    if not reports:
        logger.info("처리할 보고서 없음")
        return {"processed": 0, "completed": 0, "failed": 0}

    logger.info("처리 대상: %d건", len(reports))

    if dry_run:
        logger.info("[DRY-RUN] ERP 입력 건너뜀")
        for r in reports:
            logger.info("  - #%s %s", r.get("id"), r.get("reportNo", ""))
        return {"processed": len(reports), "completed": 0, "failed": 0}

    # UNIERP 실행 + 로그인
    from workflows.login_workflow import LoginWorkflow
    login = LoginWorkflow(settings)
    try:
        logger.info("UNIERP 실행 및 로그인 확인 중...")
        ctrl = login.ensure_ready()
        logger.info("UNIERP 준비 완료")
    except Exception as e:
        logger.error("UNIERP 로그인 실패: %s", e)
        return {"processed": 0, "completed": 0, "failed": 0, "error": str(e)}

    wf = NcrWorkflow(stop_event=stop_event)
    wf.connect_with_controller(ctrl)

    completed = 0
    failed = 0

    try:
        for report in reports:
            if stop_event and stop_event.is_set():
                logger.info("중단 신호 — 남은 %d건 건너뜀", len(reports) - completed - failed)
                break

            result = wf.run_report(report)

            if result["ok"]:
                client.mark_completed(report["id"])
                completed += 1
            else:
                client.mark_failed(report["id"], result["error"] or "알 수 없는 오류")
                failed += 1

    finally:
        wf.disconnect()

    logger.info("완료: processed=%d completed=%d failed=%d", len(reports), completed, failed)
    return {"processed": len(reports), "completed": completed, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description="NCR RPA 클라이언트")
    parser.add_argument("--once", action="store_true", help="단일 실행 후 종료")
    parser.add_argument("--report-id", type=int, default=None, help="특정 보고서 ID만 처리")
    parser.add_argument("--dry-run", action="store_true", help="ERP 입력 없이 목록만 조회")
    parser.add_argument("--interval", type=int, default=None, help="폴링 간격(초) 오버라이드")
    args = parser.parse_args()

    settings = _load_settings()
    poll_interval = args.interval or settings["api"].get("poll_interval_seconds", 60)

    stop_event = threading.Event()

    # Ctrl-C 처리
    import signal
    def _handle_sigint(sig, frame):
        logger.info("Ctrl-C 감지 — 정지 중...")
        stop_event.set()
    signal.signal(signal.SIGINT, _handle_sigint)

    if args.once or args.report_id is not None:
        run_once(
            report_id=args.report_id,
            dry_run=args.dry_run,
            stop_event=stop_event,
        )
        return

    logger.info("폴링 모드 시작 (간격: %d초)", poll_interval)
    while not stop_event.is_set():
        try:
            run_once(dry_run=args.dry_run, stop_event=stop_event)
        except Exception as e:
            logger.exception("폴링 사이클 오류: %s", e)

        logger.info("%d초 후 다음 폴링...", poll_interval)
        stop_event.wait(poll_interval)

    logger.info("RPA 종료")


if __name__ == "__main__":
    main()
