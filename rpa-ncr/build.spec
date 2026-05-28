# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — NCR → UNIERP RPA 자동 입력 (OCR_EU build.spec 포팅)."""
import os

block_cipher = None
ROOT = os.path.abspath('.')

# uvicorn 내부 모듈 경로 확보 (startup 메시지에 필요)
import uvicorn
uvicorn_dir = os.path.dirname(uvicorn.__file__)

a = Analysis(
    ['main.py'],
    pathex=[ROOT],
    binaries=[],
    datas=[
        (os.path.join(ROOT, 'src', 'web', 'static'), os.path.join('src', 'web', 'static')),
        (os.path.join(ROOT, 'src', 'web', 'templates'), os.path.join('src', 'web', 'templates')),
        (os.path.join(ROOT, 'config'), 'config'),
        (uvicorn_dir, 'uvicorn'),
    ],
    hiddenimports=[
        # FastAPI + uvicorn 체인
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'fastapi',
        'fastapi.staticfiles',
        'fastapi.templating',
        'fastapi.responses',
        'starlette',
        'starlette.staticfiles',
        'starlette.templating',
        'starlette.responses',
        'starlette.routing',
        'starlette.middleware',
        'starlette.exceptions',
        'starlette.concurrency',
        'anyio',
        'anyio._backends',
        'anyio._backends._asyncio',
        'sniffio',
        'websockets',
        'websockets.legacy',
        'websockets.legacy.server',
        'jinja2',
        'pydantic',
        'h11',
        # 앱 자체 모듈
        'src.web.app',
        'src.web.state',
        'src.web.schemas',
        'src.data_source.base',
        'src.data_source.api_source',
        'src.data_source.db_source',
        'src.data_source.report_model',
        'src.rpa.ncr_connector',
        'src.rpa.ncr_field_map',
        'src.rpa.window_controller',
        'src.rpa.input_sequence',
        'src.rpa.fallback_controller',
        'src.utils.config_loader',
        'src.utils.file_utils',
        'src.utils.logger',
        # 데이터 소스 / RPA 의존성
        'requests',
        'psycopg2',
        'dotenv',
        'pyperclip',
        'pywinauto',
        'pyautogui',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', '_tkinter', 'matplotlib', 'scipy', 'notebook', 'IPython',
              'pandas', 'numpy', 'cv2', 'PIL', 'pdfplumber', 'fitz', 'pytesseract'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='RPA_NCR',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='RPA_NCR',
)
