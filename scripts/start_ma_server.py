"""Run a month's MA report server on a configurable port.

macOS reserves port 5000 for Control Center, so the dataset's hardcoded
port-5000 servers are launched through this wrapper instead.

Usage:
    python scripts/start_ma_server.py "OneRecon_DataSet/Current Data/august/ma_api_server_202608.py"
    MA_PORT=5001 (default)
"""
import importlib.util
import os
import sys

path = sys.argv[1]
port = int(os.environ.get("MA_PORT", "5001"))

spec = importlib.util.spec_from_file_location("ma_server", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # loads the embedded dataset records

print(f"[ma] {os.path.basename(path)} loaded, serving on http://127.0.0.1:{port}")
mod.app.run(host="0.0.0.0", port=port, debug=False)