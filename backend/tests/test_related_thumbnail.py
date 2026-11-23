from types import SimpleNamespace
from unittest.mock import Mock
import subprocess

import pytest

from app.components import related_thumbnail as thumbnails
from app.components.compute import build_table
from app.components.resolver import _request_for
from app.components.spec import ComponentSpec, ComponentSpecError, RelatedThumbnailSpec
from app.semantic.models import Dataset, DatasetField


def dataset(dataset_id=1, source_id=10):
    return Dataset(id=dataset_id, name="资源", physical_table="images", conn_mode="live", source_id=source_id,
                   fields=[DatasetField(i, dataset_id, name, name) for i, name in enumerate(["image_id", "url", "商品"])])


def spec(**config):
    return ComponentSpec(title="明细表", binding={"dataset_id": 1, "dimensions": ["商品"], "top_n": 2},
                         table_view={"related_thumb": {"enabled": True, "local_key": "image_id", "dataset_id": 2,
                                                       "match_key": "image_id", "url_key": "url", **config}})


@pytest.fixture
def access(monkeypatch):
    monkeypatch.setattr(thumbnails, "get_dataset", lambda db, key: dataset(key))
    monkeypatch.setattr(thumbnails, "can_access_dataset", lambda *args: True)


def test_link_uses_one_batch_keeps_rows_order_and_headers(access):
    """明细表不再按 top_n 截断（改为前端分页），缩略图一次批量取回所有行的图."""
    config = spec(operation="prefix", replacement="https://cdn.example/")
    rows = [{"商品": "甲", "image_id": 3}, {"商品": "乙", "image_id": 8}, {"商品": "丙", "image_id": 9}]
    payload = build_table(rows, config)
    assert [row["商品"] for row in payload["rows"]] == ["甲", "乙", "丙"]
    execute = Mock(return_value=SimpleNamespace(rows=[{"image_id": 3, "url": "3.jpg"}]))
    result = thumbnails.attach_thumbnails(None, dataset(), config, payload, None, execute)
    execute.assert_called_once()
    query = execute.call_args.args[2]
    assert query.filters[0].value == [3, 8, 9]
    assert query.table == "images"
    assert [row["商品"] for row in result["rows"]] == ["甲", "乙", "丙"]
    assert [row[thumbnails.THUMB_KEY] for row in result["rows"]] == ["https://cdn.example/3.jpg", "", ""]
    assert result["count"] == 3
    assert result["thumb"] and result["thumb_key"] == thumbnails.THUMB_KEY
    assert [column["key"] for column in result["columns"]] == ["商品"]


def test_query_adds_hidden_link_field_and_does_not_duplicate():
    config = spec()
    assert [column["name"] for column in _request_for(config, "table")["columns"]] == ["商品", "image_id"]
    config.binding.dimensions.append("image_id")
    assert [column["name"] for column in _request_for(config, "table")["columns"]].count("image_id") == 1


def test_link_batches_ids(access):
    config = spec()
    rows = [{"image_id": i} for i in range(501)]
    execute = Mock(return_value=SimpleNamespace(rows=[]))
    result = thumbnails.attach_thumbnails(None, dataset(), config, {"rows": rows}, None, execute)
    assert execute.call_count == 2
    assert len(result["rows"]) == 501


def test_duplicate_ids_raise_configuration_error(access):
    execute = Mock(return_value=SimpleNamespace(rows=[{"image_id": 1, "url": "a"}, {"image_id": 1, "url": "b"}]))
    with pytest.raises(ComponentSpecError, match="不唯一"):
        thumbnails.attach_thumbnails(None, dataset(), spec(), {"rows": [{"image_id": 1}]}, None, execute)


@pytest.mark.parametrize("reason", ["permission", "source"])
def test_rejects_invisible_and_cross_source_resources(access, monkeypatch, reason):
    if reason == "permission":
        monkeypatch.setattr(thumbnails, "can_access_dataset", lambda *args: False)
    else:
        monkeypatch.setattr(thumbnails, "get_dataset", lambda *args: dataset(2, 99))
    execute = Mock()
    with pytest.raises(ComponentSpecError):
        thumbnails.attach_thumbnails(None, dataset(), spec(), {"rows": []}, None, execute)
    execute.assert_not_called()


def test_old_thumbnail_configuration_is_unchanged():
    config = ComponentSpec(title="明细表", table_view={"thumb": True, "thumb_key": "url"})
    payload = {"rows": [{"url": "https://cdn.example/a.jpg"}], "thumb": True, "thumb_key": "url"}
    assert thumbnails.attach_thumbnails(None, None, config, payload, None, Mock()) is payload


@pytest.mark.parametrize("operation,pattern,replacement", [
    ("none", "", ""), ("prefix", "", "https://cdn.example/"),
    ("replace", "old/", "https://cdn.example/"), ("regex", r"^old/(\d+)\.jpg$", r"https://cdn.example/\1.webp"),
])
def test_url_operations_and_null_values(operation, pattern, replacement):
    raw = {"none": "https://cdn.example/7.jpg", "prefix": "7.jpg", "replace": "old/7.jpg", "regex": "old/7.jpg"}[operation]
    expected = "https://cdn.example/7.webp" if operation == "regex" else "https://cdn.example/7.jpg"
    config = RelatedThumbnailSpec(operation=operation, pattern=pattern, replacement=replacement)
    assert thumbnails.transform_urls([raw, None, ""], config) == [expected, "", ""]


def test_rejects_non_web_urls_and_invalid_regex():
    assert thumbnails.transform_urls(["javascript:alert(1)", "/private/file", "https://cdn.example/resource?id=1"], RelatedThumbnailSpec()) == ["", "", "https://cdn.example/resource?id=1"]
    with pytest.raises(ComponentSpecError, match="不合法"):
        thumbnails.transform_urls(["x"], RelatedThumbnailSpec(operation="regex", pattern="["))


def test_regex_timeout_is_reported(monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("regex", 3)
    monkeypatch.setattr(thumbnails.subprocess, "run", timeout)
    with pytest.raises(ComponentSpecError, match="超过 3 秒"):
        thumbnails.transform_urls(["x"], RelatedThumbnailSpec(operation="regex", pattern="x"))


def test_table_choices_only_include_accessible_same_source_tables(access, monkeypatch):
    monkeypatch.setattr(thumbnails, "list_datasets", lambda db: [dataset(2), dataset(3, 99), dataset(4)])
    monkeypatch.setattr(thumbnails, "can_access_dataset", lambda db, target, user: target.id != 4)
    monkeypatch.setattr(thumbnails, "list_fields", lambda db, key: dataset(key).fields)
    assert [table["id"] for table in thumbnails.thumbnail_tables(None, 1, None)["tables"]] == [2]
