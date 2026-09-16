#!/usr/bin/env python3
"""Canonical RHW browser entry point. All assets and routes come from manifests."""
from smoke_v40_base import *  # noqa: F401,F403

if __name__ == '__main__':
    from smoke_workflows import main
    raise SystemExit(main())
