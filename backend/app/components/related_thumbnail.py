"""同源图片关联：走语义查询权限，批量取图，不改变业务行数。"""

import json
import re
import subprocess
import sys
from urllib.parse import urlsplit

from app.components.spec import ComponentSpecError
from app.semantic.access import can_access_dataset
from app.semantic.compiler import compile_query
from app.semantic.repository import get_dataset, list_datasets, list_fields

THUMB_KEY = "__related_thumbnail_url"


def same_source(left, right):
    return (left.conn_mode or "extract", left.source_id) == (right.conn_mode or "extract", right.source_id)


def thumbnail_tables(db, dataset_id, user):
    source = get_dataset(db, dataset_id)
    if source is None or not can_access_dataset(db, source, user):
        raise ComponentSpecError("当前数据集不存在或无权访问")
    return {"tables": [
        {"id": target.id, "name": target.name, "table": target.physical_table,
         "fields": [field.name for field in list_fields(db, target.id)]}
        for target in list_datasets(db)
        if target.is_active and same_source(source, target) and can_access_dataset(db, target, user)
    ]}


def transform_urls(values, config):
    values = [str(value or "").strip() for value in values]
    values = [value if len(value) <= 4096 else "" for value in values]
    if config.operation in ("replace", "regex") and not config.pattern:
        raise ComponentSpecError("图片地址替换规则不能为空")
    if config.operation == "regex":
        try:
            re.compile(config.pattern).sub(config.replacement, "")
        except re.error as exc:
            raise ComponentSpecError(f"图片地址正则或替换内容不合法：{exc}") from exc
        if not values:
            return []
        # 用户正则在独立进程限时执行，避免回溯阻塞查询线程。
        script = "import json,re,sys; p,r,v=json.load(sys.stdin); print(json.dumps([re.sub(p,r,s)[:8193] if s else '' for s in v]))"
        try:
            result = subprocess.run(
                [sys.executable, "-c", script], input=json.dumps([config.pattern, config.replacement, values]),
                text=True, encoding="utf-8", capture_output=True, timeout=3, check=True,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            values = json.loads(result.stdout)
        except (subprocess.SubprocessError, OSError, ValueError) as exc:
            raise ComponentSpecError("图片地址正则转换失败或超过 3 秒，请简化规则") from exc
    elif config.operation == "prefix":
        values = [config.replacement + value if value else "" for value in values]
    elif config.operation == "replace":
        values = [value.replace(config.pattern, config.replacement)[:8193] if value else "" for value in values]
    urls = []
    for value in values:
        try:
            parsed = urlsplit(value)
            urls.append(value if len(value) <= 8192 and parsed.scheme.lower() in ("http", "https") and parsed.netloc else "")
        except ValueError:
            urls.append("")
    return urls


def attach_thumbnails(db, dataset, spec, payload, user, execute):
    config = spec.table_view.related_thumb
    if not config.enabled:
        return payload
    if not all((config.local_key, config.dataset_id, config.match_key, config.url_key)):
        raise ComponentSpecError("请完整配置关联缩略图的关联字段、图片资源表和图片地址字段")
    if config.local_key == THUMB_KEY or dataset.field_by_name(THUMB_KEY):
        raise ComponentSpecError(f"字段名 {THUMB_KEY} 为关联缩略图保留字段")
    target = get_dataset(db, config.dataset_id)
    if target is None or not target.is_active or not can_access_dataset(db, target, user):
        raise ComponentSpecError("图片资源数据集不存在、已停用或无权访问")
    if not same_source(dataset, target):
        raise ComponentSpecError("关联缩略图仅支持同一数据源、同一取数方式的数据集")
    rows = payload.get("rows") or []
    ids = list(dict.fromkeys(row[config.local_key] for row in rows if row.get(config.local_key) not in (None, "")))
    images = {}
    for offset in range(0, len(ids), 500):
        query = compile_query(target, {
            "columns": list(dict.fromkeys([config.match_key, config.url_key])),
            "filters": [{"name": config.match_key, "op": "IN", "value": ids[offset:offset + 500]}],
            "limit": 5000,
        })
        result = execute(db, target, query, user)
        if len(result.rows) >= 5000:
            raise ComponentSpecError("图片关联结果过多，请检查关联字段是否唯一")
        for row in result.rows:
            key = str(row.get(config.match_key))
            if key in images:
                raise ComponentSpecError("图片资源表关联字段不唯一，请先去重或选择主图数据集")
            images[key] = row.get(config.url_key)
    urls = transform_urls(list(images.values()), config)
    images = dict(zip(images, urls))
    payload["rows"] = [{**row, THUMB_KEY: images.get(str(row.get(config.local_key)), "")} for row in rows]
    payload["columns"] = [column for column in payload.get("columns", []) if column["key"] != THUMB_KEY]
    payload.update(thumb=True, thumb_key=THUMB_KEY)
    return payload
