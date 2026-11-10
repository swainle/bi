"""明策BI CSV 数据导入服务."""
import csv
import io
import json
import re
from typing import Optional


def parse_csv_content(content: str, delimiter: str = ",") -> dict:
    """解析 CSV 内容为结构化数据.

    Returns:
        {
            "headers": ["col1", "col2", ...],
            "rows": [["val1", "val2", ...], ...],
            "row_count": int,
            "col_count": int,
            "summary": {"col1": {"type": "number"|"string"|"date", "sample": [...]}}
        }
    """
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    rows = list(reader)

    if len(rows) < 2:
        return {"headers": [], "rows": [], "row_count": 0, "col_count": 0, "summary": {}}

    headers = rows[0]
    data_rows = rows[1:]

    # 推断列类型
    summary = {}
    for i, header in enumerate(headers):
        col_values = [row[i] for row in data_rows if i < len(row) and row[i].strip()]
        col_type = "string"
        if col_values:
            # 尝试数字
            numeric_count = sum(1 for v in col_values if _is_numeric(v))
            if numeric_count / len(col_values) > 0.8:
                col_type = "number"
            # 尝试日期
            elif all(_looks_like_date(v) for v in col_values[:5]):
                col_type = "date"

        summary[header] = {
            "type": col_type,
            "sample": col_values[:3],
            "null_count": sum(1 for row in data_rows if i >= len(row) or not row[i].strip()),
        }

    return {
        "headers": headers,
        "rows": data_rows,
        "row_count": len(data_rows),
        "col_count": len(headers),
        "summary": summary,
    }


def _is_numeric(val: str) -> bool:
    try:
        float(val.replace(",", ""))
        return True
    except (ValueError, AttributeError):
        return False


def _looks_like_date(val: str) -> bool:
    return bool(re.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}", val.strip()))


def csv_to_json_rows(content: str, delimiter: str = ",") -> list[dict]:
    """CSV 转 JSON 对象列表（适合图表数据）."""
    parsed = parse_csv_content(content, delimiter)
    if not parsed["headers"]:
        return []

    result = []
    for row in parsed["rows"]:
        obj = {}
        for i, header in enumerate(parsed["headers"]):
            val = row[i] if i < len(row) else ""
            if parsed["summary"].get(header, {}).get("type") == "number":
                try:
                    val = float(val.replace(",", "")) if val.strip() else 0
                except (ValueError, AttributeError):
                    pass
            obj[header] = val
        result.append(obj)

    return result
