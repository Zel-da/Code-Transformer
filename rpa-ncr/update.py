"""GitHub main 브랜치 최신 커밋으로 rpa-ncr 자동 업데이트.

사용:
    python update.py                  # 자동 감지 + 적용
    python update.py --check          # 확인만 하고 종료
    python update.py --force          # 최신이어도 강제 재다운로드

동작:
    1. GitHub API 로 REPO/BRANCH 최신 커밋 SHA 조회
    2. 로컬 .version 파일과 비교
    3. 다르면 GitHub archive zip 다운로드
    4. rpa-ncr/ 하위 파일들 로컬로 복사 (PRIVATE·config·venv·logs 보존)
    5. requirements.txt 바뀌면 .venv/.install_ok 삭제 → 다음 실행 시 재설치
    6. .version 갱신

비활성화:
    프로젝트 루트에 빈 파일 .no_auto_update 만들면 스킵.

Private repo 의 경우:
    PRIVATE/gh_token.txt 에 GitHub Personal Access Token 넣으면 인증 사용.
"""
import hashlib
import json
import os
import shutil
import ssl
import sys
import tempfile
import urllib.request
import urllib.error
import zipfile

REPO = os.environ.get("RPA_NCR_REPO", "Zel-da/Code-Transformer")
BRANCH = os.environ.get("RPA_NCR_BRANCH", "main")
VERSION_FILE = ".version"
INSTALL_OK = os.path.join(".venv", ".install_ok")
DISABLE_MARKER = ".no_auto_update"
TOKEN_FILE = os.path.join("PRIVATE", "gh_token.txt")

# 절대 덮어쓰지 않는 최상위 경로
PRESERVE_TOP = {
    "PRIVATE",
    "logs",
    ".venv",
    "__pycache__",
}
PRESERVE_FILES = {VERSION_FILE, DISABLE_MARKER}


def _should_preserve(rel_path: str) -> bool:
    """rel_path (POSIX 형식)가 보존 대상인지 판단.

    보존: PRIVATE/*, logs/*, .venv/*, __pycache__/*, .version, .no_auto_update
    보존: config/* (사용자 캘리브레이션·설정) — 단 config/forms/_defaults/* 는 예외 (업데이트 대상)
    """
    if rel_path in PRESERVE_FILES:
        return True
    top = rel_path.split("/", 1)[0]
    if top in PRESERVE_TOP:
        return True
    if top == "config":
        # _defaults 는 업데이트 허용, 나머지 config 는 보존
        if rel_path.startswith("config/forms/_defaults/"):
            return False
        return True
    return False


def _auth_headers() -> dict:
    headers = {"User-Agent": "rpa-ncr-updater"}
    if os.path.isfile(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, encoding="utf-8") as f:
                token = f.read().strip()
            if token:
                headers["Authorization"] = f"token {token}"
        except Exception:
            pass
    return headers


def _make_ssl_ctx(verify: bool = True) -> ssl.SSLContext:
    """SSL 컨텍스트 생성. verify=True 우선, 실패 시 verify=False 로 재호출.

    certifi 있으면 그 CA 번들 사용 (신뢰성 최고). 없으면 시스템 기본.
    """
    if verify:
        try:
            import certifi  # type: ignore
            return ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            pass
        return ssl.create_default_context()
    # 미검증 (회사망 MITM 프록시용 폴백)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _urlopen(url: str, timeout: int = 30):
    """urlopen with SSL fallback — 정상 SSL → 실패 시 미검증 재시도."""
    req = urllib.request.Request(url, headers=_auth_headers())
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=_make_ssl_ctx(True))
    except urllib.error.URLError as e:
        msg = str(e)
        if "SSL" in msg or "CERTIFICATE" in msg.upper():
            print("[update] SSL 검증 실패 - 미검증 모드로 재시도 (회사망 MITM 프록시 가능성)")
            return urllib.request.urlopen(req, timeout=timeout, context=_make_ssl_ctx(False))
        raise


def _fetch_json(url: str) -> dict:
    with _urlopen(url, timeout=10) as resp:
        return json.load(resp)


def _download(url: str, dst_path: str) -> None:
    with _urlopen(url, timeout=60) as resp, open(dst_path, "wb") as f:
        shutil.copyfileobj(resp, f)


def _get_local_sha() -> str:
    if os.path.exists(VERSION_FILE):
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def _get_remote_sha() -> str:
    data = _fetch_json(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}")
    return data["sha"]


def _hash_file(path: str) -> str:
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _apply_update(sha: str) -> bool:
    """Zip 다운로드 → rpa-ncr/ 하위 파일들 로컬로 복사. 성공 시 True."""
    url = f"https://github.com/{REPO}/archive/{sha}.zip"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    zip_path = tmp.name

    extract_dir = tempfile.mkdtemp()
    try:
        _download(url, zip_path)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extract_dir)

        # 압축 내 폴더는 Code-Transformer-{sha} / rpa-ncr/
        tops = [d for d in os.listdir(extract_dir) if os.path.isdir(os.path.join(extract_dir, d))]
        if not tops:
            print("[update] 압축 파일 구조 이상")
            return False
        src_rpa = os.path.join(extract_dir, tops[0], "rpa-ncr")
        if not os.path.isdir(src_rpa):
            print(f"[update] 압축 내 rpa-ncr/ 없음: {src_rpa}")
            return False

        req_hash_before = _hash_file("requirements.txt")

        # 파일별 재귀 복사 (rel_path 기반 보존 판정)
        copied = 0
        skipped = 0
        for root, _dirs, files in os.walk(src_rpa):
            for fname in files:
                src_file = os.path.join(root, fname)
                rel = os.path.relpath(src_file, src_rpa).replace("\\", "/")
                if _should_preserve(rel):
                    skipped += 1
                    continue
                dst_file = os.path.join(".", rel.replace("/", os.sep))
                dst_dir = os.path.dirname(dst_file)
                if dst_dir:
                    os.makedirs(dst_dir, exist_ok=True)
                try:
                    shutil.copy2(src_file, dst_file)
                    copied += 1
                except Exception as e:
                    print(f"[update] 파일 복사 실패 '{rel}': {e}")
        print(f"[update] 복사 {copied}개 / 보존 {skipped}개")

        req_hash_after = _hash_file("requirements.txt")

        # requirements.txt 바뀌면 재설치 유도
        if req_hash_before and req_hash_after and req_hash_before != req_hash_after:
            if os.path.exists(INSTALL_OK):
                os.remove(INSTALL_OK)
            print("[update] requirements.txt 변경 감지 - 다음 실행 시 패키지 재설치")

        with open(VERSION_FILE, "w", encoding="utf-8") as f:
            f.write(sha)
        return True
    finally:
        try:
            os.remove(zip_path)
        except Exception:
            pass
        shutil.rmtree(extract_dir, ignore_errors=True)


def main() -> int:
    args = sys.argv[1:]
    check_only = "--check" in args
    force = "--force" in args

    if os.path.exists(DISABLE_MARKER):
        print("[update] .no_auto_update 마커 발견 - 스킵")
        return 0

    try:
        remote = _get_remote_sha()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            print(f"[update] GitHub 인증 실패 ({e.code}) - private repo 라면 "
                  f"{TOKEN_FILE} 에 Personal Access Token 넣기")
        else:
            print(f"[update] 원격 확인 HTTP 오류: {e}")
        return 0
    except Exception as e:
        print(f"[update] 원격 확인 실패 (오프라인?): {e}")
        return 0

    local = _get_local_sha()

    if not local and not force:
        print(f"[update] 첫 실행 - 현재 파일을 버전 {remote[:7]} 로 기록")
        with open(VERSION_FILE, "w", encoding="utf-8") as f:
            f.write(remote)
        return 0

    if local == remote and not force:
        print(f"[update] 최신 버전 사용 중 ({local[:7]})")
        return 0

    if check_only:
        print(f"[update] 새 버전 있음: {local[:7]} → {remote[:7]}")
        return 1

    print(f"[update] 새 버전 발견: {(local or 'none')[:7]} → {remote[:7]}")
    print("[update] 다운로드 및 적용 중...")
    ok = _apply_update(remote)
    if ok:
        print(f"[update] 업데이트 완료 → {remote[:7]}")
    else:
        print("[update] 업데이트 실패 - 기존 파일 유지")
    return 0


if __name__ == "__main__":
    sys.exit(main())
