/** 导航菜单卡「首视页」—— 打开看板时优先展示哪一页
 *
 * 菜单项上勾了「首视页」（`nav.items[].active`）的那一项，它的 `page` 就是落地页。
 * 页面上放的卡片可能在 `items`，也可能在分平台的 `items_map[平台]` 里，所以两处都要找。
 */

type NavItemLike = { page?: string; active?: boolean };
type ItemLike = { spec?: { nav?: { items?: NavItemLike[] } } | null };
type ViewLike = { key: string; items?: ItemLike[]; items_map?: Record<string, ItemLike[] | undefined> };

/** 返回「首视页」的页面 key；没配或配的页面已不存在则返回 null（调用方退回第一页） */
export function navHomePage(doc: { views?: ViewLike[] } | null | undefined): string | null {
  const views = doc?.views ?? [];
  if (!views.length) return null;
  const keys = new Set(views.map((view) => view.key));
  for (const view of views) {
    const all = [
      ...(view.items ?? []),
      ...Object.values(view.items_map ?? {}).flatMap((list) => list ?? []),
    ];
    for (const item of all) {
      for (const navItem of item?.spec?.nav?.items ?? []) {
        if (navItem?.active && navItem?.page && keys.has(navItem.page)) return navItem.page;
      }
    }
  }
  return null;
}
