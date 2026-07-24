"""NCR 보고 → UNIERP 부적합보고서 입력 시퀀스 빌더.

field_mapping.json 의 header_fields 배열을 순서대로 InputStep으로 변환한다.
OCR_EU의 ERPFieldMap이 Soosan 전용 하드코딩이었던 것과 달리, 이쪽은
완전히 설정(JSON) 기반이라 캘리브레이션만으로 폼 구조에 맞출 수 있다.
"""
from typing import Any

from src.data_source.report_model import NcrReport, format_date
from src.rpa.input_sequence import InputMethod, InputSequence, InputStep
from src.utils.logger import get_logger

logger = get_logger(__name__)

# field_mapping.json method 문자열 → InputMethod
_METHOD_MAP = {
    "type": InputMethod.TYPE_TEXT,
    "popup_search": InputMethod.POPUP_SEARCH,
    "popup_search_enter": InputMethod.POPUP_SEARCH_ENTER,
    "dropdown": InputMethod.DROPDOWN_SELECT,
    "skip": InputMethod.SKIP,
    "dismiss": InputMethod.DISMISS_DIALOG,
}


class NcrReportFieldMap:
    """field_mapping.json + NcrReport → InputSequence."""

    def __init__(self, mapping: dict[str, Any]):
        self._mapping = mapping
        self._header_fields = mapping.get("header_fields", [])

    def build_sequence(self, report: NcrReport) -> InputSequence:
        sequence = InputSequence()
        seq = 0

        for spec in self._header_fields:
            seq += 1
            ncr_key = spec.get("ncr_key", "")
            label = spec.get("label", ncr_key)
            method_str = (spec.get("method") or "type").lower()
            method = _METHOD_MAP.get(method_str, InputMethod.TYPE_TEXT)
            tab_after = bool(spec.get("tab_after", 1))
            tabs_before = int(spec.get("tabs_before", 1))

            # dismiss/skip 은 값과 무관하게 그대로
            if method == InputMethod.DISMISS_DIALOG:
                sequence.add_step(InputStep(
                    field_name=label, value=str(spec.get("timeout", 0.5)),
                    method=method, tab_order=seq, tab_after=False, delay_after=0.1,
                    tabs_before=tabs_before,
                ))
                continue
            if method == InputMethod.SKIP:
                sequence.add_step(InputStep(
                    field_name=label, value="", method=method,
                    tab_order=seq, tab_after=tab_after, tabs_before=tabs_before,
                ))
                continue

            # 값 계산: literal 우선(고정값) → 아니면 report에서 lookup
            if "literal" in spec:
                value = str(spec["literal"])
            else:
                value = self._resolve_value(report, spec)

            # 드롭다운: 값이 이미 숫자(literal 횟수)면 그대로, 아니면 map_ref로 변환
            if method == InputMethod.DROPDOWN_SELECT and not value.isdigit():
                value = self._resolve_dropdown(spec, value)

            # 좌표/라벨 (§3.2, §14)
            ref_x = spec.get("ref_x")
            ref_y = spec.get("ref_y")
            form_label = spec.get("form_label", "")

            # 빈 값은 SKIP으로 (해당 필드는 건드리지 않음 — 기존 값 보존)
            if value == "":
                sequence.add_step(InputStep(
                    field_name=label, value="", method=InputMethod.SKIP,
                    tab_order=seq, tab_after=tab_after, tabs_before=tabs_before,
                    ref_x=ref_x, ref_y=ref_y, form_label=form_label,
                ))
                continue

            sequence.add_step(InputStep(
                field_name=label, value=value, method=method,
                tab_order=seq, tab_after=tab_after, delay_after=0.05,
                tabs_before=tabs_before,
                erp_field_name=str(spec.get("erp_field", "")) if spec.get("erp_field") != "TODO" else "",
                ref_x=ref_x, ref_y=ref_y, form_label=form_label,
            ))

        logger.info("입력 시퀀스 생성: %d 스텝 (보고 #%s)", len(sequence.steps), report.id)
        return sequence

    # ------------------------------------------------------------------

    def _resolve_value(self, report: NcrReport, spec: dict[str, Any]) -> str:
        ncr_key = spec.get("ncr_key", "")
        raw = report.get(ncr_key)
        if (raw is None or raw == "") and spec.get("fallback_key"):
            raw = report.get(spec["fallback_key"])
        if raw is None:
            return ""

        fmt = spec.get("format")
        if fmt:
            return format_date(raw, fmt)

        transform = spec.get("transform")
        if transform == "multiply_60":
            try:
                minutes = float(raw) * 60
                result = int(minutes) if minutes == int(minutes) else minutes
                return str(result)
            except (TypeError, ValueError):
                logger.warning("multiply_60 변환 실패 (ncr_key=%s, raw=%r) → 건너뜀", ncr_key, raw)
                return ""

        if transform == "lookup_item_group":
            # category(이름) → ERP 품목그룹 코드 변환 (config/item_groups.json)
            lookup = self._get_item_groups()
            code = lookup.get(str(raw).strip())
            if not code:
                logger.warning("품목그룹 매핑 없음: %r → 빈값으로 SKIP", raw)
                return ""
            return code

        return str(raw)

    def _get_item_groups(self) -> dict[str, str]:
        """config/item_groups.json 캐시 로드 (UNIERP 폼의 알파벳-숫자 코드 매핑)."""
        if hasattr(self, "_item_groups_cache"):
            return self._item_groups_cache
        from src.utils.config_loader import ConfigLoader
        from src.utils.file_utils import get_config_dir
        path = get_config_dir() / "item_groups.json"
        try:
            self._item_groups_cache = ConfigLoader.load(path, use_cache=True)
        except FileNotFoundError:
            self._item_groups_cache = {}
        return self._item_groups_cache

    def _resolve_dropdown(self, spec: dict[str, Any], raw_value: str) -> str:
        """드롭다운 아래방향키 횟수(문자열)를 반환한다. 미캘리브레이션이면 ''."""
        map_ref = spec.get("map_ref")
        if not map_ref:
            return raw_value  # 이미 횟수가 들어온 경우
        code_map = self._mapping.get(map_ref, {})
        count = code_map.get(raw_value)
        if count is None or str(count).upper() == "TODO":
            logger.warning("드롭다운 맵 미캘리브레이션: %s[%r] → 건너뜀", map_ref, raw_value)
            return ""
        return str(count)
