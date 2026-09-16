#!/usr/bin/env python3
"""Optional developer asset optimization (ImageMagick).

Try lossless PNG encodings and keep a smaller file only after comparing all
RGBA samples, including transparent pixels. Installation icons use standard
8-bit channels; crest/forum artwork retains its original samples. No CI dependency.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def pixels(path, depth):
    return subprocess.check_output(['convert', str(path), '-depth', depth, 'rgba:-'])


def main():
    total_before = total_after = 0
    with tempfile.TemporaryDirectory(prefix='rhw-png-') as folder:
        for path in sorted((ROOT / 'assets').glob('*.png')):
            sample_depth = '8' if path.name.startswith(('pwa-icon-', 'apple-touch-icon', 'favicon')) else '16'
            original = pixels(path, sample_depth)
            before = path.stat().st_size
            best = path.read_bytes()
            for depth in ('8', '16'):
                for strategy in ('0', '1', '2'):
                    candidate = Path(folder) / f'{path.stem}-{depth}-{strategy}.png'
                    subprocess.run(['convert', str(path), '-strip', '-depth', depth,
                        '-define', 'png:compression-level=9', '-define', f'png:compression-strategy={strategy}',
                        str(candidate)], check=True)
                    if candidate.stat().st_size < len(best) and pixels(candidate, sample_depth) == original:
                        best = candidate.read_bytes()
            if len(best) < before:
                path.write_bytes(best)
            total_before += before
            total_after += len(best)
            print(f'{path.name}: {before:,} -> {len(best):,} bytes; exact {sample_depth}-bit RGBA preserved')
    print(f'Total saved: {total_before - total_after:,} bytes ({100 * (1 - total_after / total_before):.1f}%)')


if __name__ == '__main__':
    main()
