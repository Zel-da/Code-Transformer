"""Pydantic 요청/응답 모델 (NCR용)."""
from typing import Optional

from pydantic import BaseModel


class SourceUpdate(BaseModel):
    source: str  # "api" | "db"


class ErpStartRequest(BaseModel):
    mode: str = "pywinauto"


class MessageResponse(BaseModel):
    message: str
    success: bool = True


class StatusResponse(BaseModel):
    fetching: bool = False
    report_count: int = 0
    erp_running: bool = False
    error: str = ""
