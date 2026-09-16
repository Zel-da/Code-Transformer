"""rpa-ncr 자동 업데이트 모듈 (소스 모드 전용).

OCR_EU/src/utils/updater.py 의 패턴을 rpa-ncr 컨텍스트로 이식.

동작 순서:
    1. 원격 최신 커밋 조회 — `git ls-remote origin main` 우선, 실패 시 GitHub API 폴백
    2. 로컬 커밋 확인 — `.version` 파일 우선, git 저장소면 `git rev-parse HEAD`
    3. 다르면 업데이트:
       - git 저장소면 → `git pull origin main --ff-only`
       - 아니면(ZIP 배포) → archive.zip 다운로드 → 보존 규칙에 따라 파일 교체
    4. requirements.txt 변경 감지 → `.venv/.install_ok` 삭제 (시작.bat 이 재설치 트리거)
    5. `.version` 갱신

보존 규칙 (ZIP 모드):
    - PRIVATE/, logs/, .venv/, __pycache__/, .version, .no_auto_update — 절대 안 건드림
    - config/* — 사용자 캘리브레이션 → 보존
    - config/forms/_defaults/* — 배포 원본 → 예외적으로 업데이트

기능:
    - SSL 검증 실패 시 자동 unverified 재시도 (회사 프록시 대응)
    - private repo 대비 Authorization 헤더 유지 redirect handler
    - ZIP 모드는 실패 시 이전 파일 복원 (원자적 교체)
    - .no_auto_update 마커 파일 있으면 스킵
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


# ─────────────────────────────────────────────────────────────
# 저장소 정보 (환경변수로 override 가능)
# ─────────────────────────────────────────────────────────────
DEFAULT_OWNER = os.environ.get("RPA_NCR_OWNER", "Zel-da")
DEFAULT_REPO = os.environ.get("RPA_NCR_REPO", "Code-Transformer")
DEFAULT_BRANCH = os.environ.get("RPA_NCR_BRANCH", "main")
SUBDIR = "rpa-ncr"  # 저장소 내 rpa-ncr 서브폴더만 사용


# ─────────────────────────────────────────────────────────────
# 파일 마커
# ─────────────────────────────────────────────────────────────
VERSION_FILE = ".version"
DISABLE_MARKER = ".no_auto_update"
INSTALL_OK_MARKER = os.path.join(".venv", ".install_ok")
TOKEN_FILE = os.path.join("PRIVATE", "gh_token.txt")  # private repo 대비 (public 이면 무시됨)


# 최상위 보존 (rpa-ncr/ 기준)
_PRESERVE_TOP = {"PRIVATE", "logs", ".venv", "__pycache__"}
_PRESERVE_FILES = {VERSION_FILE, DISABLE_MARKER}


# ─────────────────────────────────────────────────────────────
# SSL / 인증 유틸 (OCR_EU 이식)
# ─────────────────────────────────────────────────────────────
class _AuthPreservingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """리다이렉트 시 Authorization 헤더를 유지한다.

    Python 기본 HTTPRedirectHandler 는 다른 호스트로 리다이렉트 시 Authorization 헤더를
    제거한다 (보안). 하지만 GitHub API assets endpoint 는 항상 S3 로 리다이렉트하는데
    헤더를 제거하면 인증 실패. private repo 대비.
    """
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        auth = req.headers.get("Authorization")
        if auth and new_req is not None:
            new_req.add_header("Authorization", auth)
        return new_req


def _build_ssl_context(verify: bool = True) -> ssl.SSLContext:
    """HTTPS 컨텍스트 구성. verify=False 면 검증 비활성화 (프록시 SSL 인터셉트 대응)."""
    if not verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    try:
        import certifi  # optional
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _build_opener(ctx: ssl.SSLContext):
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ctx),
        _AuthPreservingRedirectHandler,
    )


def _urlopen_with_ssl_fallback(req: urllib.request.Request, timeout: float = 30.0):
    """SSL 검증 실패 시 unverified 로 자동 재시도."""
    try:
        return _build_opener(_build_ssl_context(verify=True)).open(req, timeout=timeout)
    except urllib.error.URLError as e:
        reason = str(getattr(e, "reason", ""))
        if "CERTIFICATE_VERIFY_FAILED" in reason or "SSL" in reason.upper():
            _log(f"SSL 검증 실패 → unverified 재시도 (프록시 SSL 인터셉트 가능성): {reason}")
            return _build_opener(_build_ssl_context(verify=False)).open(req, timeout=timeout)
        raise


def _auth_headers() -> dict[str, str]:
    """PRIVATE/gh_token.txt 있으면 Authorization 헤더 추가 (private repo 대비)."""
    headers = {
        "User-Agent": "rpa-ncr-updater/1.0",
        "Accept": "application/vnd.github+json",
    }
    if os.path.isfile(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, encoding="utf-8") as f:
                token = f.read().strip()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        except Exception:
            pass
    return headers


# ─────────────────────────────────────────────────────────────
# 로깅 (logger 로드 실패해도 print 폴백)
# ─────────────────────────────────────────────────────────────
try:
    from src.utils.logger import get_logger
    _logger = get_logger(__name__)

    def _log(msg: str, level: str = "info") -> None:
        getattr(_logger, level if level in ("info", "warning", "error") else "info")(msg)
        print(f"[update] {msg}")
except Exception:
    def _log(msg: str, level: str = "info") -> None:
        print(f"[update] {msg}")


# ─────────────────────────────────────────────────────────────
# 커밋 해시 조회
# ─────────────────────────────────────────────────────────────
def _get_local_commit(root: Path) -> str:
    """로컬 커밋 SHA — .version 우선, 없으면 git rev-parse HEAD."""
    version_file = root / VERSION_FILE
    if version_file.is_file():
        try:
            sha = version_file.read_text(encoding="utf-8").strip()
            if sha:
                return sha
        except Exception:
            pass
    # git 저장소면 HEAD 조회
    if (root / ".git").exists() or (root.parent / ".git").exists():
        try:
            r = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                return r.stdout.strip()
        except Exception:
            pass
    return ""


def _get_remote_commit_via_git(root: Path, branch: str, timeout: float = 10.0) -> str:
    """git ls-remote 로 원격 브랜치 HEAD 조회 (private 도 credential 로 인증됨)."""
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "ls-remote",
             f"https://github.com/{DEFAULT_OWNER}/{DEFAULT_REPO}.git",
             f"refs/heads/{branch}"],
            capture_output=True, text=True, timeout=timeout,
        )
        if r.returncode == 0 and r.stdout.strip():
            first = r.stdout.strip().splitlines()[0]
            sha = first.split()[0]
            if len(sha) == 40:
                return sha
    except Exception as e:
        _log(f"git ls-remote 실패: {e}", "warning")
    return ""


def _get_remote_commit_via_api(owner: str, repo: str, branch: str, timeout: float = 10.0) -> tuple[str, str]:
    """GitHub API 로 최신 커밋 SHA 와 메시지 조회. 반환 (sha, message)."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{branch}"
    req = urllib.request.Request(url, headers=_auth_headers())
    try:
        with _urlopen_with_ssl_fallback(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("sha", ""), data.get("commit", {}).get("message", "")
    except Exception as e:
        _log(f"GitHub API 원격 커밋 조회 실패: {e}", "warning")
        return "", ""


def _get_remote_commit(root: Path, owner: str, repo: str, branch: str) -> tuple[str, str]:
    """원격 SHA + 메시지 — git 우선, API 폴백."""
    if _git_available():
        sha = _get_remote_commit_via_git(root, branch)
        if sha:
            _, msg = _get_remote_commit_via_api(owner, repo, branch)  # 메시지만 보충
            return sha, msg
    return _get_remote_commit_via_api(owner, repo, branch)


def _git_available() -> bool:
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def _is_git_repo(root: Path) -> bool:
    """rpa-ncr 폴더가 git 저장소의 일부인지 (부모까지 확인)."""
    p = root.resolve()
    for candidate in [p, *p.parents]:
        if (candidate / ".git").exists():
            return True
    return False


# ─────────────────────────────────────────────────────────────
# 보존 규칙
# ─────────────────────────────────────────────────────────────
def _should_preserve(rel_path: str) -> bool:
    """rel_path(POSIX) 가 보존 대상인지 판정."""
    if rel_path in _PRESERVE_FILES:
        return True
    top = rel_path.split("/", 1)[0]
    if top in _PRESERVE_TOP:
        return True
    if top == "config":
        # _defaults 는 업데이트 대상, 나머지 config 는 보존
        if rel_path.startswith("config/forms/_defaults/"):
            return False
        return True
    return False


# ─────────────────────────────────────────────────────────────
# 업데이트 실행
# ─────────────────────────────────────────────────────────────
def check_for_update(root: Path, owner: str = DEFAULT_OWNER,
                     repo: str = DEFAULT_REPO, branch: str = DEFAULT_BRANCH) -> dict[str, Any]:
    """업데이트 필요 여부 확인.

    반환: {
        "update_available": bool,
        "local": str,           # 로컬 SHA (없으면 "")
        "remote": str,          # 원격 SHA (없으면 "")
        "remote_message": str,  # 최신 커밋 메시지 첫 줄
        "mode": "git" | "zip",  # 실제 사용될 업데이트 방식
        "disabled": bool,       # .no_auto_update 존재
        "reason": str,          # 실패/특이사항
    }
    """
    if (root / DISABLE_MARKER).exists():
        return {"update_available": False, "local": "", "remote": "", "remote_message": "",
                "mode": "git" if _is_git_repo(root) else "zip",
                "disabled": True, "reason": ".no_auto_update 마커 존재"}

    local = _get_local_commit(root)
    remote, remote_msg = _get_remote_commit(root, owner, repo, branch)
    mode = "git" if (_is_git_repo(root) and _git_available()) else "zip"

    if not remote:
        return {"update_available": False, "local": local, "remote": "", "remote_message": "",
                "mode": mode, "disabled": False,
                "reason": "원격 조회 실패 (네트워크/rate limit/private repo)"}

    if not local:
        # 첫 실행 — 다운로드하지 않고 현재 원격을 기록만
        return {"update_available": False, "local": "", "remote": remote,
                "remote_message": (remote_msg or "").split("\n", 1)[0][:200],
                "mode": mode, "disabled": False,
                "reason": "로컬 .version 없음 — 첫 실행으로 처리, 원격 기록"}

    return {
        "update_available": local != remote,
        "local": local,
        "remote": remote,
        "remote_message": (remote_msg or "").split("\n", 1)[0][:200],
        "mode": mode,
        "disabled": False,
        "reason": "",
    }


def _perform_git_update(root: Path, branch: str = DEFAULT_BRANCH) -> dict[str, Any]:
    """git pull origin <branch> --ff-only."""
    _log(f"git pull 시작: {root}")

    req_before = _hash_file(root / "requirements.txt")

    try:
        r = subprocess.run(
            ["git", "-C", str(root), "pull", "origin", branch, "--ff-only"],
            capture_output=True, text=True, timeout=120,
        )
    except Exception as e:
        return {"success": False, "message": f"git 실행 실패: {e}", "requirements_changed": False}

    if r.returncode != 0:
        return {"success": False,
                "message": f"git pull 실패:\n{(r.stderr or r.stdout)[:500]}",
                "requirements_changed": False}

    req_after = _hash_file(root / "requirements.txt")
    req_changed = bool(req_before and req_after and req_before != req_after)

    return {"success": True,
            "message": r.stdout.strip() or "이미 최신 상태",
            "requirements_changed": req_changed}


def _perform_zip_update(root: Path, sha: str, owner: str = DEFAULT_OWNER,
                        repo: str = DEFAULT_REPO) -> dict[str, Any]:
    """archive.zip 다운로드 → 보존 규칙 적용해 파일 교체 (실패 시 자동 복원).

    1. 백업 폴더에 현재 rpa-ncr/ 스냅샷 (보존 대상 제외 파일들만)
    2. archive 다운로드/추출
    3. 파일 복사 (보존 규칙 적용)
    4. 실패 시 백업에서 복원
    5. 성공 시 이전 백업 정리 (최근 1개만 유지)
    """
    url = f"https://github.com/{owner}/{repo}/archive/{sha}.zip"
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip"); tmp_zip.close()
    extract_dir = tempfile.mkdtemp()
    backup_dir = root / f"backup_before_{sha[:7]}"

    req_before = _hash_file(root / "requirements.txt")

    try:
        # 1. 백업 (교체 대상 파일만)
        _log("백업 폴더 생성 중...")
        _cleanup_old_backups(root)
        backup_dir.mkdir(exist_ok=True)

        # 2. 다운로드
        _log(f"archive 다운로드: {url}")
        req = urllib.request.Request(url, headers=_auth_headers())
        with _urlopen_with_ssl_fallback(req, timeout=120) as resp, open(tmp_zip.name, "wb") as f:
            shutil.copyfileobj(resp, f)

        # 3. 압축 해제
        _log("압축 해제 중...")
        with zipfile.ZipFile(tmp_zip.name) as z:
            z.extractall(extract_dir)
        tops = [d for d in os.listdir(extract_dir)
                if os.path.isdir(os.path.join(extract_dir, d))]
        if not tops:
            return {"success": False, "message": "압축 구조 이상", "requirements_changed": False}
        src_rpa = os.path.join(extract_dir, tops[0], SUBDIR)
        if not os.path.isdir(src_rpa):
            return {"success": False, "message": f"압축 내 {SUBDIR}/ 없음",
                    "requirements_changed": False}

        # 4. 파일 교체 (보존 규칙 적용, 실패 시 예외로 롤백)
        _log("파일 교체 중...")
        copied, skipped = _copy_with_backup(src_rpa, root, backup_dir)

        req_after = _hash_file(root / "requirements.txt")
        req_changed = bool(req_before and req_after and req_before != req_after)

        _log(f"업데이트 완료: 복사 {copied}, 보존 {skipped}")
        return {"success": True,
                "message": f"복사 {copied}개 / 보존 {skipped}개",
                "requirements_changed": req_changed}

    except Exception as e:
        _log(f"업데이트 실패, 백업에서 복원: {e}", "error")
        _restore_from_backup(backup_dir, root)
        return {"success": False, "message": f"업데이트 실패 (백업 복원됨): {e}",
                "requirements_changed": False}
    finally:
        try:
            os.remove(tmp_zip.name)
        except Exception:
            pass
        shutil.rmtree(extract_dir, ignore_errors=True)


def _copy_with_backup(src_rpa: str, root: Path, backup_dir: Path) -> tuple[int, int]:
    """src_rpa 를 root 로 복사. 기존 파일은 backup_dir 에 백업. 보존 규칙 적용."""
    copied = skipped = 0
    for cur_root, _dirs, files in os.walk(src_rpa):
        for fname in files:
            src_file = os.path.join(cur_root, fname)
            rel = os.path.relpath(src_file, src_rpa).replace("\\", "/")
            if _should_preserve(rel):
                skipped += 1
                continue
            dst_file = root / rel
            # 기존 파일 백업
            if dst_file.is_file():
                bak = backup_dir / rel
                bak.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst_file, bak)
            # 새 파일 복사
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dst_file)
            copied += 1
    return copied, skipped


def _restore_from_backup(backup_dir: Path, root: Path) -> None:
    """실패 시 백업의 모든 파일을 원래 위치로 복원."""
    if not backup_dir.exists():
        return
    for cur_root, _dirs, files in os.walk(backup_dir):
        for fname in files:
            src = os.path.join(cur_root, fname)
            rel = os.path.relpath(src, backup_dir)
            dst = root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(src, dst)
            except Exception as e:
                _log(f"복원 실패 '{rel}': {e}", "warning")


def _cleanup_old_backups(root: Path) -> None:
    """이전 backup_before_* 폴더 삭제 (최신 1개만 유지 정책, OCR_EU 방식)."""
    for entry in root.iterdir():
        if entry.is_dir() and entry.name.startswith("backup_before_"):
            shutil.rmtree(entry, ignore_errors=True)


def apply_update(root: Path, sha: str, mode: str) -> dict[str, Any]:
    """모드에 따라 git 또는 zip 업데이트 실행. 성공 시 .version 갱신."""
    if mode == "git":
        result = _perform_git_update(root)
    else:
        result = _perform_zip_update(root, sha)

    if result.get("success"):
        # .version 갱신
        try:
            (root / VERSION_FILE).write_text(sha, encoding="utf-8")
        except Exception as e:
            _log(f".version 저장 실패: {e}", "warning")

        # requirements 변경 시 재설치 유도
        if result.get("requirements_changed"):
            install_ok = root / INSTALL_OK_MARKER
            if install_ok.exists():
                try:
                    install_ok.unlink()
                    _log("requirements.txt 변경 감지 → .install_ok 삭제 (다음 실행 시 재설치)")
                except Exception:
                    pass

    return result


# ─────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────
def _hash_file(path: Path) -> str:
    if not path.is_file():
        return ""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except Exception:
        return ""


def run(root: Path, check_only: bool = False, force: bool = False) -> int:
    """CLI 진입점 (update.py 에서 호출). 반환: exit code."""
    status = check_for_update(root)

    if status["disabled"]:
        _log(status["reason"])
        return 0

    if not status["remote"]:
        _log(status["reason"] or "원격 조회 실패")
        return 0

    if not status["local"]:
        # 첫 실행 — .version 기록만
        try:
            (root / VERSION_FILE).write_text(status["remote"], encoding="utf-8")
            _log(f"첫 실행 — 현재 파일을 {status['remote'][:7]} 로 기록")
        except Exception as e:
            _log(f".version 저장 실패: {e}", "warning")
        return 0

    if not status["update_available"] and not force:
        _log(f"최신 버전 사용 중 ({status['local'][:7]})")
        return 0

    if check_only:
        _log(f"새 버전 있음: {status['local'][:7]} → {status['remote'][:7]}")
        if status["remote_message"]:
            _log(f"  '{status['remote_message']}'")
        return 1

    _log(f"새 버전 발견: {status['local'][:7]} → {status['remote'][:7]} ({status['mode']} 모드)")
    if status["remote_message"]:
        _log(f"  '{status['remote_message']}'")

    result = apply_update(root, status["remote"], status["mode"])
    if result["success"]:
        _log(f"업데이트 완료 → {status['remote'][:7]}  ({result['message']})")
        return 0
    else:
        _log(f"업데이트 실패: {result['message']}", "error")
        return 2
