#!/usr/bin/env python3
import runpy
from pathlib import Path

if __name__ == "__main__":
    base = Path(__file__).resolve().parents[3] / "servers" / "stub_servers.py"
    runpy.run_path(str(base), run_name="__main__")
