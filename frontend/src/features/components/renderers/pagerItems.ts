/** 分页条纯函数（不依赖 React）：页码序列 + 每页条数档位。
 *  单独放一个文件，是因为明细表的单测跑在 node 环境，import 含 MUI 的组件会连带拉 React。 */

/** 每页条数可选项（面板配的默认值不在档位里时，PageBar 会把它补进下拉） */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type PagerItem = number | "ellipsis";

/** 页码序列：≤7 页全列；更多时首末页固定，当前页两侧留一个，中间用省略号。 */
export function pageItems(current: number, pages: number): PagerItem[] {
  const total = Math.max(1, Math.floor(pages) || 1);
  const at = Math.min(Math.max(1, Math.floor(current) || 1), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (at <= 4) return [1, 2, 3, 4, 5, "ellipsis", total];
  if (at >= total - 3) return [1, "ellipsis", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "ellipsis", at - 1, at, at + 1, "ellipsis", total];
}
