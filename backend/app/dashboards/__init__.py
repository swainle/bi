"""看板文档 v2（组件实例 + 参数 + 视图 + 动作）."""

from app.dashboards.models import ActionDef, DashboardDoc, ItemDef, ViewDef, validate_doc

__all__ = ["ActionDef", "DashboardDoc", "ItemDef", "ViewDef", "validate_doc"]
