import json
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app import schema_migrations as migrations


@pytest.mark.parametrize("first_record", [None, "001_first.sql", "20261119162312_first.sql"])
def test_timestamp_migrations_recognize_legacy_and_current_records(tmp_path, monkeypatch, first_record):
    first, second = "20261119162312_first.sql", "20261119162313_second.sql"
    (tmp_path / first).write_text("CREATE TABLE first_table(id integer)", encoding="utf8")
    (tmp_path / second).write_text("CREATE TABLE second_table(id integer)", encoding="utf8")
    (tmp_path / "legacy_names.json").write_text(json.dumps({"001_first.sql": first, "002_second.sql": second}), encoding="utf8")
    engine = create_engine("sqlite://")
    tracking = "CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY)"
    with engine.begin() as conn:
        conn.execute(text(tracking))
        if first_record:
            conn.execute(text("CREATE TABLE first_table(id integer)"))
            conn.execute(text("INSERT INTO schema_migrations VALUES (:f)"), {"f": first_record})
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", str(tmp_path))
    monkeypatch.setattr(migrations, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(migrations, "_TRACK_TABLE", tracking)
    expected = [second] if first_record else [first, second]
    assert migrations.pending_files() == expected
    assert migrations.run_all() == expected
    assert migrations.pending_files() == []
    assert migrations.run_all() == []
    assert {"first_table", "second_table"} <= set(inspect(engine).get_table_names())
    with engine.connect() as conn:
        records = set(conn.execute(text("SELECT filename FROM schema_migrations")).scalars())
    # 历史记录保持原名，不补写、不重写已执行的迁移。
    assert records == set(expected) | ({first_record} if first_record else set())


def test_duplicate_legacy_numbers_are_matched_by_full_filename(tmp_path, monkeypatch):
    aliases = {"047_formula.sql": "20261119162312_formula.sql", "047_mcp.sql": "20261119162313_mcp.sql"}
    (tmp_path / "legacy_names.json").write_text(json.dumps(aliases), encoding="utf8")
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", str(tmp_path))
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE schema_migrations(filename text)"))
        conn.execute(text("INSERT INTO schema_migrations VALUES ('047_formula.sql')"))
        done = migrations.applied_files(conn)
    assert aliases["047_formula.sql"] in done
    assert aliases["047_mcp.sql"] not in done


def test_non_timestamp_new_filename_is_rejected(tmp_path, monkeypatch):
    (tmp_path / "064_new.sql").write_text("SELECT 1", encoding="utf8")
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="14 位时间戳"):
        migrations._listed_files()


def test_repository_aliases_cover_all_renamed_files_in_original_order():
    folder = Path(__file__).resolve().parents[1] / "schema" / "migrations"
    aliases = json.loads((folder / "legacy_names.json").read_text(encoding="utf8"))
    files = sorted(p.name for p in folder.glob("*.sql"))
    assert len(aliases) == len(set(aliases.values()))
    assert [aliases[name] for name in sorted(aliases)] == files
    assert all(re.fullmatch(r"\d{14}_.+\.sql", name) for name in files)
