"""FastAPI 웹 애플리케이션 — 라우트 + WebSocket (NCR → UNIERP RPA)."""
import asyncio
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from src.data_source.base import get_source
from src.utils.config_loader import ConfigLoader
from src.utils.file_utils import get_config_dir
from src.utils.logger import get_logger
from src.web.schemas import ErpStartRequest, MessageResponse, SourceUpdate, StatusResponse
from src.web.state import AppState

logger = get_logger(__name__)


def _web_dir() -> Path:
    """PyInstaller 번들/소스 양쪽에서 src/web 디렉토리를 반환한다."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "src" / "web"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


WEB_DIR = _web_dir()


_ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]", "::1"})
_MUTATING_METHODS = frozenset({"PUT", "POST", "PATCH", "DELETE"})


def create_app(settings: dict[str, Any]) -> FastAPI:
    """FastAPI 앱을 생성하고 반환한다."""
    app = FastAPI(title="NCR → UNIERP RPA 자동 입력")
    state = AppState(settings)

    # ── 로컬 전용 방어: 상태변경 요청은 Host 헤더가 로컬이어야 함 ──
    # 이 앱은 127.0.0.1 바인딩이 전제(main.py) 이지만, DNS rebinding 계열
    # 공격/오조작 시 브라우저가 실제 호스트명으로 요청을 보낼 수 있으므로
    # PUT/POST/PATCH/DELETE 에 한해 Host 헤더의 hostname 검증. GET 은 통과.
    @app.middleware("http")
    async def _host_guard(request: Request, call_next):
        if request.method in _MUTATING_METHODS:
            host_hdr = request.headers.get("host", "")
            hostname = host_hdr.rsplit(":", 1)[0] if host_hdr else ""
            if hostname not in _ALLOWED_HOSTS:
                return JSONResponse(
                    {"error": f"허용되지 않은 Host: {host_hdr!r} (로컬 전용)"},
                    status_code=400,
                )
        return await call_next(request)

    app.mount("/static", StaticFiles(directory=str(WEB_DIR / "static")), name="static")
    templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))
    # Python 3.13 + 일부 Jinja2 빌드의 LRUCache 키 해싱 충돌 회피 — 캐시 비활성화
    templates.env.cache = None

    def _save_settings() -> None:
        ConfigLoader.save(str(get_config_dir() / "settings.json"), settings)

    # ── 페이지 ──

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        # starlette 1.x: TemplateResponse(request, name) — request가 첫 인자
        return templates.TemplateResponse(request, "index.html")

    @app.get("/api/status")
    async def status():
        return StatusResponse(
            fetching=state.fetching,
            report_count=len(state.reports),
            erp_running=state.erp_running,
            error=state.fetch_error,
        )

    # ── 데이터 소스 ──

    @app.get("/api/source")
    async def get_source_cfg():
        api_cfg = settings.get("api", {})
        db_cfg = settings.get("db", {})
        return {
            "source": settings.get("source", "api"),
            "api_base_url": api_cfg.get("base_url", ""),
            "db_configured": bool(db_cfg.get("database_url")),
        }

    @app.put("/api/source")
    async def set_source_cfg(update: SourceUpdate):
        if update.source not in ("api", "db"):
            return JSONResponse({"error": "source 는 'api' 또는 'db' 여야 합니다."}, status_code=400)
        settings["source"] = update.source
        try:
            _save_settings()
        except Exception as e:
            return JSONResponse({"error": f"저장 실패: {e}"}, status_code=500)
        return MessageResponse(message=f"데이터 소스 변경: {update.source}")

    @app.post("/api/source/test")
    async def test_source():
        try:
            ok, msg = get_source(settings).health()
            return {"ok": ok, "message": msg}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    # ── 보고 조회 ──

    @app.post("/api/reports/fetch")
    async def fetch_reports():
        if state.fetching:
            return JSONResponse({"error": "이미 조회 중입니다."}, status_code=409)
        state.fetching = True
        state.fetch_error = ""
        loop = asyncio.get_event_loop()

        def worker():
            try:
                source = get_source(settings)
                reports = source.fetch_pending()
                state.reports = reports
                state.erp_queue = [
                    {
                        "index": i,
                        "id": r.id,
                        "item_code": r.get_str("itemCode"),
                        "status": "대기",
                        "progress": "0%",
                    }
                    for i, r in enumerate(reports)
                ]
                state.broadcast_progress_sync(loop, {
                    "type": "fetched",
                    "count": len(reports),
                    "queue": state.erp_queue,
                })
            except Exception as e:
                logger.error("보고 조회 실패: %s", e, exc_info=True)
                state.fetch_error = str(e)
                state.broadcast_progress_sync(loop, {"type": "error", "message": str(e)})
            finally:
                state.fetching = False

        threading.Thread(target=worker, daemon=True).start()
        return MessageResponse(message="보고 조회 시작")

    @app.get("/api/reports")
    async def list_reports():
        return [
            {
                "index": i,
                "id": r.id,
                "itemCode": r.get_str("itemCode"),
                "modelName": r.get_str("modelName"),
                "defectType": r.get_str("defectType"),
                "syncStatus": r.get_str("syncStatus"),
            }
            for i, r in enumerate(state.reports)
        ]

    @app.get("/api/reports/{index}")
    async def get_report_detail(index: int):
        if index < 0 or index >= len(state.reports):
            return JSONResponse({"error": "보고를 찾을 수 없습니다."}, status_code=404)
        return state.reports[index].to_dict()

    # ── 초기 설정 점검 ──

    @app.get("/api/setup/check")
    async def setup_check():
        items: list[dict[str, Any]] = []
        erp_cfg = settings.get("erp", {})
        config_dir = get_config_dir()

        # 1. ERP 실행 경로 (필수)
        launch_path = erp_cfg.get("launch_path", "")
        if launch_path and Path(launch_path).exists():
            items.append({"id": "erp_launch_path", "label": "ERP 실행 경로",
                          "category": "required", "status": "ok", "message": "경로 확인됨",
                          "hint": "", "action": ""})
        else:
            items.append({"id": "erp_launch_path", "label": "ERP 실행 경로",
                          "category": "required", "status": "error",
                          "message": f"경로 없음/미존재: {launch_path or '(미설정)'}",
                          "hint": "UNIERP 바로가기(.appref-ms 또는 .exe) 경로를 등록하세요.",
                          "action": "tab-erp"})

        # 2. ERP 로그인 비밀번호 (필수)
        if erp_cfg.get("login_pw"):
            items.append({"id": "erp_login_pw", "label": "ERP 로그인 비밀번호",
                          "category": "required", "status": "ok", "message": "등록됨",
                          "hint": "", "action": ""})
        else:
            items.append({"id": "erp_login_pw", "label": "ERP 로그인 비밀번호",
                          "category": "required", "status": "error", "message": "미등록",
                          "hint": "ERP 자동 로그인을 위해 비밀번호를 등록하세요.", "action": "tab-erp"})

        # 3. 필드 매핑 캘리브레이션 (필수)
        try:
            mapping = ConfigLoader.load(config_dir / "field_mapping.json", use_cache=False)
            todo = [f.get("label", f.get("ncr_key", "?"))
                    for f in mapping.get("header_fields", [])
                    if str(f.get("erp_field", "")).upper() == "TODO"]
            if todo:
                items.append({"id": "field_mapping", "label": "필드 매핑 캘리브레이션",
                              "category": "required", "status": "error",
                              "message": f"미캘리브레이션 {len(todo)}개: {', '.join(todo[:5])}",
                              "hint": "field_mapping.json의 erp_field를 실 ERP 폼에 맞춰 채우세요(README 캘리브레이션 체크리스트).",
                              "action": ""})
            else:
                items.append({"id": "field_mapping", "label": "필드 매핑 캘리브레이션",
                              "category": "required", "status": "ok", "message": "완료",
                              "hint": "", "action": ""})
        except Exception as e:
            items.append({"id": "field_mapping", "label": "필드 매핑 캘리브레이션",
                          "category": "required", "status": "error", "message": f"로드 실패: {e}",
                          "hint": "config/field_mapping.json 을 확인하세요.", "action": ""})

        # 4. 데이터 소스 도달 (필수)
        try:
            ok, msg = get_source(settings).health()
            items.append({"id": "data_source", "label": f"데이터 소스 ({settings.get('source')})",
                          "category": "required", "status": "ok" if ok else "error",
                          "message": msg, "hint": "" if ok else "settings.json의 api/db 설정을 확인하세요.",
                          "action": ""})
        except Exception as e:
            items.append({"id": "data_source", "label": "데이터 소스",
                          "category": "required", "status": "error", "message": str(e),
                          "hint": "settings.json의 source/api/db 설정을 확인하세요.", "action": ""})

        # 5. 그리드 열 순서 (권장)
        if erp_cfg.get("grid_columns"):
            items.append({"id": "grid_columns", "label": "그리드 열 순서",
                          "category": "recommended", "status": "ok", "message": "등록됨",
                          "hint": "", "action": ""})
        else:
            items.append({"id": "grid_columns", "label": "그리드 열 순서",
                          "category": "recommended", "status": "warning",
                          "message": "미등록 (단일 품목 모드)",
                          "hint": "다행 그리드 폼이면 그리드 헤더를 복사해 넣으세요. 단일 품목이면 불필요.",
                          "action": "tab-erp"})

        # 6. 품목 마스터 (권장)
        items_path = config_dir / "valid_items.txt"
        if items_path.exists() and items_path.stat().st_size > 0:
            items.append({"id": "valid_items", "label": "품목 마스터",
                          "category": "recommended", "status": "ok", "message": "등록됨",
                          "hint": "", "action": ""})
        else:
            items.append({"id": "valid_items", "label": "품목 마스터",
                          "category": "recommended", "status": "warning",
                          "message": "config/valid_items.txt 없음",
                          "hint": "입력 전 품목코드 검증을 원하면 품목코드를 한 줄씩 저장하세요. 없으면 검증 비활성화.",
                          "action": ""})

        required_missing = sum(1 for it in items if it["category"] == "required" and it["status"] != "ok")
        recommended_missing = sum(1 for it in items if it["category"] == "recommended" and it["status"] != "ok")
        return {
            "all_required_ok": required_missing == 0,
            "required_missing_count": required_missing,
            "recommended_missing_count": recommended_missing,
            "items": items,
        }

    # ── ERP 제어 ──

    @app.post("/api/erp/test")
    async def erp_test():
        """UNIERP 윈도우를 찾아 연결 가능 여부를 반환한다.

        process_name이 설정돼 있으면 그 프로세스 소속 창만 본다
        (Chrome 탭처럼 타이틀에 'UNIERP'가 들어간 무관한 창 오인 방지).
        """
        try:
            from pywinauto import Desktop
            try:
                import psutil
            except ImportError:
                psutil = None
            erp_cfg = settings.get("erp", {})
            title = erp_cfg.get("window_title", "UNIERP")
            proc_name = erp_cfg.get("process_name", "").lower()
            desktop = Desktop(backend="uia")

            matches = []   # 메인 후보 (로그인 제외)
            login_dlg = None
            for win in desktop.windows():
                try:
                    wt = win.window_text()
                    if not wt:
                        continue
                    pid = win.process_id()
                    pname = ""
                    if pid and psutil:
                        try:
                            pname = psutil.Process(pid).name()
                        except Exception:
                            pass
                    # 프로세스명 우선 필터
                    if proc_name:
                        if proc_name not in pname.lower():
                            continue
                    else:
                        if title.lower() not in wt.lower():
                            continue
                    rect = win.rectangle()
                    entry = {
                        "title": wt, "process": pname,
                        "rect": {"left": rect.left, "top": rect.top,
                                 "right": rect.right, "bottom": rect.bottom},
                    }
                    if "로그인" in wt:
                        login_dlg = entry
                    else:
                        matches.append(entry)
                except Exception:
                    continue

            if matches:
                best = max(matches, key=lambda m: (m["rect"]["right"]-m["rect"]["left"])
                                                   * (m["rect"]["bottom"]-m["rect"]["top"]))
                return {"connected": True, "window_title": best["title"],
                        "process": best["process"], "rect": best["rect"],
                        "all_matches": matches, "login_dialog": login_dlg}
            if login_dlg:
                return {"connected": False,
                        "error": "로그인 다이얼로그만 떠있음 — 로그인 후 다시 시도하세요",
                        "login_dialog": login_dlg}
            return {"connected": False,
                    "error": f"ERP 윈도우를 찾을 수 없습니다 (process_name={proc_name!r}, title={title!r})"}
        except Exception as e:
            return {"connected": False, "error": str(e)}

    @app.get("/api/erp/settings")
    async def erp_settings_get():
        erp_cfg = settings.get("erp", {})
        return {
            "window_title": erp_cfg.get("window_title", "UNIERP"),
            "process_name": erp_cfg.get("process_name", ""),
            "launch_path": erp_cfg.get("launch_path", ""),
            "login_id": erp_cfg.get("login_id", ""),
            "login_pw": erp_cfg.get("login_pw", ""),
            "target_menu": erp_cfg.get("target_menu", ""),
            "first_field_tabs": erp_cfg.get("first_field_tabs", 2),
            "save_shortcut": erp_cfg.get("save_shortcut", ""),
            "grid_columns": erp_cfg.get("grid_columns", ""),
        }

    @app.put("/api/erp/settings")
    async def erp_settings_update(request: Request):
        body = await request.json()
        erp_cfg = settings.setdefault("erp", {})
        for key in ("window_title", "process_name", "launch_path", "login_id", "login_pw",
                    "target_menu", "first_field_tabs", "save_shortcut", "grid_columns"):
            if key in body:
                erp_cfg[key] = body[key]
        try:
            _save_settings()
            return MessageResponse(message="ERP 설정이 저장되었습니다.")
        except Exception as e:
            return JSONResponse({"error": f"저장 실패: {e}"}, status_code=500)

    # ── 필드 매핑 캘리브레이션 ──

    def _resolve_form_read_path(form_id: str | None):
        """읽기용 경로 — user override 우선, 없으면 _defaults."""
        config_dir = get_config_dir()
        if form_id:
            user = config_dir / "forms" / f"{form_id}.json"
            if user.is_file():
                return user
            default = config_dir / "forms" / "_defaults" / f"{form_id}.json"
            if default.is_file():
                return default
        # 기본 폼 폴백
        for fid in ("부적합등록", "부적합판정등록"):
            for p in (config_dir / "forms" / f"{fid}.json",
                      config_dir / "forms" / "_defaults" / f"{fid}.json"):
                if p.is_file():
                    return p
        return config_dir / "field_mapping.json"

    def _resolve_form_write_path(form_id: str | None):
        """쓰기용 경로 — 항상 user 경로 (_defaults 는 자동 업데이트 대상이라 사용자 편집 금지)."""
        config_dir = get_config_dir()
        if form_id:
            return config_dir / "forms" / f"{form_id}.json"
        return config_dir / "forms" / "부적합등록.json"

    @app.get("/api/field-mapping")
    async def field_mapping_get(form_id: str | None = None):
        """폼 프로파일의 필드 좌표 반환. form_id 없으면 기본 폼 (부적합등록)."""
        try:
            path = _resolve_form_read_path(form_id)
            mapping = ConfigLoader.load(path, use_cache=False)
            cal = mapping.get("_calibration", {})
            fields = []
            for i, f in enumerate(mapping.get("header_fields", [])):
                fields.append({
                    "index": i + 1,
                    "label": f.get("label", ""),
                    "ref_x": f.get("ref_x"),
                    "ref_y": f.get("ref_y"),
                    "method": f.get("method", ""),
                    "ncr_key": f.get("ncr_key", ""),
                    "literal": f.get("literal", ""),
                    "form_label": f.get("form_label", ""),
                })
            # 사용 가능한 폼 목록 — _defaults 와 user override 합집합
            available_forms = set()
            forms_dir = get_config_dir() / "forms"
            if forms_dir.is_dir():
                for p in forms_dir.glob("*.json"):
                    available_forms.add(p.stem)
                defaults_dir = forms_dir / "_defaults"
                if defaults_dir.is_dir():
                    for p in defaults_dir.glob("*.json"):
                        available_forms.add(p.stem)
            available_forms = sorted(available_forms)
            return {
                "fields": fields,
                "calibration": cal,
                "form_id": mapping.get("form_id", ""),
                "available_forms": available_forms,
                "path": str(path.name),
            }
        except Exception as e:
            return JSONResponse({"error": f"로드 실패: {e}"}, status_code=500)

    _COORD_MIN, _COORD_MAX = 0, 20000  # 가상 스크린 최대치(4K 듀얼) 여유

    def _validate_coord(value: Any, name: str) -> int:
        """좌표 값을 int 로 변환하고 범위 검증. 실패 시 ValueError."""
        if isinstance(value, bool):  # bool 은 int 하위형이지만 좌표로 부적절
            raise ValueError(f"{name} 는 정수여야 합니다: {value!r}")
        try:
            v = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name} 를 정수로 변환할 수 없습니다: {value!r}")
        if not (_COORD_MIN <= v <= _COORD_MAX):
            raise ValueError(f"{name} 범위 초과({_COORD_MIN}~{_COORD_MAX}): {v}")
        return v

    @app.put("/api/field-mapping")
    async def field_mapping_put(request: Request):
        """편집된 좌표 저장. body: {form_id?: str, fields: [{label, ref_x, ref_y}, ...]}

        저장은 항상 user 경로 (config/forms/{form_id}.json). _defaults 는 배포 원본이라
        건드리지 않음. user 파일 없으면 _defaults 에서 복사해 초기화 후 편집.
        """
        body = await request.json()
        new_fields = body.get("fields", [])
        form_id = body.get("form_id")
        if not isinstance(new_fields, list):
            return JSONResponse({"error": "fields는 배열이어야 합니다."}, status_code=400)
        path = _resolve_form_write_path(form_id)
        # user 파일 없으면 _defaults 에서 부트스트랩
        if not path.is_file():
            read_src = _resolve_form_read_path(form_id)
            if read_src.is_file() and read_src != path:
                path.parent.mkdir(parents=True, exist_ok=True)
                import shutil as _sh
                _sh.copy2(read_src, path)
                logger.info(f"user override 초기화: {read_src.name} → {path}")

        # 저장 전 전량 검증 — 하나라도 실패하면 파일 손대지 않음(원자성).
        try:
            validated: list[tuple[str, int | None, int | None]] = []
            for idx, new in enumerate(new_fields):
                if not isinstance(new, dict):
                    return JSONResponse(
                        {"error": f"fields[{idx}] 는 객체여야 합니다."}, status_code=422,
                    )
                lbl = new.get("label")
                if not lbl or not isinstance(lbl, str):
                    return JSONResponse(
                        {"error": f"fields[{idx}].label 이 비었거나 문자열이 아닙니다."},
                        status_code=422,
                    )
                rx = new.get("ref_x")
                ry = new.get("ref_y")
                rx_v = _validate_coord(rx, f"fields[{idx}].ref_x") if rx not in (None, "") else None
                ry_v = _validate_coord(ry, f"fields[{idx}].ref_y") if ry not in (None, "") else None
                validated.append((lbl, rx_v, ry_v))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=422)

        try:
            mapping = ConfigLoader.load(path, use_cache=False)
            existing = mapping.get("header_fields", [])
            updated = 0
            for lbl, rx_v, ry_v in validated:
                for i, ex in enumerate(existing):
                    if ex.get("label") == lbl:
                        if rx_v is not None:
                            existing[i]["ref_x"] = rx_v
                        if ry_v is not None:
                            existing[i]["ref_y"] = ry_v
                        updated += 1
                        break
            mapping["header_fields"] = existing
            ConfigLoader.save(str(path), mapping)
            logger.info(f"{path.name} 저장: {updated}개 필드 좌표 업데이트")
            return MessageResponse(message=f"[{path.stem}] {updated}개 필드 좌표 저장 완료")
        except Exception as e:
            logger.error(f"field_mapping 저장 실패: {e}", exc_info=True)
            return JSONResponse({"error": f"저장 실패: {e}"}, status_code=500)

    @app.post("/api/erp/launch")
    async def erp_launch():
        if state.erp_running:
            return JSONResponse({"error": "이미 ERP 입력 중입니다."}, status_code=409)
        loop = asyncio.get_event_loop()

        def worker():
            try:
                from src.rpa.ncr_connector import NCRConnector
                connector = NCRConnector(settings)

                def log_cb(msg: str):
                    state.erp_logs.append(msg)
                    state.broadcast_erp_sync(loop, {"type": "log", "message": msg})

                connector.set_log_callback(log_cb)
                success = connector.launch_and_connect()
                state.erp_connected = success
                state.broadcast_erp_sync(loop, {
                    "type": "connection", "connected": success,
                    "message": "ERP 실행 + 로그인 완료" if success else "ERP 실행 실패",
                })
            except Exception as e:
                logger.error("ERP 실행 오류: %s", e, exc_info=True)
                state.broadcast_erp_sync(loop, {"type": "log", "message": f"ERP 실행 오류: {e}"})

        state.erp_logs = []
        threading.Thread(target=worker, daemon=True).start()
        return MessageResponse(message="ERP 실행 시작")

    @app.post("/api/erp/start")
    async def erp_start(req: ErpStartRequest):
        if state.erp_running:
            return JSONResponse({"error": "이미 ERP 입력 중입니다."}, status_code=409)
        if not state.reports:
            return JSONResponse({"error": "입력할 보고가 없습니다. 먼저 조회하세요."}, status_code=400)

        state.erp_mode = req.mode
        state.erp_stop_event.clear()
        state.erp_pause_event.clear()
        state.erp_running = True
        state.erp_logs = []

        loop = asyncio.get_event_loop()

        def worker():
            try:
                from src.rpa.ncr_connector import NCRConnector, StoppedByUserError
                from src.rpa.window_controller import FocusLostError

                source = get_source(settings)
                connector = NCRConnector(settings, mode=state.erp_mode)
                connector.set_stop_event(state.erp_stop_event)
                connector.set_pause_event(state.erp_pause_event)
                state.erp_connector = connector  # /api/erp/review/* 에서 사용

                def log_cb(msg: str):
                    state.erp_logs.append(msg)
                    state.broadcast_erp_sync(loop, {"type": "log", "message": msg})

                connector.set_log_callback(log_cb)

                connected = connector.launch_and_connect()
                state.erp_connected = connected
                state.broadcast_erp_sync(loop, {
                    "type": "connection", "connected": connected,
                    "message": "ERP 연결됨" if connected else "ERP 윈도우를 찾을 수 없습니다",
                })
                if not connected:
                    state.broadcast_erp_sync(loop, {"type": "running", "value": False})
                    return

                # ── Phase 별 순차 처리 ──
                # 각 폼(부적합등록 → 부적합판정등록)에 대해 모든 보고 처리
                erp_cfg = settings.get("erp", {})
                form_ids = erp_cfg.get("forms") or ["부적합등록"]
                log_cb(f"===== 배치 시작: {len(state.reports)}건 × {len(form_ids)} phase = {form_ids} =====")

                stopped_flag = False
                for phase_idx, form_id in enumerate(form_ids, 1):
                    if stopped_flag or state.erp_stop_event.is_set():
                        break

                    log_cb(f"===== Phase {phase_idx}/{len(form_ids)}: [{form_id}] 시작 =====")
                    try:
                        connector.set_form_profile(form_id)
                    except Exception as e:
                        log_cb(f"⚠ 폼 프로파일 [{form_id}] 로드 실패: {e} — Phase 중단")
                        continue

                    for i, report in enumerate(state.reports):
                        if state.erp_stop_event.is_set():
                            log_cb("입력이 중지되었습니다.")
                            stopped_flag = True
                            break
                        while state.erp_pause_event.is_set() and not state.erp_stop_event.is_set():
                            state.erp_stop_event.wait(0.5)

                        state.erp_queue[i]["status"] = f"[{form_id}] 입력 중"
                        state.erp_queue[i]["progress"] = f"Phase {phase_idx}/{len(form_ids)}"
                        state.broadcast_erp_sync(loop, {"type": "queue_update", "index": i,
                                                        "status": f"[{form_id}] 입력 중",
                                                        "progress": f"Phase {phase_idx}/{len(form_ids)}"})
                        log_cb(f"[{form_id}] 입력 중: 보고 #{report.id}")

                        # PROCESSING 표시는 첫 Phase에서만 (record 단일)
                        if phase_idx == 1:
                            try:
                                source.mark_processing(report.id)
                            except Exception as e:
                                log_cb(f"⚠ PROCESSING 표시 실패(계속): {e}")

                        try:
                            connector.input_report(report)
                        except StoppedByUserError as e:
                            if phase_idx == 1:
                                try:
                                    source.mark_pending(report.id)
                                except Exception as me:
                                    log_cb(f"⚠ PENDING 복원 실패: {me}")
                            state.erp_queue[i]["status"] = "중지"
                            state.erp_queue[i]["progress"] = "-"
                            state.broadcast_erp_sync(loop, {"type": "queue_update", "index": i,
                                                            "status": "중지", "progress": "-"})
                            log_cb(f"중지로 #{report.id} 복원 ({e})")
                            stopped_flag = True
                            break
                        except FocusLostError as e:
                            source.mark_failed(report.id, f"focus lost [{form_id}]: {e}")
                            state.erp_queue[i]["status"] = "오류"
                            state.erp_queue[i]["progress"] = "-"
                            warn = "⚠ 다른 창이 활성화되어 입력을 중지했습니다. ERP 창을 유지한 채 다시 시작하세요."
                            log_cb(warn)
                            state.broadcast_erp_sync(loop, {"type": "focus_lost", "message": warn})
                            stopped_flag = True
                            break
                        except Exception as e:
                            logger.error("보고 #%s [%s] 입력 실패: %s", report.id, form_id, e)
                            try:
                                source.mark_failed(report.id, f"[{form_id}] {e}")
                            except Exception:
                                pass
                            state.erp_queue[i]["status"] = "오류"
                            state.erp_queue[i]["progress"] = f"[{form_id}] 실패"
                            state.broadcast_erp_sync(loop, {"type": "queue_update", "index": i,
                                                            "status": "오류", "progress": f"[{form_id}] 실패"})
                            log_cb(f"오류 [{form_id}]: {e}")
                            continue

                        # 검토 큐에 (보고 × 폼) 엔트리 추가
                        state.erp_review_queue.append({
                            "queue_index": i,
                            "report_id": report.id,
                            "report": report,
                            "form_id": form_id,
                            "phase": phase_idx,
                            "steps": connector.build_sequence_info(report),
                            "status": "pending",
                        })
                        log_cb(f"✓ #{report.id} [{form_id}] 입력+저장 완료")

                    log_cb(f"===== Phase {phase_idx}/{len(form_ids)}: [{form_id}] 종료 =====")

                # 모든 phase 완료 후 REVIEW 상태로 승격 (record별 1회)
                if not stopped_flag:
                    for i, report in enumerate(state.reports):
                        try:
                            source.mark_review(report.id)
                        except Exception as e:
                            log_cb(f"⚠ #{report.id} REVIEW 표시 실패(계속): {e}")
                        state.erp_queue[i]["status"] = "저장됨"
                        state.erp_queue[i]["progress"] = "검토 대기"
                        state.broadcast_erp_sync(loop, {"type": "queue_update", "index": i,
                                                        "status": "저장됨", "progress": "검토 대기"})

                # ── 모든 보고 처리 완료, 배치 검토 시작 ──
                if state.erp_review_queue:
                    state.erp_review_resolved.clear()
                    payload_reports = [
                        {"queue_index": r["queue_index"], "report_id": r["report_id"],
                         "form_id": r.get("form_id", "?"), "phase": r.get("phase", 1),
                         "steps": r["steps"], "status": r["status"]}
                        for r in state.erp_review_queue
                    ]
                    state.broadcast_erp_sync(loop, {
                        "type": "review_required",
                        "reports": payload_reports,
                    })
                    log_cb(f"⏸ 전체 {len(state.erp_review_queue)}건 입력 완료. "
                           "검토 패널에서 페이지별로 확인 후 [완료 확인] 또는 [모두 확인].")

                    # 사용자가 모든 보고 확인할 때까지 대기 (중지도 종결의 하나)
                    while not state.erp_review_resolved.is_set():
                        if state.erp_stop_event.is_set():
                            break
                        # 모두 confirmed면 자동 종료
                        if all(r["status"] != "pending" for r in state.erp_review_queue):
                            state.erp_review_resolved.set()
                        state.erp_review_resolved.wait(0.3)

                    # 중지된 경우 pending 보고들 PENDING으로 복원
                    if state.erp_stop_event.is_set():
                        for r in state.erp_review_queue:
                            if r["status"] == "pending":
                                try:
                                    source.mark_pending(r["report_id"])
                                except Exception as me:
                                    log_cb(f"⚠ #{r['report_id']} PENDING 복원 실패: {me}")
                        log_cb("중지 — 미확인 보고들 PENDING 복원")
                    else:
                        log_cb("전체 검토 완료")

                    state.broadcast_erp_sync(loop, {"type": "review_resolved"})
                    state.erp_review_queue.clear()

                log_cb("ERP 입력 완료")
                state.broadcast_erp_sync(loop, {"type": "running", "value": False})
            except Exception as e:
                logger.error("ERP 입력 오류: %s", e, exc_info=True)
                state.broadcast_erp_sync(loop, {"type": "log", "message": f"오류: {e}"})
                state.broadcast_erp_sync(loop, {"type": "running", "value": False})
            finally:
                state.erp_running = False

        threading.Thread(target=worker, daemon=True).start()
        return MessageResponse(message=f"ERP 입력 시작 (모드: {req.mode})")

    # ── 배치 검토 모드 엔드포인트 ──

    def _hydrate_review_queue_from_db() -> int:
        """이전 세션에서 저장 후 확인 못 받은 REVIEW 보고들을 큐로 복원.

        워커가 돌지 않을 때만 실행 — 워커 실행 중엔 워커가 이미 큐를 채우므로
        레이스 없다. 복원 항목은 report 객체가 None 이라 UI 는 최소 정보만
        표시하지만, 사용자가 [확인] 눌러 COMPLETED 로 종결하는 데는 문제 없음.
        """
        if state.erp_running or state.erp_review_queue:
            return 0
        try:
            source = get_source(settings)
            leftovers = source.fetch_review()
        except Exception as e:
            logger.warning("REVIEW 복원 조회 실패: %s", e)
            return 0
        for idx, r in enumerate(leftovers):
            state.erp_review_queue.append({
                "queue_index": -1,  # 이번 세션 큐엔 없음(복원본)
                "report_id": r.id,
                "report": None,     # 재구성 불가 — 확인만 하면 되므로 미보관
                "steps": [],        # 상세 없음
                "status": "pending",
                "restored": True,
            })
        if leftovers:
            logger.info("이전 세션 REVIEW %d건 복원", len(leftovers))
        return len(leftovers)

    @app.get("/api/erp/review")
    async def erp_review_status():
        """배치 검토 중인 보고 목록 + 각 status.

        큐가 비었어도 DB 에 REVIEW 상태 보고가 있으면 복원해서 사용자에게 표시.
        서버 재시작 후에도 확인 안 된 보고가 유실되지 않도록 하는 안전망.
        """
        _hydrate_review_queue_from_db()
        if not state.erp_review_queue:
            return {"active": False}
        return {
            "active": True,
            "reports": [
                {"queue_index": r["queue_index"], "report_id": r["report_id"],
                 "form_id": r.get("form_id", "?"), "phase": r.get("phase", 1),
                 "steps": r["steps"], "status": r["status"],
                 "restored": r.get("restored", False)}
                for r in state.erp_review_queue
            ],
        }

    class _ConfirmBody(BaseModel):
        report_id: int | None = None  # None이면 전체 확인

    @app.post("/api/erp/review/confirm")
    async def erp_review_confirm(body: _ConfirmBody):
        """완료 확인. mark_completed는 report_id별로 1회 (여러 phase 엔트리가 있어도)."""
        if not state.erp_review_queue:
            return JSONResponse({"error": "검토 중인 보고가 없습니다."}, status_code=400)
        source = get_source(settings)
        completed_ids: set[int] = set()
        # 필터링된 report_id 셋 (같은 report의 모든 phase 엔트리 일괄 confirmed 처리)
        target_rids = set()
        for r in state.erp_review_queue:
            if body.report_id is not None and r["report_id"] != body.report_id:
                continue
            target_rids.add(r["report_id"])
        # mark_completed는 record별 1회만
        for rid in target_rids:
            try:
                source.mark_completed(rid)
                completed_ids.add(rid)
            except Exception as e:
                return JSONResponse({"error": f"#{rid} COMPLETED 실패: {e}"}, status_code=500)
        # 큐 UI + 검토 큐 status 갱신 (같은 report_id 모든 phase 엔트리)
        loop = asyncio.get_event_loop()
        for r in state.erp_review_queue:
            if r["report_id"] in completed_ids and r["status"] == "pending":
                r["status"] = "confirmed"
                qi = r["queue_index"]
                state.erp_queue[qi]["status"] = "완료"
                state.erp_queue[qi]["progress"] = "100%"
                state.broadcast_erp_sync(loop, {"type": "queue_update", "index": qi,
                                                "status": "완료", "progress": "100%"})
        # 모두 confirmed면 워커 해제
        if all(r["status"] != "pending" for r in state.erp_review_queue):
            state.erp_review_resolved.set()
        return MessageResponse(message=f"{len(completed_ids)}건 확인 완료: {sorted(completed_ids)}")

    class _RedoStepBody(BaseModel):
        step_index: int
        report_id: int | None = None  # 어떤 보고의 스텝인지

    @app.post("/api/erp/review/redo-step")
    async def erp_review_redo_step(body: _RedoStepBody):
        """현재 포커스된 ERP 필드에 N번 스텝 값만 다시 타이핑."""
        target = None
        for r in state.erp_review_queue:
            if body.report_id is None or r["report_id"] == body.report_id:
                target = r; break
        if target is None:
            return JSONResponse({"error": "대상 보고를 찾을 수 없음"}, status_code=400)
        connector = state.erp_connector
        if connector is None:
            return JSONResponse({"error": "ERP 연결 안 됨"}, status_code=400)
        report = target["report"]
        step_index = body.step_index
        loop = asyncio.get_event_loop()

        def log_cb(msg: str):
            state.erp_logs.append(msg)
            state.broadcast_erp_sync(loop, {"type": "log", "message": msg})

        def redo_worker():
            try:
                connector.redo_step(report, step_index)
            except Exception as e:
                log_cb(f"재실행 #{step_index+1} 오류: {e}")

        threading.Thread(target=redo_worker, daemon=True).start()
        return MessageResponse(message=f"보고 #{report.id} 스텝 #{step_index+1} 재실행")

    class _RedoAllBody(BaseModel):
        report_id: int | None = None

    @app.post("/api/erp/review/redo-all")
    async def erp_review_redo_all(body: _RedoAllBody):
        """처음부터 다시 입력 (메뉴 진입 새 폼)."""
        target = None
        for r in state.erp_review_queue:
            if body.report_id is None or r["report_id"] == body.report_id:
                target = r; break
        if target is None:
            return JSONResponse({"error": "대상 보고를 찾을 수 없음"}, status_code=400)
        connector = state.erp_connector
        if connector is None:
            return JSONResponse({"error": "ERP 연결 안 됨"}, status_code=400)
        report = target["report"]
        loop = asyncio.get_event_loop()

        def log_cb(msg: str):
            state.erp_logs.append(msg)
            state.broadcast_erp_sync(loop, {"type": "log", "message": msg})

        def redo_worker():
            try:
                log_cb(f"🔄 보고 #{report.id} 처음부터 재입력")
                connector.input_report(report, navigate=True)
                log_cb(f"🔄 #{report.id} 재입력 완료")
            except Exception as e:
                log_cb(f"처음부터 재입력 오류: {e}")

        threading.Thread(target=redo_worker, daemon=True).start()
        return MessageResponse(message="처음부터 재입력 시작")

    @app.post("/api/erp/pause")
    async def erp_pause():
        if state.erp_pause_event.is_set():
            state.erp_pause_event.clear()
            msg = "ERP 입력 재개"
        else:
            state.erp_pause_event.set()
            msg = "ERP 입력 일시정지"
        state.erp_logs.append(msg)
        await state.broadcast_erp({"type": "log", "message": msg})
        return MessageResponse(message=msg)

    @app.post("/api/erp/stop")
    async def erp_stop():
        state.erp_stop_event.set()
        state.erp_pause_event.clear()
        state.erp_running = False
        # 배치 검토 대기 중이면 즉시 해제 (워커가 pending 보고 mark_pending)
        if state.erp_review_queue:
            state.erp_review_resolved.set()
        msg = "ERP 입력 중지 요청"
        state.erp_logs.append(msg)
        await state.broadcast_erp({"type": "log", "message": msg})
        await state.broadcast_erp({"type": "running", "value": False})
        return MessageResponse(message=msg)

    # ── ERP 디버깅 (캘리브레이션용) ──

    @app.get("/api/erp/windows")
    async def erp_windows():
        try:
            from pywinauto import Desktop
            desktop = Desktop(backend="uia")
            windows = []
            for win in desktop.windows():
                try:
                    title = win.window_text()
                    if title:
                        rect = win.rectangle()
                        windows.append({"title": title,
                                        "rect": {"left": rect.left, "top": rect.top,
                                                 "right": rect.right, "bottom": rect.bottom}})
                except Exception:
                    continue
            return {"windows": windows, "count": len(windows)}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/erp/inspect")
    async def erp_inspect(request: Request):
        """ERP 메인 창의 컨트롤 트리 덤프.

        쿼리/바디 옵션:
          - control_type: 특정 타입만 (Edit/ComboBox/Button/CheckBox/RadioButton…)
          - limit: 최대 개수 (기본 2000)
          - include_position: True면 좌표·크기 포함 (UI 매칭 시 유용)
          - process_name 필터는 settings.erp.process_name 사용
        """
        try:
            from pywinauto import Application
            try:
                body = await request.json()
            except Exception:
                body = {}
            erp_cfg = settings.get("erp", {})
            proc_name = erp_cfg.get("process_name", "").lower()
            title = erp_cfg.get("window_title", "UNIERP")
            ctype_filter = (body.get("control_type") or "").strip().lower()
            limit = int(body.get("limit") or 2000)
            include_position = bool(body.get("include_position", True))

            # 프로세스명 기반 메인 윈도우 찾기 (로그인 다이얼로그 제외)
            from src.rpa.window_controller import WindowController
            wc = WindowController(title, process_name=proc_name)
            wins = wc._find_erp_windows(exclude_login=True)
            if not wins:
                return JSONResponse({"error": "ERP 메인 윈도우를 찾을 수 없습니다 (로그인 또는 폼 열기 필요)"},
                                    status_code=400)
            main_win = max(wins, key=lambda w: w.rectangle().width() * w.rectangle().height())

            controls = []
            for ctrl in main_win.descendants():
                try:
                    info = ctrl.element_info
                    c_type = info.control_type or ""
                    if ctype_filter and c_type.lower() != ctype_filter:
                        continue
                    entry = {
                        "control_type": c_type,
                        "name": info.name or "",
                        "auto_id": info.automation_id or "",
                        "class_name": info.class_name or "",
                    }
                    if include_position:
                        try:
                            r = ctrl.rectangle()
                            entry["rect"] = {"left": r.left, "top": r.top,
                                             "right": r.right, "bottom": r.bottom,
                                             "w": r.width(), "h": r.height()}
                        except Exception:
                            pass
                    controls.append(entry)
                    if len(controls) >= limit:
                        break
                except Exception:
                    continue

            # 타입별 카운트 요약
            type_counts: dict[str, int] = {}
            for c in controls:
                type_counts[c["control_type"]] = type_counts.get(c["control_type"], 0) + 1

            return {
                "window_title": main_win.window_text(),
                "control_count": len(controls),
                "type_counts": dict(sorted(type_counts.items(), key=lambda x: -x[1])),
                "controls": controls,
            }
        except Exception as e:
            return JSONResponse({"error": f"ERP 윈도우에 연결할 수 없습니다: {e}"}, status_code=500)

    # ── WebSocket ──

    @app.websocket("/ws/progress")
    async def ws_progress(websocket: WebSocket):
        await websocket.accept()
        await state.add_progress_client(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await state.remove_progress_client(websocket)

    @app.websocket("/ws/erp-log")
    async def ws_erp_log(websocket: WebSocket):
        await websocket.accept()
        await state.add_erp_client(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await state.remove_erp_client(websocket)

    return app
