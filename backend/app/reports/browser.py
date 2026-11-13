"""服务端渲染 —— 无头 Chrome 把自包含 HTML 报表转成 PDF / PNG.

约定：
    * 只用本机 Chrome / Chromium，不引入额外 Python 依赖；
    * 找不到浏览器或渲染失败只返回错误字符串：HTML / Excel 照常生成，不影响报表本身；
    * PDF 走 `--print-to-pdf`（自动分页）；PNG 走 CDP `Page.captureScreenshot(captureBeyondViewport)`
      截整页（`--screenshot` 只截视口，长报表会被裁掉）；
    * 配置：`BI_PDF_CHROME`（浏览器路径）、`BI_PDF_TIMEOUT`（默认 30s）、`BI_PDF_PNG_WIDTH`（默认 1240）、
      `BI_PDF_PNG_SCALE`（默认 2，即 2 倍图）。
"""

from __future__ import annotations

import base64
import json
import os
import select
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)


def chrome_path() -> str | None:
    """浏览器可执行文件；`BI_PDF_CHROME` 优先（配了但不存在视为未安装）."""
    env = str(os.getenv("BI_PDF_CHROME", "") or "").strip()
    if env:
        return env if os.path.exists(env) else None
    for path in _CANDIDATES:
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _timeout() -> float:
    try:
        return max(5.0, float(os.getenv("BI_PDF_TIMEOUT", "30") or "30"))
    except ValueError:
        return 30.0


def _png_size() -> tuple[int, float]:
    try:
        width = max(480, int(os.getenv("BI_PDF_PNG_WIDTH", "1240") or "1240"))
    except ValueError:
        width = 1240
    try:
        scale = min(3.0, max(1.0, float(os.getenv("BI_PDF_PNG_SCALE", "2") or "2")))
    except ValueError:
        scale = 2.0
    return width, scale


def _file_url(path: str) -> str:
    return Path(path).resolve().as_uri()


def _cleanup(profile: str, proc: subprocess.Popen | None = None) -> None:
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    shutil.rmtree(profile, ignore_errors=True)


def print_pdf(html_path: str, pdf_path: str, timeout: float | None = None) -> str:
    """HTML → PDF（A4 自动分页）；成功返回空字符串，失败返回原因."""
    chrome = chrome_path()
    if not chrome:
        return "未找到 Chrome/Chromium（可设 BI_PDF_CHROME）"
    profile = tempfile.mkdtemp(prefix="mzbi-chrome-")
    os.makedirs(os.path.dirname(pdf_path) or ".", exist_ok=True)
    try:
        result = subprocess.run(
            [
                chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                f"--user-data-dir={profile}", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf_path}", _file_url(html_path),
            ],
            capture_output=True, text=True, timeout=timeout or _timeout(),
        )
        if not os.path.exists(pdf_path) or os.path.getsize(pdf_path) == 0:
            detail = (result.stderr or result.stdout or "").strip().splitlines()
            return (detail[-1] if detail else f"Chrome 退出码 {result.returncode}")[:300]
        return ""
    except subprocess.TimeoutExpired:
        return "PDF 渲染超时"
    except Exception as exc:
        return str(exc)[:300]
    finally:
        _cleanup(profile)


def _devtools_endpoint(proc: subprocess.Popen, timeout: float) -> tuple[int, str]:
    """从 Chrome stderr 里读出 `DevTools listening on ws://127.0.0.1:PORT/...`."""
    deadline = time.time() + timeout
    stderr = proc.stderr
    assert stderr is not None
    while time.time() < deadline:
        ready, _, _ = select.select([stderr], [], [], max(0.1, deadline - time.time()))
        if not ready:
            break
        line = stderr.readline()
        if not line:
            break
        if "DevTools listening on ws://" in line:
            endpoint = line.split("DevTools listening on ", 1)[1].strip()
            host_port = endpoint.split("ws://", 1)[1].split("/", 1)[0]
            return int(host_port.rsplit(":", 1)[1]), endpoint
    raise TimeoutError("Chrome 调试端口未就绪")


def _call(ws, msg_id: int, method: str, params: dict | None = None,
          timeout: float = 20.0) -> dict:
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = json.loads(ws.recv(timeout=max(0.1, deadline - time.time())))
        if data.get("id") != msg_id:
            continue
        if data.get("error"):
            raise RuntimeError(str(data["error"])[:300])
        return data.get("result") or {}
    raise TimeoutError(f"{method} 超时")


def _wait_event(ws, name: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = json.loads(ws.recv(timeout=max(0.1, deadline - time.time())))
        if data.get("method") == name:
            return
    raise TimeoutError(f"等待 {name} 超时")


def screenshot_png(html_path: str, png_path: str, timeout: float | None = None) -> str:
    """HTML → 整页 PNG（默认 1240 宽 × 2 倍图）；成功返回空字符串，失败返回原因."""
    chrome = chrome_path()
    if not chrome:
        return "未找到 Chrome/Chromium（可设 BI_PDF_CHROME）"
    width, scale = _png_size()
    profile = tempfile.mkdtemp(prefix="mzbi-chrome-")
    proc: subprocess.Popen | None = None
    ws = None
    try:
        import requests
        from websockets.sync.client import connect

        proc = subprocess.Popen(
            [
                chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                f"--user-data-dir={profile}", "--remote-debugging-port=0",
                "--hide-scrollbars", "about:blank",
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        port, _ = _devtools_endpoint(proc, timeout or _timeout())
        target = requests.put(
            f"http://127.0.0.1:{port}/json/new", params={"url": _file_url(html_path)},
            timeout=min(10.0, timeout or _timeout()),
        )
        target.raise_for_status()
        ws = connect(target.json()["webSocketDebuggerUrl"], max_size=None, open_timeout=10)
        _call(ws, 1, "Page.enable")
        _call(ws, 2, "Emulation.setDeviceMetricsOverride", {
            "width": width, "height": 900, "deviceScaleFactor": scale, "mobile": False,
        })
        _call(ws, 3, "Page.navigate", {"url": _file_url(html_path)})
        _wait_event(ws, "Page.loadEventFired", timeout=timeout or _timeout())
        metrics = _call(ws, 4, "Page.getLayoutMetrics")
        size = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
        height = max(200.0, float(size.get("height") or 900))
        shot = _call(ws, 5, "Page.captureScreenshot", {
            "format": "png", "captureBeyondViewport": True, "fromSurface": True,
            "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
        })
        os.makedirs(os.path.dirname(png_path) or ".", exist_ok=True)
        with open(png_path, "wb") as fh:
            fh.write(base64.b64decode(shot["data"]))
        if os.path.getsize(png_path) == 0:
            return "PNG 渲染结果为空"
        return ""
    except subprocess.TimeoutExpired:
        return "PNG 渲染超时"
    except Exception as exc:
        return str(exc)[:300]
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        _cleanup(profile, proc)


__all__ = ["chrome_path", "print_pdf", "screenshot_png"]
