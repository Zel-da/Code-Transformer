"""NCR RPA 헤드리스 워커 (웹 UI 없이 CLI로 실행/테스트).

사용 예:
    python run_worker.py --dry-run                  # PENDING 조회 + 입력 시퀀스 출력 (ERP 미연결)
    python run_worker.py --source db --dry-run       # DB 소스로 드라이런
    python run_worker.py --report-id 42 --dry-run     # 특정 보고 1건만 미리보기
    python run_worker.py --report-id 42 --mark-only completed   # ERP 없이 상태 콜백만 시험
    python run_worker.py --once                       # PENDING 일괄 처리 후 종료 (실 ERP 필요)
    python run_worker.py --poll                        # 주기 폴링 무인 실행 (실 ERP 필요)
"""
import argparse
import sys
import time
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.data_source.base import get_source
from src.data_source.report_model import NcrReport
from src.utils.config_loader import ConfigLoader
from src.utils.file_utils import get_config_dir, get_log_dir
from src.utils.logger import setup_logger

logger = None  # main에서 설정


def _load_settings(args) -> dict:
    settings = ConfigLoader.load(get_config_dir() / "settings.json")
    if args.source:
        settings["source"] = args.source
    return settings


def _preview_sequence(report: NcrReport, settings: dict) -> None:
    """field_mapping 기반 입력 시퀀스를 빌드해 출력한다 (RPA 레이어가 있을 때만)."""
    try:
        from src.rpa.ncr_field_map import NcrReportFieldMap
    except ImportError:
        logger.info("  (RPA 레이어 미설치 — 시퀀스 미리보기 생략, 원본 필드만 표시)")
        for k, v in report.to_dict().items():
            logger.info("    %-16s = %r", k, v)
        return

    mapping = ConfigLoader.load(get_config_dir() / "field_mapping.json")
    field_map = NcrReportFieldMap(mapping)
    sequence = field_map.build_sequence(report)
    logger.info("  [입력 시퀀스] %d 스텝", len(sequence.steps))
    for i, step in enumerate(sequence.steps, 1):
        logger.info(
            "    [%2d] %-14s = %-20r method=%-18s tab_after=%s",
            i, step.field_name, step.value, step.method.value, step.tab_after,
        )


def _run_dry(source, settings, report_id: int | None) -> None:
    if report_id is not None:
        report = source.get_report(report_id)
        reports = [report] if report else []
    else:
        reports = source.fetch_pending()

    if not reports:
        logger.info("처리할 보고 없음")
        return

    logger.info("[DRY-RUN] %d건 — ERP 입력/상태변경 없음", len(reports))
    for report in reports:
        logger.info("===== 보고 #%s (%s) =====", report.id, report.get_str("itemCode"))
        _preview_sequence(report, settings)


def _run_mark_only(source, report_id: int, status: str) -> None:
    if status == "processing":
        source.mark_processing(report_id)
    elif status == "completed":
        source.mark_completed(report_id)
    elif status == "failed":
        source.mark_failed(report_id, "run_worker --mark-only failed (수동 시험)")
    logger.info("보고 #%d 상태 콜백(%s) 완료", report_id, status)


def _process_batch(source, settings, report_id: int | None) -> dict:
    """실 ERP 입력 배치. RPA 레이어(Phase 4) 필요."""
    from src.rpa.ncr_connector import NCRConnector
    from src.rpa.window_controller import FocusLostError

    if report_id is not None:
        report = source.get_report(report_id)
        reports = [report] if report else []
    else:
        reports = source.fetch_pending()

    if not reports:
        logger.info("처리할 보고 없음")
        return {"processed": 0, "completed": 0, "failed": 0}

    connector = NCRConnector(settings)
    if not connector.launch_and_connect():
        logger.error("ERP 연결 실패 — 배치 중단")
        return {"processed": 0, "completed": 0, "failed": 0, "error": "ERP 연결 실패"}

    completed = failed = 0
    try:
        for report in reports:
            source.mark_processing(report.id)
            try:
                connector.input_report(report)
            except FocusLostError as e:
                logger.error("포커스 이탈 — 배치 중단: %s", e)
                source.mark_failed(report.id, f"focus lost: {e}")
                break
            except Exception as e:
                logger.exception("보고 #%s 입력 실패: %s", report.id, e)
                source.mark_failed(report.id, str(e))
                failed += 1
                continue
            source.mark_completed(report.id)
            completed += 1
    finally:
        connector.disconnect()

    logger.info("배치 완료: processed=%d completed=%d failed=%d", len(reports), completed, failed)
    return {"processed": len(reports), "completed": completed, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description="NCR RPA 헤드리스 워커")
    parser.add_argument("--source", choices=["api", "db"], default=None, help="데이터 소스 오버라이드")
    parser.add_argument("--once", action="store_true", help="PENDING 일괄 처리 후 종료")
    parser.add_argument("--poll", action="store_true", help="주기 폴링 무인 실행")
    parser.add_argument("--dry-run", action="store_true", help="ERP 미연결, 시퀀스만 출력")
    parser.add_argument("--report-id", type=int, default=None, help="특정 보고 1건만")
    parser.add_argument("--mark-only", choices=["processing", "completed", "failed"], default=None,
                        help="ERP 없이 상태 콜백만 시험 (--report-id 필요)")
    args = parser.parse_args()

    settings = _load_settings(args)

    global logger
    log_cfg = settings.get("logging", {})
    logger = setup_logger(
        name="rpa_ncr",
        log_dir=str(get_log_dir()),
        level=log_cfg.get("level", "INFO"),
        max_file_size_mb=log_cfg.get("max_file_size_mb", 10),
        backup_count=log_cfg.get("backup_count", 5),
    )

    source = get_source(settings)
    ok, msg = source.health()
    logger.info("소스=%s · %s", settings.get("source"), msg)
    if not ok and not args.mark_only:
        logger.error("데이터 소스에 연결할 수 없습니다. settings.json의 source/api/db 설정을 확인하세요.")
        sys.exit(1)

    if args.mark_only:
        if args.report_id is None:
            parser.error("--mark-only 는 --report-id 가 필요합니다")
        _run_mark_only(source, args.report_id, args.mark_only)
        return

    if args.dry_run:
        _run_dry(source, settings, args.report_id)
        return

    if args.poll:
        interval = settings.get("api", {}).get("poll_interval_seconds", 60)
        logger.info("폴링 모드 시작 (간격 %d초) — Ctrl-C로 종료", interval)
        try:
            while True:
                try:
                    _process_batch(source, settings, None)
                except Exception as e:
                    logger.exception("폴링 사이클 오류: %s", e)
                time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("폴링 종료")
        return

    # 기본/--once: 1회 배치
    _process_batch(source, settings, args.report_id)


if __name__ == "__main__":
    main()
