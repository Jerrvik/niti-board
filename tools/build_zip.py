#!/usr/bin/env python3
"""Dependency-free module ZIP packager for Foundry VTT (run from repository root)."""
from pathlib import Path
import json
import zipfile

BASE = Path(__file__).resolve().parents[1]
MODULE = BASE / 'src' / 'niti-board'
manifest_file = MODULE / 'module.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
assert manifest['id'] == MODULE.name, 'Manifest id must match folder name'
for key in ('scripts', 'esmodules', 'styles'):
    for path in manifest.get(key, []):
        assert (MODULE / path).is_file(), f'Missing {key}: {path}'
for language in manifest.get('languages', []):
    assert (MODULE / language['path']).is_file(), f'Missing translation: {language["path"]}'

dist = BASE / 'dist'
dist.mkdir(exist_ok=True)
target = dist / 'niti-board.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in sorted(MODULE.rglob('*')):
        if f.is_file(): z.write(f, arcname=str(Path('niti-board') / f.relative_to(MODULE)).replace('\\', '/'))
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None, 'Archive integrity failure'
    names = z.namelist()
    assert 'niti-board/module.json' in names
    assert not any(name.startswith('src/') for name in names)
    parsed = json.loads(z.read('niti-board/module.json'))
    assert parsed['id'] == 'niti-board'
print(f'Built {target} ({target.stat().st_size} bytes; version {manifest["version"]})')
