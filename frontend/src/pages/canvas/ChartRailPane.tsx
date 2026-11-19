/** 画布编辑器 · 右栏（图表类型栏） */

import { Box } from "@mui/material";

import ChartTypeRail from "../../features/components/editor/ChartTypeRail";
import OverlayScrollbar from "../../features/components/editor/OverlayScrollbar";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { ComponentItem, ComponentKind } from "../../features/components/types";
import { CollapseButton, CollapseStrip, type useResizableWidth } from "./controls";
import type { PaneCollapsed } from "./types";

export default function ChartRailPane({
  collapsed, togglePane, rightW, components, selectedItem, componentsLoading, pickComponent, beginInsertDrag,
}: {
  collapsed: PaneCollapsed;
  togglePane: (key: "left" | "mid" | "right") => void;
  rightW: ReturnType<typeof useResizableWidth>;
  components: ComponentItem[];
  selectedItem: CanvasItem | null;
  componentsLoading: boolean;
  pickComponent: (component: ComponentItem) => void;
  beginInsertDrag: (payload: {
    type: "chart"; kind: ComponentKind; component?: ComponentItem; label: string;
  }) => (event: React.PointerEvent) => void;
}) {
  return (
    <>
      {collapsed.right && <CollapseStrip side="right" label="图表类型" onClick={() => togglePane("right")} />}
        {/* 右：图表类型 */}
        <Box ref={rightW.paneRef} data-pane="right" sx={{
          width: collapsed.right ? 0 : "var(--pane-w, 168px)", flexShrink: 0, bgcolor: "#fff", minHeight: 0,
          display: "block",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.right ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={rightW.paneRef} />
          <CollapseButton dir="right" title="收起图表类型" onClick={() => togglePane("right")} />
          <ChartTypeRail
            components={components}
            kind={selectedItem?.kind ?? "kpi"}
            loading={componentsLoading}
            onPick={pickComponent}
            onDragInsert={(component, event) => beginInsertDrag({
              type: "chart", kind: component.kind, component, label: component.name,
            })(event)}
          />
        </Box>
    </>
  );
}
