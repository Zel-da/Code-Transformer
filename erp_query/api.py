"""
ERP 조회 REST API (FastAPI) — 이 PC(ERP DB 접근 가능)에서 실행.

엔드포인트:
  GET /health                         서비스/DB 헬스체크
  GET /api/erp/input-data             제품+출하호기 → NCR 자동입력 데이터
        ?itemCode=...  | ?product=...   (둘 중 하나 필수)
        &hogi=365                       (출하호기, product와 함께면 단건으로 좁힘)
  GET /api/erp/orders                 제품+호기 → 제조오더 현황
        ?itemCode=... | ?product=...  &hogi=365

실행:
  cd erp_query
  uvicorn api:app --host 0.0.0.0 --port 8900
  (또는)  python api.py
  문서: http://localhost:8900/docs

인증(선택): PRIVATE/erp_db.json 에 "api_key" 또는 환경변수 ERP_API_KEY 가 설정돼 있으면
            요청 헤더 X-ERP-KEY 가 일치해야 한다. 미설정이면 인증 없음(내부망 전용).
"""

import ipaddress
import json
import os

from fastapi import FastAPI, HTTPException, Query, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

import db
import find_order
from fetch_input import fetch_input_data

app = FastAPI(
    title="ERP 조회 API",
    description="제품+출하호기로 NCR 자동입력 데이터를 ERP 본 DB(읽기 전용)에서 조회",
    version="1.0.0",
)

# 사설 IP 대역 (RFC 1918 + loopback + link-local). 기본 허용 대상.
# ERP_ALLOWED_CIDRS 환경변수로 추가 허용 가능 (콤마 구분, 예: "203.0.113.10/32").
_PRIVATE_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]
for cidr in (os.getenv("ERP_ALLOWED_CIDRS") or "").split(","):
    cidr = cidr.strip()
    if cidr:
        try:
            _PRIVATE_NETS.append(ipaddress.ip_network(cidr, strict=False))
        except ValueError:
            pass


def _is_lan(client_host: str) -> bool:
    try:
        ip = ipaddress.ip_address(client_host)
    except ValueError:
        return False
    return any(ip in net for net in _PRIVATE_NETS)


class LanOnlyMiddleware(BaseHTTPMiddleware):
    """공인 IP에서 오는 요청을 거부. ERP 자료 누출 방지의 1차 방어선."""
    async def dispatch(self, request: Request, call_next):
        client = request.client.host if request.client else ""
        if not _is_lan(client):
            return Response(
                content=json.dumps({"detail": "사내망에서만 접근 가능", "client": client}, ensure_ascii=False),
                status_code=403,
                media_type="application/json",
            )
        return await call_next(request)


app.add_middleware(LanOnlyMiddleware)

# 내부망 전용. 프런트/노드 API에서 직접 호출 가능하도록 CORS 허용.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _api_key() -> str:
    try:
        cfg_key = db.load_cfg().get("api_key", "")
    except Exception:
        cfg_key = ""
    return os.getenv("ERP_API_KEY") or cfg_key


def _check_auth(x_erp_key: str | None) -> None:
    """API 키 강제. PRIVATE/erp_db.json 의 api_key 또는 ERP_API_KEY 환경변수 필수."""
    key = _api_key()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="ERP API 키 미설정 — PRIVATE/erp_db.json 의 api_key 또는 ERP_API_KEY 환경변수를 설정하세요",
        )
    if x_erp_key != key:
        raise HTTPException(status_code=401, detail="X-ERP-KEY 불일치 또는 누락")


def _json(payload, status: int = 200) -> Response:
    """Decimal/datetime 안전 직렬화 + 한글 보존."""
    return Response(
        content=json.dumps(payload, ensure_ascii=False, default=str),
        media_type="application/json",
        status_code=status,
    )


@app.get("/health")
def health() -> Response:
    try:
        conn = db.connect(timeout=5)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        conn.close()
        return _json({"ok": True, "db": "up"})
    except Exception as e:
        return _json({"ok": False, "db": "down", "error": f"{type(e).__name__}: {e}"}, status=503)


@app.get("/api/erp/input-data")
def input_data(
    itemCode: str | None = Query(None, description="품번 정확일치 (예: T8NH-0000000-00)"),
    product: str | None = Query(None, description="품번/품명 부분일치 (예: T-380N)"),
    hogi: int | None = Query(None, description="출하호기 번호 (예: 365)"),
    x_erp_key: str | None = Header(None, alias="X-ERP-KEY"),
) -> Response:
    _check_auth(x_erp_key)
    if not (itemCode or product):
        raise HTTPException(status_code=400, detail="itemCode 또는 product 중 하나는 필요합니다.")

    result = fetch_input_data(item_cd=itemCode, product=product, hogi=hogi)

    if not result.get("ok"):
        # 품목을 못 찾으면 404, 후보 여럿이면 200(프런트에서 선택지로 사용)
        if result.get("reason", "").startswith("품목을 찾지"):
            return _json(result, status=404)
        return _json(result, status=200)
    return _json(result)


@app.get("/api/erp/orders")
def orders(
    itemCode: str | None = Query(None),
    product: str | None = Query(None),
    hogi: int | None = Query(None),
    plant: str | None = Query(None, description="공장 코드 (예: SA00)"),
    limit: int = Query(200, ge=1, le=2000),
    x_erp_key: str | None = Header(None, alias="X-ERP-KEY"),
) -> Response:
    _check_auth(x_erp_key)
    if not (itemCode or product):
        raise HTTPException(status_code=400, detail="itemCode 또는 product 중 하나는 필요합니다.")

    cols, rows = find_order.find_orders(
        item_cd=itemCode, product=product, hogi=hogi, plant=plant, limit=limit
    )
    data = [dict(zip(cols, r)) for r in rows]
    return _json({"ok": True, "count": len(data), "orders": data})


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("ERP_API_HOST", "0.0.0.0")
    port = int(os.getenv("ERP_API_PORT", "8900"))
    uvicorn.run(app, host=host, port=port)
