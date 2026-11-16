/** 面积图卡 —— 复用折线渲染器，开启填充 */

import LineCard from "./LineCard";
import type { RenderPayload, UiSpec } from "../types";

export default function AreaCard({ payload, ui }: { payload: RenderPayload; ui: UiSpec }) {
  return <LineCard payload={payload} ui={ui} area />;
}
