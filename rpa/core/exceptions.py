class FocusLostError(Exception):
    """RPA 대상 창에서 포커스가 이탈했을 때 발생."""
    pass


class WindowNotFoundError(Exception):
    """대상 ERP 창을 찾을 수 없을 때 발생."""
    pass


class PopupError(Exception):
    """팝업/다이얼로그 처리 중 오류 발생 (외부 프로세스 팝업 등)."""
    pass


class StepTimeoutError(Exception):
    """개별 InputStep 실행이 타임아웃됐을 때 발생."""
    pass


class MaxAttemptsExceeded(Exception):
    """재시도 한도를 초과했을 때 발생."""
    pass
