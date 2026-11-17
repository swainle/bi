"""BI 引擎 · 模板与市场（/templates、/market、筛选模板）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
import json
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

# 模板名称 → 表名
TEMPLATE_MAP = {
    "财务总览": "bi_finance",
    "拼多多运营": "bi_pdd_ops",
    "天猫经营": "bi_tmall",
    "抖音电商": "bi_douyin",
    "拼多多店铺利润": "bi_pdd_stores",
    "拼多多年度汇总": "bi_pdd_annual",
    "拼多多流量分析": "bi_pdd_traffic",
    "产品部·宠物优选": "bi_products",
    "天猫月度复盘": "bi_tmall_monthly",
    "天猫活动分析": "bi_tmall_campaigns",
    "抖音直播复盘": "bi_douyin_live",
    "拼多多店铺利润看板": "bi_pdd_profit",
}


@router.get("/templates")
def get_templates(current_user: User = Depends(get_current_user)):
    """返回模板定义（前端看板布局）"""
    panels = {
        "bi_finance": [
            {"id": "p1", "type": "number", "title": "年度总收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "年度净利润", "metric": "net_profit"},
            {"id": "p3", "type": "number", "title": "总成本", "metric": "cost"},
            {"id": "p4", "type": "number", "title": "平均毛利率(%)", "metric": "gross_margin"},
            {"id": "p5", "type": "number", "title": "平均费用率(%)", "metric": "expense_rate"},
            {"id": "p6", "type": "number", "title": "利润率(%)", "metric": "net_profit"},
            {"id": "p7", "type": "line", "title": "月度收入趋势", "xField": "month", "yField": "revenue"},
            {"id": "p8", "type": "line", "title": "成本 vs 净利润趋势", "xField": "month", "yField": "cost"},
            {"id": "p9", "type": "bar", "title": "各月净利润对比", "xField": "month", "yField": "net_profit"},
            {"id": "p10", "type": "bar", "title": "各月毛利额", "xField": "month", "yField": "gross_margin"},
            {"id": "p11", "type": "pie", "title": "月度收入占比", "xField": "month", "yField": "revenue"},
            {"id": "p12", "type": "pie", "title": "费用率分布", "xField": "month", "yField": "expense_rate"},
            {"id": "p13", "type": "table", "title": "财务明细表", "xField": "month", "yField": "revenue"},
        ],
        "bi_pdd_ops": [
            {"id": "p1", "type": "number", "title": "累计 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总 PV", "metric": "pv"},
            {"id": "p3", "type": "number", "title": "总 UV", "metric": "uv"},
            {"id": "p4", "type": "number", "title": "平均转化率(%)", "metric": "conversion_rate"},
            {"id": "p5", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p6", "type": "number", "title": "平均退款率(%)", "metric": "refund_rate"},
            {"id": "p7", "type": "line", "title": "GMV 日趋势", "xField": "date", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "PV vs UV 趋势", "xField": "date", "yField": "pv"},
            {"id": "p9", "type": "line", "title": "转化率走势", "xField": "date", "yField": "conversion_rate"},
            {"id": "p10", "type": "bar", "title": "每日退款率", "xField": "date", "yField": "refund_rate"},
            {"id": "p11", "type": "bar", "title": "日 GMV 对比", "xField": "date", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "流量分布", "xField": "date", "yField": "uv"},
            {"id": "p13", "type": "table", "title": "运营明细表", "xField": "date", "yField": "gmv"},
        ],
        "bi_tmall": [
            {"id": "p1", "type": "number", "title": "累计 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "uv"},
            {"id": "p3", "type": "number", "title": "支付买家数", "metric": "paying_buyers"},
            {"id": "p4", "type": "number", "title": "总广告花费", "metric": "ad_spend"},
            {"id": "p5", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p6", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p7", "type": "line", "title": "天猫 GMV 趋势", "xField": "date", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "访客 vs 买家趋势", "xField": "date", "yField": "uv"},
            {"id": "p9", "type": "line", "title": "ROI 日度走势", "xField": "date", "yField": "roi"},
            {"id": "p10", "type": "bar", "title": "每日广告投入", "xField": "date", "yField": "ad_spend"},
            {"id": "p11", "type": "bar", "title": "日 GMV 排行", "xField": "date", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "买家分布", "xField": "date", "yField": "paying_buyers"},
            {"id": "p13", "type": "table", "title": "天猫经营明细", "xField": "date", "yField": "gmv"},
        ],
        "bi_douyin": [
            {"id": "p1", "type": "number", "title": "总播放量", "metric": "plays"},
            {"id": "p2", "type": "number", "title": "总 GMV", "metric": "gmv"},
            {"id": "p3", "type": "number", "title": "新增粉丝数", "metric": "new_followers"},
            {"id": "p4", "type": "number", "title": "平均互动率(%)", "metric": "engagement_rate"},
            {"id": "p5", "type": "number", "title": "总直播时长(h)", "metric": "live_hours"},
            {"id": "p6", "type": "number", "title": "平均在线人数", "metric": "avg_online"},
            {"id": "p7", "type": "line", "title": "播放量趋势", "xField": "date", "yField": "plays"},
            {"id": "p8", "type": "line", "title": "GMV 日趋势", "xField": "date", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "互动率日对比", "xField": "date", "yField": "engagement_rate"},
            {"id": "p10", "type": "bar", "title": "新增粉丝数", "xField": "date", "yField": "new_followers"},
            {"id": "p11", "type": "line", "title": "在线人数趋势", "xField": "date", "yField": "avg_online"},
            {"id": "p12", "type": "pie", "title": "GMV 日分布", "xField": "date", "yField": "gmv"},
            {"id": "p13", "type": "table", "title": "抖音电商明细", "xField": "date", "yField": "gmv"},
        ],
        "bi_pdd_stores": [
            {"id": "p1", "type": "number", "title": "总销售收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "总毛利额", "metric": "gross_profit"},
            {"id": "p3", "type": "number", "title": "总净利润", "metric": "net_profit"},
            {"id": "p4", "type": "number", "title": "总推广费", "metric": "promo_cost"},
            {"id": "p5", "type": "number", "title": "利润率(%)", "metric": "profit_rate"},
            {"id": "p6", "type": "number", "title": "订单总数", "metric": "order_count"},
            {"id": "p7", "type": "bar", "title": "部门收入排名", "xField": "department", "yField": "revenue", "size": "lg"},
            {"id": "p8", "type": "bar", "title": "店铺收入 TOP15", "xField": "store", "yField": "revenue", "size": "lg"},
            {"id": "p9", "type": "line", "title": "利润率分布", "xField": "store", "yField": "profit_rate", "size": "lg"},
            {"id": "p10", "type": "pie", "title": "部门收入占比", "xField": "department", "yField": "revenue", "size": "md"},
            {"id": "p11", "type": "pie", "title": "费用结构占比", "xField": "store", "yField": "promo_cost", "size": "md"},
            {"id": "p12", "type": "table", "title": "店铺利润明细表", "xField": "store", "yField": "revenue", "size": "lg"},
        ],
        "bi_pdd_profit": [
            {"id": "p1", "type": "number", "title": "总销售收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "总毛利额", "metric": "gross"},
            {"id": "p3", "type": "number", "title": "总净利润", "metric": "net_profit"},
            {"id": "p4", "type": "number", "title": "总推广费", "metric": "promo"},
            {"id": "p5", "type": "number", "title": "毛利率(%)", "metric": "gross_rate"},
            {"id": "p6", "type": "number", "title": "净利润率(%)", "metric": "net_rate"},
            {"id": "p7", "type": "bar", "title": "负责人收入与净利对比", "xField": "person", "yField": "revenue", "size": "lg"},
            {"id": "p8", "type": "pie", "title": "成本结构占比", "xField": "store", "yField": "cost", "size": "md"},
            {"id": "p9", "type": "bar", "title": "店铺收入 TOP20", "xField": "store", "yField": "revenue", "size": "lg"},
            {"id": "p10", "type": "bar", "title": "毛利率 vs 净利率对比", "xField": "store", "yField": "gross_rate", "size": "lg"},
            {"id": "p11", "type": "table", "title": "店铺利润明细表", "xField": "store", "yField": "revenue", "size": "lg"},
        ],
        "bi_pdd_annual": [
            {"id": "p1", "type": "number", "title": "年度 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "年度广告总投入", "metric": "ad_spend"},
            {"id": "p3", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p4", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p5", "type": "number", "title": "平均复购率(%)", "metric": "repurchase_rate"},
            {"id": "p6", "type": "number", "title": "平均退货率(%)", "metric": "return_rate"},
            {"id": "p7", "type": "line", "title": "月度 GMV 趋势", "xField": "month", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "ROI 月度走势", "xField": "month", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "月度广告投入", "xField": "month", "yField": "ad_spend"},
            {"id": "p10", "type": "bar", "title": "月 GMV 排行", "xField": "month", "yField": "gmv"},
            {"id": "p11", "type": "pie", "title": "广告投入占比", "xField": "month", "yField": "ad_spend"},
            {"id": "p12", "type": "pie", "title": "GMV 月度分布", "xField": "month", "yField": "gmv"},
            {"id": "p13", "type": "table", "title": "年度趋势明细表", "xField": "month", "yField": "gmv"},
        ],
        "bi_pdd_traffic": [
            {"id": "p1", "type": "number", "title": "总曝光量", "metric": "impressions"},
            {"id": "p2", "type": "number", "title": "总点击数", "metric": "clicks"},
            {"id": "p3", "type": "number", "title": "渠道 GMV 合计", "metric": "gmv"},
            {"id": "p4", "type": "number", "title": "平均点击率(%)", "metric": "ctr"},
            {"id": "p5", "type": "number", "title": "平均转化率(%)", "metric": "cvr"},
            {"id": "p6", "type": "number", "title": "平均排名", "metric": "avg_rank"},
            {"id": "p7", "type": "bar", "title": "渠道曝光量排行", "xField": "channel", "yField": "impressions"},
            {"id": "p8", "type": "bar", "title": "渠道 GMV 排行", "xField": "channel", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "渠道点击率对比", "xField": "channel", "yField": "ctr"},
            {"id": "p10", "type": "pie", "title": "GMV 渠道分布", "xField": "channel", "yField": "gmv"},
            {"id": "p11", "type": "pie", "title": "曝光量渠道分布", "xField": "channel", "yField": "impressions"},
            {"id": "p12", "type": "table", "title": "渠道流量明细表", "xField": "channel", "yField": "impressions"},
        ],
        "bi_products": [
            {"id": "p1", "type": "number", "title": "月总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "月总销量", "metric": "monthly_sales"},
            {"id": "p3", "type": "number", "title": "平均评分(分)", "metric": "rating"},
            {"id": "p4", "type": "number", "title": "平均毛利率(%)", "metric": "gross_margin"},
            {"id": "p5", "type": "number", "title": "平均复购率(%)", "metric": "repurchase_rate"},
            {"id": "p6", "type": "number", "title": "平均退货率(%)", "metric": "return_rate"},
            {"id": "p7", "type": "bar", "title": "产品销量排行", "xField": "product", "yField": "monthly_sales"},
            {"id": "p8", "type": "bar", "title": "产品 GMV 排行", "xField": "product", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "产品毛利率对比", "xField": "product", "yField": "gross_margin"},
            {"id": "p10", "type": "bar", "title": "复购率排行", "xField": "product", "yField": "repurchase_rate"},
            {"id": "p11", "type": "pie", "title": "GMV 产品分布", "xField": "product", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "销量产品分布", "xField": "product", "yField": "monthly_sales"},
            {"id": "p13", "type": "table", "title": "产品分析明细表", "xField": "product", "yField": "monthly_sales"},
        ],
        "bi_tmall_monthly": [
            {"id": "p1", "type": "number", "title": "半年 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "visitors"},
            {"id": "p3", "type": "number", "title": "总广告花费", "metric": "ad_spend"},
            {"id": "p4", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p5", "type": "number", "title": "平均转化率(%)", "metric": "pay_cvr"},
            {"id": "p6", "type": "number", "title": "平均新客率(%)", "metric": "new_customer_rate"},
            {"id": "p7", "type": "line", "title": "月度 GMV 趋势", "xField": "month", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "ROI 月度走势", "xField": "month", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "月 GMV 排行", "xField": "month", "yField": "gmv"},
            {"id": "p10", "type": "bar", "title": "月度广告花费", "xField": "month", "yField": "ad_spend"},
            {"id": "p11", "type": "pie", "title": "GMV 月度分布", "xField": "month", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "费用分布", "xField": "month", "yField": "ad_spend"},
            {"id": "p13", "type": "table", "title": "月度经营明细", "xField": "month", "yField": "gmv"},
        ],
        "bi_tmall_campaigns": [
            {"id": "p1", "type": "number", "title": "活动总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "visitors"},
            {"id": "p3", "type": "number", "title": "总新增客户", "metric": "new_customers"},
            {"id": "p4", "type": "number", "title": "总广告投入", "metric": "ad_spend"},
            {"id": "p5", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p6", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p7", "type": "bar", "title": "活动 GMV 排行", "xField": "campaign", "yField": "gmv"},
            {"id": "p8", "type": "bar", "title": "活动 ROI 对比", "xField": "campaign", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "活动新增客户数", "xField": "campaign", "yField": "new_customers"},
            {"id": "p10", "type": "funnel", "title": "活动转化漏斗", "xField": "campaign", "yField": "visitors"},
            {"id": "p11", "type": "pie", "title": "GMV 活动分布", "xField": "campaign", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "费用活动分布", "xField": "campaign", "yField": "ad_spend"},
            {"id": "p13", "type": "table", "title": "活动效果明细表", "xField": "campaign", "yField": "gmv"},
        ],
        "bi_douyin_live": [
            {"id": "p1", "type": "number", "title": "总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总观看人数", "metric": "viewers"},
            {"id": "p3", "type": "number", "title": "最高峰值在线", "metric": "peak_online"},
            {"id": "p4", "type": "number", "title": "平均转化率(%)", "metric": "cvr"},
            {"id": "p5", "type": "number", "title": "平均千次 GMV", "metric": "gmv_per_k"},
            {"id": "p6", "type": "number", "title": "新增粉丝总数", "metric": "new_followers"},
            {"id": "p7", "type": "bar", "title": "场次 GMV 排行", "xField": "session", "yField": "gmv"},
            {"id": "p8", "type": "bar", "title": "场次观看人数", "xField": "session", "yField": "viewers"},
            {"id": "p9", "type": "radar", "title": "直播场次效能雷达", "xField": "session", "yField": "engagement_rate"},
            {"id": "p10", "type": "bar", "title": "转化率对比", "xField": "session", "yField": "cvr"},
            {"id": "p11", "type": "pie", "title": "GMV 场次分布", "xField": "session", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "观众场次分布", "xField": "session", "yField": "viewers"},
            {"id": "p13", "type": "table", "title": "直播场次明细表", "xField": "session", "yField": "gmv"},
        ],
    }
    return {"templates": list(TEMPLATE_MAP.keys()), "panels": panels, "table_map": TEMPLATE_MAP}


@router.post("/filter_templates")
def save_filter_template(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存筛选条件模板"""
    name = payload["name"]
    filters_json = json.dumps(payload.get("filters", []))
    table = payload.get("table", "")
    db.execute(text(
        "INSERT INTO bi_filter_templates (name, filters, owner_id, table_name) VALUES (:n, :f, :uid, :t)"
    ), {"n": name, "f": filters_json, "uid": current_user.id, "t": table})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": name}


@router.get("/filter_templates")
def list_filter_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出当前用户的筛选模板"""
    rows = db.execute(text(
        "SELECT id, name, filters, table_name FROM bi_filter_templates WHERE owner_id=:uid ORDER BY id DESC"
    ), {"uid": current_user.id}).fetchall()
    return {"templates": [{"id": r[0], "name": r[1], "filters": r[2], "table": r[3]} for r in rows]}


@router.get("/market")
def list_marketplace(
    category: str = Query(default=""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """模板库列表：公开模板 + 自己发布的 + 指定给自己看的（管理员看全部）."""
    from app import template_market

    return {
        "templates": template_market.list_templates(db, current_user, category),
        "categories": list(template_market.CATEGORIES),
    }


@router.get("/market/{template_id}")
def get_market_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取模板详情（含面板定义 / 看板文档）."""
    from app import template_market

    try:
        return template_market.get_template(db, template_id, current_user)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@router.post("/market")
def publish_to_market(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """发布看板到模板市场（旧版引擎面板；新看板请用 /market/share）."""
    db.execute(text(
        "INSERT INTO bi_template_market (name, description, category, panels, table_map, author_id) VALUES (:n,:d,:c,CAST(:p AS jsonb),CAST(:t AS jsonb),:uid)"
    ), {"n": payload["name"], "d": payload.get("description", ""), "c": payload.get("category", "通用"),
        "p": json.dumps(payload.get("panels", [])), "t": json.dumps(payload.get("table_map", {})),
        "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}


@router.post("/market/share")
def share_board_to_market(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把「我的看板」分享到模板库：看板文档深拷贝 + 数据集复制到测试数据集."""
    from app import template_market

    board_id = payload.get("board_id")
    try:
        board_id = int(board_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "缺少看板 ID") from None
    try:
        return template_market.share_board(db, board_id, current_user, payload)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@router.post("/market/{template_id}/clone")
def clone_template_to_dashboard(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把模板克隆到当前用户的「我的看板」。

    看板模板：深拷贝文档（数据集已指向模板自己的公共副本），新建一块可编辑看板；
    旧版引擎模板：panels + table_map 深拷贝到 bi_dashboards。
    """
    from app import template_market

    try:
        return template_market.clone_template(db, template_id, current_user)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc
