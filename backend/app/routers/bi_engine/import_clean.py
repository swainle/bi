"""BI 引擎 · 导入清洗纯函数（Excel/透视表/AI 清洗）。"""

from __future__ import annotations

from fastapi import HTTPException
import io
import openpyxl
import re as _re
import re as _re_clean
import math as _math

from fastapi import APIRouter

router = APIRouter()

_EXCEL_COL_MAP_PDD_PROFIT = {
    "负责人": "person",
    "店铺名称": "store",
    "销售收入": "revenue",
    "正向订单数": "positive_orders",
    "退款": "refund",
    "销售成本": "cost",
    "毛利": "gross",
    "毛利率": "gross_rate",
    "运营推广": "promo",
    "仓库物流": "logistics",
    "平台费用": "platform_fee",
    "人工成本": "labor",
    "净利润": "net_profit",
    "净利润率": "net_rate",
}


# 模糊匹配别名（支持多种列名变体）
_COLUMN_ALIASES = {
    "店铺名称": ["店铺", "店铺名", "店名", "网店", "网店名称", "店鋪名稱", "店鋪名", "store", "名称", "名字", "店铺账号", "商户名"],
    "负责人": ["责任人", "运营", "店长", "负责", "负责人姓名", "owner", "person", "姓名", "归属人", "运营人员"],
    "销售收入": ["营收", "收入", "销售额", "营业额", "主营收入", "销售金额", "销售", "revenue", "income", "金额", "应收", "总收入"],
    "正向订单数": ["订单数", "订单量", "正向订单", "成交订单", "订单", "orders", "成交量", "成交数", "笔数"],
    "退款": ["退款金额", "退款额", "退货退款", "refund", "售后金额", "退款总金额"],
    "销售成本": ["成本", "商品成本", "产品成本", "进货成本", "cost", "总成本", "成本合计"],
    "毛利": ["毛利额", "毛利润", "gross", "gross_profit", "利润"],
    "毛利率": ["利润率", "毛利占比", "gross_rate", "margin", "margin_rate"],
    "运营推广": ["推广费", "推广", "推广费用", "营销费", "广告费", "promo", "ad", "花费", "直通车", "万相台"],
    "仓库物流": ["物流", "物流费", "快递费", "仓储", "发货", "logistics", "shipping", "运费", "配送费"],
    "平台费用": ["平台费", "平台", "平台扣点", "佣金", "技术服务费", "platform", "扣点", "平台扣费"],
    "人工成本": ["人工", "人工费", "工资", "人员成本", "人力", "labor", "薪资", "员工成本"],
    "净利润": ["净利", "净利润额", "纯利润", "net", "net_profit", "profit", "最终利润"],
    "净利润率": ["净利率", "净利占比", "net_rate", "profit_rate"],
}


_MATCH_CACHE: dict[str, str | None] = {}  # 列名→映射key 缓存


def _fuzzy_match_col(header: str) -> str | None:
    """模糊匹配列名 → 标准 key。支持子串匹配（如 '店铺名称AA' 匹配 '店铺名称'）。"""
    h = header.strip()
    if not h:
        return None
    if h in _MATCH_CACHE:
        return _MATCH_CACHE[h]

    # 精确匹配
    if h in _EXCEL_COL_MAP_PDD_PROFIT:
        _MATCH_CACHE[h] = h
        return h

    # 别名匹配
    for std_key, aliases in _COLUMN_ALIASES.items():
        if h in aliases:
            _MATCH_CACHE[h] = std_key
            return std_key

    # 子串匹配（如 "店铺名称AAA" 包含 "店铺名称"）
    for std_key in _EXCEL_COL_MAP_PDD_PROFIT:
        if std_key in h:
            _MATCH_CACHE[h] = std_key
            return std_key
    for std_key, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if len(alias) >= 3 and alias in h:
                _MATCH_CACHE[h] = std_key
                return std_key

    _MATCH_CACHE[h] = None
    return None


def _is_data_row(row_values: list[str], col_count: int) -> bool:
    """判断是否数据行（非标题/空行/合计行）。"""
    non_empty = [v for v in row_values[:col_count] if v.strip()]
    if len(non_empty) < 2:
        return False
    # 合计行检测
    combined = "".join(row_values[:min(col_count, len(row_values))])
    if any(kw in combined for kw in ["合计", "总计", "小计", "汇总", "平均"]):
        return False
    return True


def _normalize_sheet(ws) -> tuple[list[str], dict[str, int], int, str]:
    """
    AI 表序整理核心：扫描整个 sheet，自动定位 header 行并建立列映射。

    支持两种格式:
      格式A: 标准行式表格 (列名直接映射到 _EXCEL_COL_MAP_PDD_PROFIT)
      格式B: 交叉透视表 (核算项目名称 + 人员分列 + 分区段指标)
    返回: (headers, col_map, data_start_row, 诊断信息)
    """
    max_row = min(ws.max_row + 1, 200)
    diagnostic = ""

    # ─── 阶段 0: 处理合并单元格 ───
    merged_ranges = list(ws.merged_cells.ranges)
    if merged_ranges:
        for mr in merged_ranges:
            try:
                top_left_val = ws.cell(row=mr.min_row, column=mr.min_col).value
                for r in range(mr.min_row, mr.max_row + 1):
                    for c in range(mr.min_col, mr.max_col + 1):
                        if ws.cell(row=r, column=c).value is None:
                            ws.cell(row=r, column=c).value = top_left_val
            except Exception:
                pass
        diagnostic += f"处理了 {len(merged_ranges)} 个合并单元格; "

    # ─── 阶段 0.5: 检测是否交叉透视表 ───
    pivot_header_row, pivot_persons, pivot_metric_rows = _detect_pivot_format(ws, max_row)
    if pivot_header_row is not None:
        diagnostic += f"检测到交叉透视表格式(header行{pivot_header_row}, {len(pivot_persons)}人); "
        headers, col_map, data_start = _parse_pivot_table(ws, pivot_header_row, pivot_persons, pivot_metric_rows, max_row)
        diagnostic += f"透视表解析完成: {len(col_map)}列映射"
        return headers, col_map, data_start, diagnostic

    # ─── 阶段 1: 标准格式 — 扫描找最佳 header 行 ───
    best_header_row = None
    best_headers: list[str] = []
    best_match_count = 0

    for row_idx in range(1, max_row):
        row_vals = [str(ws.cell(row=row_idx, column=c).value or "").strip() for c in range(1, 50)]
        if all(not v for v in row_vals):
            continue

        matched_keys = set()
        for v in row_vals:
            if not v:
                continue
            key = _fuzzy_match_col(v)
            if key:
                matched_keys.add(key)

        match_ratio = len(matched_keys) / max(len(_EXCEL_COL_MAP_PDD_PROFIT), 1)
        if len(matched_keys) > best_match_count or (len(matched_keys) == best_match_count and match_ratio > 0.3):
            best_match_count = len(matched_keys)
            best_header_row = row_idx
            best_headers = row_vals

    if best_header_row is None or best_match_count < 2:
        found_cols = [h for h in (best_headers if best_headers else []) if h.strip()][:20]
        if not found_cols:
            for r in range(1, min(10, max_row)):
                vals = [str(ws.cell(row=r, column=c).value or "") for c in range(1, 30) if ws.cell(row=r, column=c).value]
                if vals:
                    found_cols.extend(v for v in vals if v.strip() and len(v.strip()) > 1)
        found_cols = list(dict.fromkeys(found_cols))[:20]
        sample = []
        for r in range(1, min(10, max_row)):
            vals = [str(ws.cell(row=r, column=c).value or "") for c in range(1, 30) if ws.cell(row=r, column=c).value]
            if vals:
                sample.append(f"第{r}行: {', '.join(vals[:6])}...")
        raise HTTPException(400, (
            f"表序整理仅匹配到 {best_match_count} 个已知列（需 ≥2）。"
            f"发现 {len(found_cols)} 个列名，其中匹配: {[c for c in found_cols if _fuzzy_match_col(c)][:10]}。"
            f"未匹配列名: {[c for c in found_cols if not _fuzzy_match_col(c)][:10]}。"
            f"前几行: {'; '.join(sample[:3])}"
            f"如需支持这些列名，请在列映射表中添加别名。"
        ))

    col_map: dict[str, int] = {}
    for idx, h in enumerate(best_headers):
        key = _fuzzy_match_col(h)
        if key and key not in col_map:
            col_map[key] = idx

    diagnostic += f"在第{best_header_row}行找到 {best_match_count} 个匹配列; 最终映射 {len(col_map)} 列"
    return best_headers, col_map, best_header_row + 1, diagnostic


def _detect_pivot_format(ws, max_row: int):
    """检测是否为交叉透视表格式。

    特征:
      - 某行第1列是"核算项目名称"（或类似标识列）
      - 该行后续列是人员姓名
      - 数据区之间有分区标题行（如一、净销售收入）

    返回: (header_row, person_names, metric_row_indices) 或 (None, [], [])
    """
    STORE_ID_COLS = ["核算项目名称", "店铺名称", "店铺", "店名", "项目", "项目名称"]
    SECTION_PREFIX = _re.compile(r"^[一二三四五六七八九十]、")

    for row_idx in range(1, min(20, max_row)):
        v1 = str(ws.cell(row=row_idx, column=1).value or "").strip()
        if v1 in STORE_ID_COLS:
            # 这是 header 行，第1列是店铺标识，后续列是人员
            persons = []
            for c in range(3, 40):  # 跳过第1列(店铺)和第2列(合计)
                name = str(ws.cell(row=row_idx, column=c).value or "").strip()
                if not name or len(name) > 10:
                    break
                if name not in ("合计", "小计", "总计") and name not in persons:
                    persons.append(name)
            if len(persons) >= 1:
                # 找到分区标题行（一、二、等）
                metric_rows = []
                for r in range(row_idx + 1, min(row_idx + 100, max_row)):
                    r1 = str(ws.cell(row=r, column=1).value or "").strip()
                    if r1 and SECTION_PREFIX.match(r1):
                        metric_rows.append(r)
                    if len(metric_rows) >= 8:  # 最多8个分区
                        break
                return row_idx, persons, metric_rows

    # 也尝试第1列不匹配但其他列是人员名的模式
    for row_idx in range(1, min(20, max_row)):
        row_vals = []
        for c in range(1, 40):
            v = str(ws.cell(row=row_idx, column=c).value or "").strip()
            if v:
                row_vals.append(v)
        # 检查前2列后是否全是人员名（2-4字中文）
        name_count = 0
        for v in row_vals[1:]:  # 跳过第1列
            # 2-4个中文字符，可能是人名
            if _re_clean.match(r'^[\u4e00-\u9fff·]{2,4}$', v):
                name_count += 1
        if name_count >= 3 and row_vals[0] not in STORE_ID_COLS:
            # 可能仍是透视表，但第1列不是标准名称
            # 放宽条件：只要前几个像是数据标识+多个人名
            pass

    return None, [], []


# 分区标题 → 标准列映射
_PIVOT_METRIC_MAP = {
    "净销售收入": "revenue",
    "销售收入": "revenue",
    "正向订单数": "positive_orders",
    "退款": "refund",
    "退款金额": "refund",
    "销售成本": "cost",
    "成本": "cost",
    "毛利": "gross",
    "毛利率": "gross_rate",
    "运营推广": "promo",
    "推广费": "promo",
    "仓库物流": "logistics",
    "物流费": "logistics",
    "平台费用": "platform_fee",
    "平台费": "platform_fee",
    "人工成本": "labor",
    "人工费": "labor",
    "净利润": "net_profit",
    "净利润率": "net_rate",
    "净利率": "net_rate",
}


def _parse_pivot_table(ws, header_row: int, persons: list[str], metric_rows: list[int], max_row: int):
    """解析交叉透视表 → 标准格式 (col_map + data_start)。

    策略：将每个 [section_header → store × person → value] 映射为实际导入时的列读取。
    实际做法：透视表无法简单用 col_map 映射，改为在预览/导入阶段整体读取后结构化。

    但预览端点需要 col_map，所以这里构建一个"模拟 col_map"：
      - 第1列 → "店铺名称"
      - 后续列 → 第一个 metric 的 person 列
    实际使用 import 端点时会走另一条解析路径。
    """
    # 找出最常用的 metric_rows 对应的标准列名
    section_labels = []
    for mr in metric_rows:
        label = str(ws.cell(row=mr, column=1).value or "").strip()
        # 去掉编号 "一、" → "净销售收入"
        clean = _re.sub(r"^[一二三四五六七八九十]、", "", label)
        section_labels.append(clean)

    # 构建列映射：第1列=店铺名称，后续列=每个person一个"销售收入"列
    col_map: dict[str, int] = {"店铺名称": 0}
    for i, person in enumerate(persons):
        # 每个人占一列，映射多个指标时复用这些person列
        for col_name in ["销售收入", "退款", "成本", "毛利", "推广", "物流", "平台费用", "人工成本", "净利", "毛利率", "净利率"]:
            key = f"{col_name}({person})"
            col_map[key] = i + 2  # +2 因为第1列是店铺名，第2列是"合计"

    # 存储透视表元信息到全局，供导入时使用
    if not hasattr(_parse_pivot_table, "_meta"):
        _parse_pivot_table._meta = {}
    _parse_pivot_table._meta = {
        "header_row": header_row,
        "persons": persons,
        "metric_rows": metric_rows,
        "section_labels": section_labels,
        "is_pivot": True,
        "max_row": max_row,
    }

    return [], col_map, header_row + 1


def _read_pivot_as_rows(ws, header_row: int, persons: list[str], metric_rows: list[int], max_row: int) -> tuple:
    import re as _sre
    section_pat = _sre.compile(r"^[一二三四五六七八九十]、")
    section_to_metric = {}
    for mr in metric_rows:
        label = str(ws.cell(row=mr, column=1).value or "").strip()
        clean = section_pat.sub("", label)
        db_col = _PIVOT_METRIC_MAP.get(clean)
        if db_col: section_to_metric[mr] = db_col
    data_ranges = []
    for i, mr in enumerate(metric_rows):
        end = metric_rows[i + 1] if i + 1 < len(metric_rows) else max_row
        data_ranges.append((mr, mr + 1, end))
    store_data = {}
    for section_row, start, end in data_ranges:
        db_col = section_to_metric.get(section_row, "")
        if not db_col: continue
        for r in range(start, end):
            store = str(ws.cell(row=r, column=1).value or "").strip()
            if not store or store in ("None", "nan", "-", ""): continue
            if section_pat.match(store) or any(k in store for k in ("合计", "总计", "小计")): continue
            try: float(store); continue
            except ValueError: pass
            # 必须是真实店铺名——以【开头，或以特定前缀开头
            if not (store.startswith("【") or store.startswith("[")): continue
            v = ws.cell(row=r, column=2).value
            try: v = float(v) if v is not None else 0
            except: v = 0
            if store not in store_data: store_data[store] = {"store": store, "person": "", "data_month": ""}
            store_data[store][db_col] = round(v, 2)
    rows = list(store_data.values())
    return rows, []


_STORE_SUFFIXES = [
    "旗舰店", "专卖店", "专营店", "官方店", "企业店", "大店",
    "宠物用品店", "宠物食品旗舰店", "宠物生活专营店", "宠物生活馆",
    "宠物用品旗舰店", "宠物用品官方旗舰店", "宠物用品大店",
]


_BRAND_PREFIX_PATTERN = _re_clean.compile(r"^【[^】]+】|^\[[^\]]+\]")


_MULTISPACE = _re_clean.compile(r"\s+")


def _clean_store_name(name: str) -> tuple[str, list[str]]:
    """清洗店铺名：去除品牌前缀、尾部冗余后缀、多余空格。
    返回 (清洗后名称, [清洗日志])。
    """
    logs = []
    original = name.strip()
    cleaned = original

    # 去品牌前缀：【拼多多】xxx → xxx
    m = _BRAND_PREFIX_PATTERN.search(cleaned)
    if m:
        cleaned = cleaned[m.end():].strip()
        logs.append(f"去除品牌前缀: {m.group()}")

    # 去多余空格
    if "  " in cleaned:
        cleaned = _MULTISPACE.sub(" ", cleaned).strip()
        logs.append("去除多余空格")

    # 去尾部后缀（仅当名称 > 4 字符时）
    if len(cleaned) > 4:
        for sfx in sorted(_STORE_SUFFIXES, key=len, reverse=True):
            if cleaned.endswith(sfx) and len(cleaned) > len(sfx) + 2:
                cleaned = cleaned[:-len(sfx)].strip()
                logs.append(f"去除店铺后缀: {sfx}")
                break

    if cleaned != original:
        logs.append(f"店铺名标准化: {original[:30]} → {cleaned[:30]}")

    return cleaned, logs


def _clean_person_name(name: str) -> tuple[str, list[str]]:
    """清洗负责人姓名：去空格、空值统一为"未分配"。"""
    logs = []
    original = (name or "").strip()
    cleaned = original

    if not cleaned or cleaned.lower() in ("none", "null", "无", "nan", "-"):
        cleaned = "未分配"
        logs.append(f"负责人空值 → 未分配")

    cleaned = _MULTISPACE.sub("", cleaned)
    if cleaned != original:
        logs.append(f"负责人标准化: {original} → {cleaned}")

    return cleaned, logs


def _fix_percentage(v: float, col: str) -> tuple[float, str]:
    """修正百分比值：如果 > 1 自动除以 100（如 35.5 → 0.355）。"""
    original = v
    if v is None:
        return 0, ""
    if v > 1.0:
        corrected = round(v / 100, 6)
        return corrected, f"{col} 百分比自动校正: {original} → {corrected:.2%}"
    return v, ""


def _normalize_numeric(v, col: str) -> tuple[float, str]:
    """规整数值：None→0，负数应收→绝对值警告，退款→正数。"""
    if v is None:
        return 0, ""
    original = v
    # 退款相关字段应为正数（支出），但Excel可能标负数
    if col in ("refund", "cost", "promo", "logistics", "platform_fee", "labor"):
        if v < 0:
            return abs(v), f"{col} 负值转正: {original} → {abs(v)}"
    # 收入字段不应为负
    if col == "revenue":
        if v < 0:
            return abs(v), f"销售收入负值转正: {original} → {abs(v)}"
    # 利润可以为负
    return v, ""


def _validate_row(row: dict, idx: int) -> list[str]:
    """校验单行数据，返回警告列表。"""
    warnings = []
    store = row.get("store", "")
    tag = f"[{store}]" if store else f"[行#{idx}]"

    # 毛利校验：gross ≈ revenue - cost（允许 1% 误差）
    revenue = row.get("revenue", 0) or 0
    cost = row.get("cost", 0) or 0
    gross = row.get("gross", 0) or 0
    if revenue > 0:
        expected_gross = revenue - cost
        if abs(expected_gross) > 0.01:
            diff_pct = abs(gross - expected_gross) / abs(expected_gross) * 100 if abs(expected_gross) > 0.01 else 0
            if diff_pct > 5:
                warnings.append(f"{tag} 毛利异常: 报表毛利={gross:.2f}, 计算毛利={expected_gross:.2f}, 偏差{diff_pct:.1f}%")
                # 自动修正为计算值
                row["gross"] = round(expected_gross, 2)

    # 毛利率校验
    if revenue > 0:
        expected_rate = gross / revenue
        current_rate = row.get("gross_rate", 0) or 0
        if abs(current_rate - expected_rate) > 0.1:
            warnings.append(f"{tag} 毛利率异常: 报表{current_rate:.2%}, 计算{expected_rate:.2%}")
            row["gross_rate"] = round(expected_rate, 6)

    # 净利润校验
    net = row.get("net_profit", 0) or 0
    costs_total = (cost or 0) + (row.get("promo", 0) or 0) + (row.get("logistics", 0) or 0) + \
                  (row.get("platform_fee", 0) or 0) + (row.get("labor", 0) or 0) + \
                  (row.get("other_expense", 0) or 0)
    expected_net = revenue - costs_total + (row.get("other_income", 0) or 0)
    if revenue > 0 and abs(expected_net) > 0.01:
        diff_pct = abs(net - expected_net) / (abs(expected_net) + 0.01) * 100
        if diff_pct > 10:
            warnings.append(f"{tag} 净利润异常: 报表净利润={net:.2f}, 核算净利润={expected_net:.2f}, 偏差{diff_pct:.1f}%")
            row["net_profit"] = round(expected_net, 2)

    # 净利润率校验
    if revenue > 0 and net != 0:
        expected_net_rate = net / revenue
        current_net_rate = row.get("net_rate", 0) or 0
        if abs(current_net_rate - expected_net_rate) > 0.1:
            warnings.append(f"{tag} 净利润率异常: 报表{current_net_rate:.2%}, 计算{expected_net_rate:.2%}")
            row["net_rate"] = round(expected_net_rate, 6)

    return warnings


def _detect_outliers(rows: list[dict]) -> list[str]:
    """检测异常离群值（超过 3σ）。"""
    alerts = []
    for col in ["revenue", "cost", "gross", "net_profit"]:
        vals = [(i, (r.get(col) or 0)) for i, r in enumerate(rows) if (r.get(col) or 0) != 0]
        if len(vals) < 5:
            continue
        avg = sum(v for _, v in vals) / len(vals)
        std = (sum((v - avg) ** 2 for _, v in vals) / len(vals)) ** 0.5
        if std == 0:
            continue
        for i, v in vals:
            if abs(v - avg) > 3 * std:
                store = rows[i].get("store", f"行#{i}")
                alerts.append(f"[{store}] {col}={v:.0f} 为离群值 (均值{avg:.0f}, 3σ={3*std:.0f})")
    return alerts


def _ai_profile(rows: list[dict], columns: list[str]) -> dict:
    """AI 列统计画像：均值/中位数/标准差/变异系数/偏度/空值率。"""
    profile = {}
    for col in columns:
        vals = [r.get(col) for r in rows if r.get(col) is not None and r.get(col) != 0]
        n = len(vals)
        if n < 3:
            profile[col] = {"count": n, "null_rate": 1 - n / max(len(rows), 1)}
            continue
        avg = sum(vals) / n
        sorted_vals = sorted(vals)
        median = sorted_vals[n // 2] if n % 2 else (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
        variance = sum((v - avg) ** 2 for v in vals) / n
        std_dev = _math.sqrt(variance)
        cv = std_dev / abs(avg) if avg != 0 else 0  # 变异系数
        # 偏度
        skew = sum(((v - avg) / std_dev) ** 3 for v in vals) / n if std_dev > 0 else 0
        profile[col] = {
            "count": n, "null_rate": round(1 - n / max(len(rows), 1), 2),
            "avg": round(avg, 2), "median": round(median, 2),
            "std": round(std_dev, 2), "cv": round(cv, 2),
            "skew": round(skew, 2),
            "min": round(sorted_vals[0], 2), "max": round(sorted_vals[-1], 2),
            "q1": round(sorted_vals[n // 4], 2), "q3": round(sorted_vals[3 * n // 4], 2),
        }
    return profile


def _ai_smart_repair(rows: list[dict], profile: dict) -> list[str]:
    """AI 智能修补：基于列统计画像修正异常值。
    
    策略：
    - 负值收入/订单 → 转正
    - 远超 3σ 的异常值 → IQR 边界裁剪
    - 缺失值 → 列中位数填充
    """
    logs = []
    for i, row in enumerate(rows):
        store = row.get("store", f"行#{i+1}")
        for col, p in profile.items():
            v = row.get(col)
            if v is None or v == 0:
                continue

            # 负值修补（收入/订单必为正）
            if col in ("revenue", "positive_orders", "positive_rev") and v < 0:
                row[col] = abs(v)
                logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{abs(v):.2f} (负值转正)")

            # IQR 异常值裁剪
            q1 = p.get("q1", 0)
            q3 = p.get("q3", 0)
            if q3 > q1 > 0:
                iqr = q3 - q1
                upper = q3 + 3 * iqr
                lower = max(0, q1 - 3 * iqr)
                if v > upper:
                    row[col] = upper
                    logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{upper:.2f} (IQR上限裁剪, q3={q3:.0f})")
                elif col not in ("net_profit",) and v < lower and v != 0:
                    row[col] = q1
                    logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{q1:.2f} (IQR下限裁剪)")

    return logs


def _ai_deep_clean(rows: list[dict]) -> list[str]:
    """AI 深度清洗：利用列间关系智能推断和修正。
    
    关系规则：
    - gross = revenue - cost
    - gross_rate = gross / revenue
    - net_profit ≈ revenue - Σcosts
    - net_rate = net_profit / revenue
    """
    logs = []
    for i, row in enumerate(rows):
        store = row.get("store", f"行#{i+1}")
        revenue = row.get("revenue", 0) or 0
        cost = row.get("cost", 0) or 0
        if revenue <= 0:
            continue

        # 毛利推断
        gross = row.get("gross", 0) or 0
        expected_gross = revenue - cost
        if abs(gross - expected_gross) > max(abs(expected_gross) * 0.05, 100):
            logs.append(f"AI推断 [{store}] 毛利{gross:.0f}偏离计算值{expected_gross:.0f} → 自动修正")
            row["gross"] = round(expected_gross, 2)

        # 毛利率推断
        gross_rate = row.get("gross_rate", 0) or 0
        expected_rate = row["gross"] / revenue
        if abs(gross_rate - expected_rate) > 0.05:
            logs.append(f"AI推断 [{store}] 毛利率{gross_rate:.2%}→{expected_rate:.2%}")
            row["gross_rate"] = round(expected_rate, 6)

        # 净利润验证
        net = row.get("net_profit", 0) or 0
        costs_total = cost + (row.get("promo", 0) or 0) + (row.get("logistics", 0) or 0) + \
                      (row.get("platform_fee", 0) or 0) + (row.get("labor", 0) or 0)
        expected_net = revenue - costs_total
        if abs(net - expected_net) > max(abs(expected_net) * 0.1, 500):
            logs.append(f"AI推断 [{store}] 净利润{net:.0f}偏离核算值{expected_net:.0f} → 自动修正")
            row["net_profit"] = round(expected_net, 2)

        # 净利润率推断
        net_rate = row.get("net_rate", 0) or 0
        expected_net_rate = row["net_profit"] / revenue if revenue > 0 else 0
        if abs(net_rate - expected_net_rate) > 0.05:
            logs.append(f"AI推断 [{store}] 净利润率{net_rate:.2%}→{expected_net_rate:.2%}")
            row["net_rate"] = round(expected_net_rate, 6)

    return logs


def _ai_generate_insights(rows: list[dict], profile: dict) -> dict:
    """AI 数据洞察：基于统计画像生成业务洞察摘要。
    
    返回: {
      summary: "整体概括",
      top_stores: [{store, metric}],
      risks: [风险提示],
      highlights: [亮点发现],
      recommendations: [建议],
    }
    """
    stores = sorted(rows, key=lambda r: r.get("revenue") or 0, reverse=True)
    loss_stores = [r for r in rows if (r.get("net_profit") or 0) < 0]

    # 整体概括
    total_rev = sum(r.get("revenue") or 0 for r in rows)
    total_net = sum(r.get("net_profit") or 0 for r in rows)
    avg_net_rate = total_net / total_rev if total_rev > 0 else 0
    total_stores = len(rows)

    summary = (
        f"共 {total_stores} 家店铺，总营收 {_fmt_ai(total_rev)}，"
        f"净利润 {_fmt_ai(total_net)}（利润率 {avg_net_rate:.1%}），"
        f"亏损店铺 {len(loss_stores)} 家（占比 {len(loss_stores)/max(total_stores,1):.0%}）"
    )

    # Top 店铺
    top5 = stores[:5]
    top_stores = [
        {"store": s.get("store", ""), "revenue": _fmt_ai(s.get("revenue") or 0),
         "net_profit": _fmt_ai(s.get("net_profit") or 0)}
        for s in top5
    ]

    # 风险提示
    risks = []
    if len(loss_stores) >= total_stores * 0.2:
        risks.append(f"⚠ {len(loss_stores)}/家店铺亏损，占比偏高，建议逐店分析成本结构")
    promo_heavy = [r for r in rows if (r.get("promo") or 0) / max(r.get("revenue") or 1, 1) > 0.3]
    if promo_heavy:
        risks.append(f"⚠ {len(promo_heavy)} 家店铺推广费占比 > 30%，可能压缩利润空间")

    # 亮点
    highlights = []
    top1 = stores[0] if stores else None
    if top1:
        highlights.append(f"🏆 营收冠军: {top1.get('store','')}（{_fmt_ai(top1.get('revenue') or 0)}）")
    high_margin = [r for r in rows if (r.get("net_rate") or 0) > 0.15]
    if high_margin:
        highlights.append(f"📈 {len(high_margin)} 家店铺净利润率 > 15%，运营效率优秀")

    # 建议
    recommendations = []
    if len(loss_stores) > 0:
        recommendations.append(f"重点关注 {len(loss_stores)} 家亏损店铺的成本与推广")
    if any((r.get("promo") or 0) > (r.get("net_profit") or 0) > 0 for r in rows):
        recommendations.append("部分店铺推广费超过净利润，建议优化投放策略")
    recommendations.append("可配置 BI 告警规则，对亏损/利润率异常自动通知")

    return {
        "summary": summary,
        "top_stores": top_stores,
        "risks": risks,
        "highlights": highlights,
        "recommendations": recommendations,
    }


def _fmt_ai(v: float) -> str:
    if abs(v) >= 1e8: return f"{v/1e8:.2f}亿"
    if abs(v) >= 1e4: return f"{v/1e4:.0f}万"
    return f"{v:,.0f}"


def _is_number(v) -> bool:
    try:
        float(v)
        return True
    except (ValueError, TypeError):
        return False


def _parse_excel_rows(file_content: bytes) -> tuple[list[dict], str]:
    """解析 Excel 为标准行格式（共享模块）。"""
    wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
    ws = wb[max(wb.sheetnames, key=lambda sn: wb[sn].max_row)]
    headers, col_map, data_start, diag = _normalize_sheet(ws)

    # 检查是否透视表
    pivot_meta = getattr(_parse_pivot_table, "_meta", {}) if hasattr(_parse_pivot_table, "_meta") else {}
    if pivot_meta.get("is_pivot"):
        pivot_rows, _ = _read_pivot_as_rows(ws, pivot_meta["header_row"], pivot_meta["persons"], pivot_meta["metric_rows"], pivot_meta["max_row"])
        return pivot_rows, diag + f" (透视表, {len(pivot_rows)}行)"

    # 标准格式
    rows = []
    for row_idx in range(data_start, ws.max_row + 1):
        row_vals = [c.value for c in ws[row_idx]]
        store = str(row_vals[col_map.get("店铺名称", -1)]).strip() if "店铺名称" in col_map and col_map["店铺名称"] < len(row_vals) else ""
        if not store or store in ("None", "nan", "-"):
            continue
        if "合计" in store or "总计" in store:
            continue

        row = {"store": store, "person": "", "data_month": ""}
        for key, idx in col_map.items():
            if idx < len(row_vals):
                v = row_vals[idx]
                try:
                    row[_EXCEL_COL_MAP_PDD_PROFIT.get(key, key)] = float(v) if v is not None else 0
                except (ValueError, TypeError):
                    row[_EXCEL_COL_MAP_PDD_PROFIT.get(key, key)] = v if v else ""

        for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                    "product_cost", "gift_cost", "special_cost", "damage",
                    "express", "other_logistics", "product_promo", "wujie_promo",
                    "platform_commission", "op_labor", "alloc_labor",
                    "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
            row.setdefault(fld, 0)
        rows.append(row)

    return rows, diag
