"""定时报表纯函数回归：排期计算 + 签名下载链接（不连库）."""

from __future__ import annotations

from datetime import datetime
import sys

import pytest

from app.reports import browser, generate, scheduler, tokens


def test_daily_next_run_before_time() -> None:
    now = datetime(2026, 11, 13, 8, 0)
    assert scheduler.next_run_at("daily", "09:30", after=now) == datetime(2026, 11, 13, 9, 30)


def test_daily_next_run_after_time_rolls_to_tomorrow() -> None:
    now = datetime(2026, 11, 13, 9, 30)
    assert scheduler.next_run_at("daily", "09:30", after=now) == datetime(2026, 11, 14, 9, 30)


def test_weekly_same_day_future() -> None:
    # 2026-11-13 是周五（isoweekday=5）
    now = datetime(2026, 11, 13, 8, 0)
    assert scheduler.next_run_at("weekly", "10:00", 5, after=now) == datetime(2026, 11, 13, 10, 0)


def test_weekly_same_day_passed_rolls_one_week() -> None:
    now = datetime(2026, 11, 13, 11, 0)
    assert scheduler.next_run_at("weekly", "10:00", 5, after=now) == datetime(2026, 11, 20, 10, 0)


def test_weekly_next_day() -> None:
    now = datetime(2026, 11, 13, 11, 0)
    assert scheduler.next_run_at("weekly", "09:00", 1, after=now) == datetime(2026, 11, 16, 9, 0)


def test_parse_time_fallback() -> None:
    assert scheduler.parse_time("07:05") == (7, 5)
    assert scheduler.parse_time("25:00") == (9, 0)
    assert scheduler.parse_time("") == (9, 0)


def test_token_roundtrip() -> None:
    token = tokens.sign_run(12, "html")
    assert tokens.verify_run(token) == (12, "html")
    assert tokens.verify_run(token + "x") is None
    assert tokens.verify_run("bad") is None


def test_token_expired() -> None:
    token = tokens.sign_run(3, "xlsx", ttl=-1)
    assert tokens.verify_run(token) is None


def test_token_pdf_roundtrip() -> None:
    token = tokens.sign_run(9, "pdf")
    assert tokens.verify_run(token) == (9, "pdf")


def test_chrome_missing_returns_error(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BI_PDF_CHROME", str(tmp_path / "not-exists"))
    assert browser.chrome_path() is None
    assert "Chrome" in browser.print_pdf(str(tmp_path / "a.html"), str(tmp_path / "a.pdf"))


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell fixture; covered by Linux CI")
def test_print_pdf_invokes_chrome(tmp_path, monkeypatch) -> None:
    """用一个假的浏览器脚本验证参数拼装与成功判定（不依赖本机 Chrome）."""
    fake = tmp_path / "fake-chrome"
    fake.write_text(
        "#!/bin/sh\n"
        "for arg in \"$@\"; do\n"
        "  case \"$arg\" in\n"
        "    --print-to-pdf=*) printf '%%PDF-1.4 fake' > \"${arg#--print-to-pdf=}\" ;;\n"
        "  esac\n"
        "done\n"
    )
    fake.chmod(0o755)
    monkeypatch.setenv("BI_PDF_CHROME", str(fake))
    html = tmp_path / "report.html"
    html.write_text("<h1>报表</h1>", encoding="utf-8")
    out = tmp_path / "report.pdf"
    assert browser.print_pdf(str(html), str(out)) == ""
    assert out.read_bytes().startswith(b"%PDF")


def test_render_artifact_rejects_unknown_kind() -> None:
    with pytest.raises(ValueError):
        generate.render_artifact("docx", "/tmp/x.html")
