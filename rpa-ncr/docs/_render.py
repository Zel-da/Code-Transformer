"""docs/*.md 를 통일 스타일의 HTML 로 렌더한다.

각 MD 파일 상단에 아래 형식의 프론트매터 헤더를 넣으면 자동 반영:
    <!--
    title: 문서 제목
    role: worker | qc | operator | admin  (선택, 배지 색)
    subtitle: 부제
    -->

사용:
    python docs/_render.py           # 전체 렌더
    python docs/_render.py 파일명.md   # 개별 렌더
"""
import re
import sys
from pathlib import Path

try:
    import markdown  # type: ignore
except ImportError:
    print("ERROR: pip install --user markdown 먼저 실행하세요.")
    sys.exit(1)

DOCS = Path(__file__).resolve().parent
CSS_FILE = "_shared.css"

FRONTMATTER_RE = re.compile(r"^<!--\s*(.*?)\s*-->\s*", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """HTML 주석 형태의 간이 프론트매터를 파싱한다."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    body = m.group(1)
    meta: dict[str, str] = {}
    for line in body.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, text[m.end():]


def role_badge(role: str) -> str:
    labels = {
        "worker":   ("현장 작업자",  "role-worker"),
        "qc":       ("QC 담당자",    "role-qc"),
        "operator": ("RPA 운영자",   "role-operator"),
        "admin":    ("IT/관리자",    "role-admin"),
    }
    if role not in labels:
        return ""
    label, cls = labels[role]
    return f'<span class="role-badge {cls}">{label}</span>'


def render_one(md_path: Path) -> Path:
    src = md_path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(src)

    title = meta.get("title", md_path.stem)
    subtitle = meta.get("subtitle", "")
    role = meta.get("role", "")

    html_body = markdown.markdown(
        body,
        extensions=[
            "tables",
            "fenced_code",
            "attr_list",
            "sane_lists",
            "toc",
            "md_in_html",  # <div markdown="1"> 안에서도 마크다운 재활성화
        ],
        output_format="html5",
    )

    # blockquote 클래스 지원 (예: > [!warn] 문구)
    html_body = re.sub(
        r"<blockquote>\s*<p>\[!(warn|info)\]\s*",
        r'<blockquote class="\1"><p>',
        html_body,
    )

    header = f'<h1>{title}{role_badge(role)}</h1>'
    if subtitle:
        header += f'<div class="subtitle">{subtitle}</div>'

    footer = '<div class="doc-footer"><a href="INDEX.html">← 문서 목차로</a></div>'

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="stylesheet" href="{CSS_FILE}">
</head>
<body>
{header}
{html_body}
{footer}
</body>
</html>
"""

    out = md_path.with_suffix(".html")
    out.write_text(html, encoding="utf-8")
    return out


def main() -> int:
    args = sys.argv[1:]
    if args:
        targets = [DOCS / a for a in args]
    else:
        # _ 로 시작하는 파일은 부속 자료(스크립트/CSS) — 제외
        targets = sorted(p for p in DOCS.glob("*.md") if not p.name.startswith("_"))

    count = 0
    for p in targets:
        if not p.exists():
            print(f"SKIP {p} (not found)")
            continue
        out = render_one(p)
        print(f"OK {p.name} -> {out.name}")
        count += 1
    print(f"\n렌더 완료: {count}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
