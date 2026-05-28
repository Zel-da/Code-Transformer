"""NCR 부적합 보고 데이터 모델 + 정규화 유틸.

API(camelCase JSON)와 DB(snake_case → SQL AS 별칭으로 camelCase) 양쪽이
동일한 `NcrReport` 를 산출하도록 정규화한다.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)

# 데이터 소스가 제공하는 정규(camelCase) 필드 목록
CANONICAL_FIELDS: tuple[str, ...] = (
    "id", "reportDate", "itemCode", "modelName", "processName", "defectType",
    "description", "imageUrl", "syncStatus", "registrantName", "ncrType",
    "factory", "shipmentUnit", "lostManHours", "defectQty", "occurrenceDate",
    "issuingTeam", "plantCd", "processCd", "flawTypeCd", "deptCd",
    "ncrGbnCd", "productType",
)


@dataclass
class NcrReport:
    """단일 부적합 보고. 정규화된 camelCase 필드 dict를 감싼다."""

    id: int
    fields: dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        return self.fields.get(key, default)

    def get_str(self, key: str, default: str = "") -> str:
        """값을 문자열로 반환한다. None/빈값은 default."""
        val = self.fields.get(key)
        if val is None:
            return default
        if isinstance(val, (datetime, date)):
            return format_date(val, "YYYY-MM-DD")
        return str(val)

    def to_dict(self) -> dict[str, Any]:
        """직렬화용 dict (날짜는 ISO 문자열로 정규화)."""
        out: dict[str, Any] = {}
        for k, v in self.fields.items():
            if isinstance(v, (datetime, date)):
                out[k] = v.isoformat()
            else:
                out[k] = v
        out["id"] = self.id
        return out

    # ------------------------------------------------------------------
    # 팩토리
    # ------------------------------------------------------------------

    @classmethod
    def from_api_dict(cls, d: dict[str, Any]) -> "NcrReport":
        """API 응답 JSON(camelCase)에서 생성한다."""
        return cls._from_camel(d)

    @classmethod
    def from_db_row(cls, row: dict[str, Any]) -> "NcrReport":
        """DB 행(SQL AS 별칭으로 camelCase 키)에서 생성한다.

        api_source와 동일한 dict를 산출하도록 from_api_dict와 같은 경로를 탄다.
        """
        return cls._from_camel(row)

    @classmethod
    def _from_camel(cls, d: dict[str, Any]) -> "NcrReport":
        fields: dict[str, Any] = {}
        for key in CANONICAL_FIELDS:
            if key in d:
                fields[key] = d[key]
        # CANONICAL 외 추가 키도 보존 (UI 표시/디버깅용)
        for key, val in d.items():
            if key not in fields:
                fields[key] = val

        raw_id = d.get("id")
        try:
            report_id = int(raw_id)
        except (TypeError, ValueError):
            report_id = -1
            logger.warning("보고서 id 파싱 실패: %r", raw_id)
        fields["id"] = report_id
        return cls(id=report_id, fields=fields)


def format_date(value: Any, fmt: str = "YYYYMMDD") -> str:
    """다양한 날짜 표현을 ERP 입력용 문자열로 변환한다.

    지원 입력:
        - datetime/date 객체 (DB)
        - ISO8601 문자열 'YYYY-MM-DDTHH:MM:SS...' (API)
        - 'YYYY-MM-DD'
    지원 fmt: 'YYYYMMDD', 'YYYY-MM-DD'
    값이 없거나 파싱 실패 시 빈 문자열 또는 원본 문자열을 반환한다.
    """
    if value is None or value == "":
        return ""

    d: date | None = None
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    else:
        s = str(value).strip()
        # ISO 타임스탬프면 'T' 앞 날짜 부분만
        date_part = s.split("T", 1)[0]
        try:
            d = datetime.strptime(date_part, "%Y-%m-%d").date()
        except ValueError:
            # 이미 YYYYMMDD 형태일 수 있음
            digits = date_part.replace("-", "").replace(".", "")
            if len(digits) == 8 and digits.isdigit():
                try:
                    d = datetime.strptime(digits, "%Y%m%d").date()
                except ValueError:
                    d = None

    if d is None:
        logger.debug("날짜 파싱 실패, 원본 반환: %r", value)
        return str(value)

    if fmt == "YYYYMMDD":
        return d.strftime("%Y%m%d")
    if fmt in ("YYYY-MM-DD", "ISO"):
        return d.strftime("%Y-%m-%d")
    return d.strftime("%Y%m%d")
