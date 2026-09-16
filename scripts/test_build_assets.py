#!/usr/bin/env python3
"""Content revisions must change for every deployed input and remain deterministic."""
from pathlib import Path
import json
import shutil
import tempfile

from build_app_assets import ROOT, build, package_dist


def main():
    with tempfile.TemporaryDirectory(prefix='rhw-build-test-') as folder:
        root = Path(folder) / 'app'
        shutil.copytree(ROOT, root, ignore=shutil.ignore_patterns('.git', 'dist', 'artifacts', '__pycache__'))
        outputs, shell = build(root)
        before = outputs['js/build-info.js']
        for name, content in outputs.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        assert build(root)[0] == outputs, 'A second build must be byte-identical (no self-hashing loop)'
        for name in ['js/core/app.js', 'css/theme.css', 'js/00-bootstrap.js', 'manifest.webmanifest',
                     'assets/recipes/catalog-v1-part-01.js', 'assets/discovery-status.json',
                     'assets/pwa-icon-512.png', 'assets/rhw-forum-logo.png', 'sw.js', 'index.html']:
            path = root / name
            original = path.read_bytes()
            path.write_bytes(original + b'\n')
            changed, _ = build(root)
            assert changed['js/build-info.js'] != before, name
            assert changed['sw.js'] != outputs['sw.js'], 'Worker bytes must change with every release'
            path.write_bytes(original)
        package_dist(outputs, shell, root)
        expected = {ref.removeprefix('./') for ref in shell if ref != './'}
        files = {str(p.relative_to(root / 'dist')) for p in (root / 'dist').rglob('*') if p.is_file()}
        assert expected <= files
        assert not any(name.startswith(('scripts/', 'docs/', '.github/')) for name in files)
        assert not any(name.startswith('js/core/') for name in files), 'Authoring sources must not be deployed'
        assert 'assets/rhw-forum-logo.png' in files
        assert len(files) < 40
        routes_path = root / 'scripts/app-routes.json'
        routes = json.loads(routes_path.read_text())
        routes['legacyRedirects']['command/overview'] = 'command/missing'
        routes_path.write_text(json.dumps(routes))
        try:
            build(root)
            raise AssertionError('Invalid redirect was accepted')
        except ValueError:
            pass
    print('Build contracts passed: deterministic content revisions, worker updates, route validation and runtime-only dist.')


if __name__ == '__main__':
    main()
