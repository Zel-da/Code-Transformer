"""
ERP 동기화 실패/이슈 알림 — Sushantalk 호환 웹훅 (단순 POST {"text": ...}).

설정:
  - PRIVATE/notify.json : { "webhook_url": "https://..." }
  - 또는 환경변수 ERP_NOTIFY_WEBHOOK_URL
미설정이면 조용히 skip (운영 부담 0). 실패해도 sync 자체에 영향 없음.

사용:
  from notify import notify
  notify("[ERP sync] sync_shipments 실패: <stderr>", level="error")
"""

import json
import os
import sys
import urllib.request
import urllib.error

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _webhook_url() -> str:
    url = os.getenv("ERP_NOTIFY_WEBHOOK_URL", "")
    if url:
        return url
    path = os.path.join(_BASE, "PRIVATE", "notify.json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f).get("webhook_url", "") or ""
        except Exception:
            pass
    return ""


def notify(text: str, level: str = "info", timeout: float = 5.0) -> bool:
    """알림 전송. 성공 True, skip/실패 False (raise 안 함)."""
    url = _webhook_url()
    if not url:
        # 미설정은 정상 운영 — 표준에러에만 흔적 남김
        print(f"[notify] webhook 미설정 → skip ({level}): {text[:80]}", file=sys.stderr)
        return False

    icon = {"error": "🔴", "warn": "🟡", "info": "🟢"}.get(level, "•")
    payload = json.dumps({"text": f"{icon} {text}"}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ok = 200 <= resp.status < 300
            if not ok:
                print(f"[notify] webhook HTTP {resp.status}", file=sys.stderr)
            return ok
    except urllib.error.URLError as e:
        print(f"[notify] webhook 전송 실패: {e}", file=sys.stderr)
        return False


if __name__ == "__main__":
    msg = " ".join(sys.argv[1:]) or "test notify"
    ok = notify(msg)
    sys.exit(0 if ok else 1)
