"""组件导出 / 导入的纯函数：文件结构、dataset_id 重写、导入校验（不连库）."""

import pytest

from app.components.transfer import (
    EXPORT_FORMAT,
    build_payload,
    first_dataset_id,
    normalize_payload,
    remap_dataset_ids,
)


def component(**over):
    return {
        "code": "base.table", "name": "明细表", "kind": "table",
        "category": "明细", "description": "榜单商品明细",
        "spec": {"binding": {"dataset_id": 10, "dimensions": ["item_id"]}},
        **over,
    }


def test_build_payload_shape():
    out = build_payload(component(), {"id": 10, "name": "测试-01", "physical_table": "bi_demo_sku"})
    assert out["format"] == EXPORT_FORMAT
    assert out["version"] >= 1
    assert out["exported_at"]
    assert out["component"]["kind"] == "table"
    assert out["component"]["spec"]["binding"]["dataset_id"] == 10
    assert out["dataset"]["physical_table"] == "bi_demo_sku"


def test_build_payload_without_dataset():
    assert build_payload(component(), None)["dataset"] is None


def test_first_dataset_id_walks_nested_blocks():
    spec = {
        "table_view": {"detail": {"blocks": {"skus": {"dataset_id": 12}}}},
        "binding": {"dataset_id": 10},
    }
    assert first_dataset_id(spec) in (10, 12)       # 任一浅层优先，这里 binding 先被遍历到
    assert first_dataset_id({"a": [{"b": {"dataset_id": 7}}]}) == 7
    assert first_dataset_id({"a": 1}) is None


def test_remap_dataset_ids_replaces_everywhere():
    spec = {
        "binding": {"dataset_id": 10, "metric": "x"},
        "table_view": {"detail": {"blocks": {"skus": {"dataset_id": 10}}}},
        "fields": [{"dataset_id": 10, "name": "a"}],
    }
    out = remap_dataset_ids(spec, 99)
    assert out["binding"]["dataset_id"] == 99
    assert out["table_view"]["detail"]["blocks"]["skus"]["dataset_id"] == 99
    assert out["fields"][0]["dataset_id"] == 99
    assert spec["binding"]["dataset_id"] == 10          # 不改原对象


def test_remap_dataset_ids_drops_binding_when_missing():
    out = remap_dataset_ids({"binding": {"dataset_id": 10, "metric": "x"}}, None)
    assert "dataset_id" not in out["binding"]
    assert out["binding"]["metric"] == "x"


def test_normalize_payload_accepts_valid_file():
    raw = build_payload(component(), {"id": 10, "name": "测试-01"})
    comp, dataset = normalize_payload(raw)
    assert comp["name"] == "明细表"
    assert comp["kind"] == "table"
    assert comp["spec"]["binding"]["dataset_id"] == 10
    assert dataset["name"] == "测试-01"


@pytest.mark.parametrize("raw,message", [
    ("不是对象", "不是有效的组件 JSON"),
    ({"format": "other"}, "这不是明策BI 组件文件"),
    ({"format": EXPORT_FORMAT, "version": 99, "component": {"kind": "table", "spec": {"a": 1}}}, "版本比当前系统新"),
    ({"format": EXPORT_FORMAT, "version": 1, "component": {"kind": "table"}}, "没有组件配置"),
    ({"format": EXPORT_FORMAT, "version": 1, "component": {"spec": {"a": 1}}}, "缺少组件类型"),
])
def test_normalize_payload_rejects_bad_files(raw, message):
    with pytest.raises(ValueError) as err:
        normalize_payload(raw)
    assert message in str(err.value)
