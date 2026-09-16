"""Entry point: `python -m backend`.

`python backend/app.py` cannot work - app.py uses relative imports, so running
it as a script fails on the first import, before reaching any main block. This
module runs uvicorn with the HOST and PORT from .env, which also keeps the LAN
URL reported by /api/network-info consistent with the port actually served.
"""
import os
import threading
import webbrowser

import uvicorn

from .config import HOST, PORT


def _open_browser_when_up() -> None:
    """Open the app in the default browser shortly after the server binds.

    Opt-in via XPDECK_OPEN_BROWSER so the launcher scripts get it but running
    the server directly does not hijack a browser window.
    """
    if os.getenv("XPDECK_OPEN_BROWSER") != "1":
        return
    # 0.0.0.0 means "all interfaces" and is not a usable address in a browser
    host = "localhost" if HOST in ("0.0.0.0", "::", "") else HOST
    threading.Timer(1.5, webbrowser.open, [f"http://{host}:{PORT}"]).start()


if __name__ == "__main__":
    _open_browser_when_up()
    uvicorn.run("backend.app:app", host=HOST, port=PORT)
