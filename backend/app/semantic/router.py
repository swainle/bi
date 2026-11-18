"""语义层 API —— 数据集 CRUD 与按语义执行查询.

端点：
    GET    /api/bi/semantic/datasets
    POST   /api/bi/semantic/datasets
    GET    /api/bi/semantic/datasets/{id}
    PATCH  /api/bi/semantic/datasets/{id}
    PATCH  /api/bi/semantic/datasets/{id}/name      （只改名字，不碰连接配置）
    DELETE /api/bi/semantic/datasets/{id}
    POST   /api/bi/semantic/datasets/{id}/query
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.security.nav_guard import require_nav
from app.middleware.auth import get_current_user
from app.models.user import User
from app.query.contract import QueryObject
from app.query.executor import run as execute_query
from app.query.live import run_live
from app.query.table_catalog import is_queryable
from app.security.sql_guard import to_sql
from app.semantic import repository as repo
from app.semantic.compiler import compile_query
from app.semantic.validator import SemanticError
from app.security.errors import RlsBlockedError, SecurityError

router = APIRouter(prefix="/bi/semantic", tags=["BI语义层"])


def _require_dataset(db: Session, dataset_id: int):
    dataset = repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(404, f"数据集不存在：{dataset_id}")
    return dataset


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    if isinstance(exc, ValueError):
        return HTTPException(400, str(exc))
    return HTTPException(400, f"执行失败：{str(exc)[:200]}")


_INT_RE = re.compile(r"^-?\d+$")
_NUM_RE = re.compile(r"^-?\d+\.\d+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _infer_field(sample: str | None) -> tuple[str, str]:
    """按样例值猜字段角色与类型（虚拟数据集建字段用）."""
    value = (sample or "").strip()
    if _INT_RE.match(value):
        return "measure", "integer"
    if _NUM_RE.match(value):
        return "measure", "numeric"
    if _DATE_RE.match(value):
        return "time", "date"
    return "dimension", "text"


def _validate_virtual_sql(sql_text: str) -> str:
    """虚拟数据集只允许读取业务表的只读 SQL。"""
    cleaned = (sql_text or "").strip().rstrip(";").strip()
    if not cleaned:
        raise HTTPException(400, "SQL 不能为空")
    try:
        from app.query.sql_lab import validate
        root = validate(cleaned)
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    return to_sql(root)


@router.get("/tables")
def list_tables(
    include_counts: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """本地业务表 + 列 + 行数（新建数据集时挑表、自动导入列）."""
    return {"tables": repo.list_physical_tables(db, include_counts=include_counts)}


@router.get("/datasets")
def list_datasets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出可见数据集（公共 + 自己的）；模板库里复制出来的数据集只标出来，不进「数据集」页."""
    from app import template_market

    items = repo.list_datasets(db, owner_id=current_user.id)
    template_map = template_market.dataset_template_map(db)
    payload = []
    for dataset in items:
        data = dataset.to_dict(with_items=False)
        meta = template_map.get(dataset.id)
        if meta:
            data["template_id"] = meta["template_id"]
            data["template_name"] = meta["template_name"]
        payload.append(data)
    return {"datasets": payload}


# 直连数据集连通性缓存：值 = {ok, message, at}；进页面只探一次，短时间重复进入不再连源库
_STATUS_TTL = 30.0
_status_cache: dict[int, dict] = {}


@router.get("/datasets/status")
def datasets_status(
    refresh: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """直连数据集的源库连通性（数据集列表右侧小圆点：绿=连得上 / 红=连不上）.

    本地（抽取）数据集不探，不返回；结果缓存 30 秒，点圆点传 refresh=1 立即重探。
    """
    from app.sources import repository as sources_repo

    items = [d for d in repo.list_datasets(db, owner_id=current_user.id)
             if (d.conn_mode or "extract") == "live"]
    if not items:
        return {"status": {}}

    now = time.time()
    need = [d for d in items
            if refresh or d.id not in _status_cache or now - _status_cache[d.id]["at"] >= _STATUS_TTL]

    # 取数据源配置放在主线程（Session 不能跨线程用），线程里只做网络 I/O
    jobs: list[tuple[int, dict]] = []
    for dataset in need:
        if dataset.source_id is None:
            _status_cache[dataset.id] = {"ok": False, "message": "未绑定数据源", "at": now}
            continue
        src = sources_repo.get_source(db, int(dataset.source_id))
        if src is None:
            _status_cache[dataset.id] = {"ok": False, "message": "数据源已不存在", "at": now}
            continue
        jobs.append((dataset.id, src))

    def probe(job: tuple[int, dict]) -> tuple[int, bool, str]:
        dataset_id, src = job
        try:
            sources_repo.test_source(src)
            return dataset_id, True, "连接正常"
        except Exception as exc:  # 网络 / 驱动 / 认证失败都归到红点，错误原文给 tooltip
            return dataset_id, False, str(exc)[:180]

    if jobs:
        with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
            for dataset_id, ok, message in pool.map(probe, jobs):
                _status_cache[dataset_id] = {"ok": ok, "message": message, "at": time.time()}

    return {"status": {
        str(d.id): {
            "ok": _status_cache[d.id]["ok"],
            "message": _status_cache[d.id]["message"],
            "checked_at": int(_status_cache[d.id]["at"]),
        }
        for d in items if d.id in _status_cache
    }}


@router.get("/datasets/sandbox")
def list_sandbox_datasets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """「测试数据集」页里自建的测试数据集（is_sandbox，公共、跟随项目）."""
    items = [d for d in repo.list_datasets(db) if getattr(d, "is_sandbox", False)]
    return {"datasets": [d.to_dict(with_items=False) for d in items]}


@router.get("/datasets/templates")
def list_template_datasets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """模板库复制出来的数据集（「测试数据集」页展示；按模板可见性过滤）."""
    from app import template_market

    return {"datasets": template_market.list_template_datasets(db, current_user)}


@router.post("/datasets/test", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def ensure_test_dataset(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """「测试数据集」：组件库 / 卡片预览用的模拟数据（公共、跟随项目）。

    缺了或被误删就按内置演示数据重建（表 + 数据集 + 字段都补齐），因此随时可以点出来。
    只有管理员能删（见 delete_dataset）。
    """
    from app.components import seed_demo

    dataset_id = seed_demo.ensure_demo_dataset(db)
    dataset = repo.get_dataset(db, dataset_id)
    fields = len(getattr(dataset, "fields", None) or [])
    return {"id": dataset_id, "name": seed_demo.DATASET_NAME, "fields": fields}


@router.post("/datasets", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def create_dataset(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建数据集：物理表 / 自定义 SQL（虚拟数据集）/ 直连源库表.

    `sandbox: true` = 「测试数据集」页自建的公共测试数据集（owner 为空、跟着项目走，只有管理员能建 / 删）。
    """
    mode = str(payload.get("conn_mode") or "extract").strip().lower()
    source_id = payload.get("source_id")
    virtual = str(payload.get("sql") or "").strip()
    sandbox = bool(payload.get("sandbox"))
    if sandbox and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "「测试数据集」是公共数据，只有管理员可以新建")

    if mode == "live":
        # 直连：表名按源库原样写（可带 schema），表名交给源库存在性校验
        sql_text = ""
        table = str(payload.get("physical_table", "")).strip()
        if not table:
            raise HTTPException(400, "直连数据集必须指定源库表名")
    elif virtual:
        sql_text = _validate_virtual_sql(virtual)
        table = "custom_sql"
    else:
        sql_text = ""
        table = str(payload.get("physical_table", "")).strip()
        if not is_queryable(table):
            raise HTTPException(404, f"不是可访问的业务表：{table}")

    try:
        probed = None
        if sql_text:
            from app.query.sql_lab import preview
            probed = preview(db, sql_text, current_user, 1)
        dataset = repo.create_dataset(
            db,
            name=str(payload.get("name", "")).strip(),
            physical_table=table,
            owner_id=None if sandbox else current_user.id,
            description=str(payload.get("description", "")),
            sql_text=sql_text,
            conn_mode=mode,
            source_id=int(source_id) if source_id not in (None, "") else None,
            sandbox=sandbox,
        )
        if sql_text and not payload.get("fields"):
            # 虚拟数据集：按 SQL 的输出列自动建字段
            for column in probed["columns"]:
                sample = probed["rows"][0].get(column) if probed["rows"] else None
                role, data_type = _infer_field(str(sample) if sample is not None else None)
                data_type = probed["column_types"].get(column, data_type)
                role = "measure" if data_type in ("integer", "numeric") else "time" if data_type in ("date", "datetime") else "dimension"
                repo.add_field(
                    db, dataset, name=column, source_column=column,
                    role=role, data_type=data_type, validate=False,
                )
        for item in payload.get("fields", []) or []:
            repo.add_field(
                db, dataset, name=item["name"], source_column=item["source_column"],
                expression=str(item.get("expression") or ""),
                role=item.get("role", "dimension"),
                data_type=item.get("data_type", "text"),
                default_grain=item.get("default_grain"),
                description=item.get("description", ""),
                is_filterable=item.get("is_filterable", True),
                is_groupable=item.get("is_groupable", True),
                validate=not sql_text,
            )
        for item in payload.get("metrics", []) or []:
            repo.add_metric(
                db, dataset, name=item["name"],
                expression=item["expression"],
                fmt=item.get("format", "number"),
                description=item.get("description", ""),
            )
    except KeyError as exc:
        raise HTTPException(400, f"缺少字段：{exc}") from exc
    except (SemanticError, SecurityError) as exc:
        # 建了一半的脏数据集不留在库里
        try:
            if "dataset" in locals():
                repo.delete_dataset(db, dataset.id)
        finally:
            raise _guard(exc) from exc

    except Exception as exc:
        db.rollback()
        if "dataset" in locals():
            repo.delete_dataset(db, dataset.id)
        raise HTTPException(400, "虚拟数据集创建失败，请检查 SQL 和输出字段") from exc

    full = repo.get_dataset(db, dataset.id)
    return full.to_dict() if full else {"id": dataset.id}


@router.patch("/datasets/{dataset_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def update_dataset(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """改数据集名称 / 描述 / 取数方式（extract ↔ live）."""
    _require_dataset(db, dataset_id)
    try:
        sql_text = payload.get("sql")
        if sql_text is not None:
            sql_text = _validate_virtual_sql(str(sql_text))
        raw_sid = payload.get("source_id")
        dataset = repo.update_dataset(
            db, dataset_id,
            name=payload.get("name"),
            description=payload.get("description"),
            sql_text=sql_text,
            conn_mode=payload.get("conn_mode"),
            source_id=int(raw_sid) if raw_sid not in (None, "") else None,
        )
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return dataset.to_dict() if dataset else {"id": dataset_id}


def _can_rename(dataset, user: User) -> bool:
    """公共数据集（owner 为空）人人可改；自己的可改；别人的只有管理员能改."""
    return dataset.owner_id in (None, user.id) or user.role in ("admin", "super_admin")


@router.patch("/datasets/{dataset_id}/name", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def rename_dataset(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """只改名字（数据集页就地改名 / 抽屉标题改名都走这里）.

    与 PATCH /datasets/{id} 的区别：这条路径在 SQL 层面只写 name 一列，
    物理表、取数方式、绑定的数据源、自定义 SQL 一律不动 —— 改名不可能影响数据库连接。
    """
    from app.components.seed_demo import TABLE as TEST_DATASET_TABLE

    dataset = _require_dataset(db, dataset_id)
    if not _can_rename(dataset, current_user):
        raise HTTPException(403, "只能修改自己创建的数据集的名称")
    if dataset.physical_table == TEST_DATASET_TABLE:
        raise HTTPException(403, "「测试数据集」是组件库预览用的公共资产，不支持改名")
    try:
        renamed = repo.rename_dataset(db, dataset_id, payload.get("name"))
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return renamed.to_dict(with_items=False)


@router.post("/datasets/{dataset_id}/sync", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def sync_dataset_columns(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """从物理表同步列：补齐没登记的列（不删不覆盖）."""
    dataset = _require_dataset(db, dataset_id)
    try:
        result = repo.sync_fields(db, dataset)
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return {"id": dataset_id, **result}


@router.get("/datasets/{dataset_id}")
def get_dataset(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _require_dataset(db, dataset_id).to_dict()


@router.get("/datasets/{dataset_id}/usages")
def dataset_usages(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """这个数据集被哪些看板 / 页面 / 元素在用（来自保存时落的账本，删数据集前先看这里）."""
    _require_dataset(db, dataset_id)
    from app.dashboards import sources as dash_sources

    rows = dash_sources.usages_of_dataset(db, dataset_id)
    return {"dataset_id": dataset_id, "count": len(rows), "usages": rows}


@router.delete("/datasets/{dataset_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def delete_dataset(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = _require_dataset(db, dataset_id)
    # 「测试数据集」是组件库预览用的公共数据，跟着项目走：只有管理员能删
    from app.components.seed_demo import TABLE as TEST_DATASET_TABLE
    if dataset.physical_table == TEST_DATASET_TABLE and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "「测试数据集」是组件库预览用的公共数据，只有管理员可以删除")
    # 模板库的数据副本：模板还在用它，只有管理员能删（删了模板就取不到数）
    from app import template_market
    if dataset.id in template_market.dataset_template_map(db) \
            and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "这个数据集属于模板库的模板，只有管理员可以删除")
    if dataset.owner_id not in (None, current_user.id) and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "只能删除自己创建的数据集")
    ok = repo.delete_dataset(db, dataset_id)
    return {"deleted": ok, "id": dataset_id}


def _live_source(db: Session, dataset) -> dict:
    """直连数据集 → 取出它绑定的数据源（连密码一起，engine_for 要用）."""
    from app.sources import repository as sources_repo

    if dataset.source_id is None:
        raise SemanticError(f"直连数据集未绑定数据源：{dataset.name}")
    src = sources_repo.get_source(db, int(dataset.source_id))
    if src is None:
        raise SemanticError(f"数据集绑定的数据源不存在：{dataset.source_id}")
    return src

@router.post("/datasets/{dataset_id}/query")
def query_dataset(
    dataset_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """按语义名查询：dimensions / metrics / filters / order_by / limit."""
    dataset = _require_dataset(db, dataset_id)
    try:
        query: QueryObject = compile_query(dataset, payload or {})
        if (dataset.conn_mode or "extract") == "live":
            src = _live_source(db, dataset)
            result = run_live(db, query, current_user, src, dataset_id=dataset.id)
        else:
            result = execute_query(db, query, current_user,
                                   dataset_id=dataset.id)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    except Exception as exc:
        raise _guard(exc) from exc

    return {
        "dataset": dataset.name,
        "mode": dataset.conn_mode or "extract",
        "sql": result.sql,
        "columns": result.columns,
        "rows": result.rows,
        "count": result.count,
        "elapsed_ms": result.elapsed_ms,
        "rls": result.rls,
    }
