"""
ERP 본 DB(SQL Server, 읽기 전용) 연결 헬퍼.
자격증명은 저장소 루트의 PRIVATE/erp_db.json(gitignore됨)에서 읽는다.
"""

import json
import os

import pyodbc

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CRED_PATH = os.path.join(_BASE, "PRIVATE", "erp_db.json")


def load_cfg() -> dict:
    with open(_CRED_PATH, encoding="utf-8") as f:
        return json.load(f)


def connect(timeout: int = 10, readonly: bool = True) -> pyodbc.Connection:
    """ERP DB에 연결한다. 기본 읽기 전용."""
    c = load_cfg()
    conn_str = (
        f"DRIVER={{{c['driver']}}};"
        f"SERVER={c['server']},{c.get('port', 1433)};"
        f"DATABASE={c['database']};"
        f"UID={c['uid']};PWD={c['pwd']};"
        "TrustServerCertificate=yes;"
    )
    conn = pyodbc.connect(conn_str, timeout=timeout, readonly=readonly)
    conn.timeout = timeout  # 쿼리 타임아웃
    return conn
