/** 读取某个语义数据集的字段清单（指标 / 维度 / 标识） */

import { useEffect, useState } from "react";
import client from "../../../api/client";
import type { FieldGroup } from "../editor/FieldPanel";

const EMPTY: FieldGroup = { metrics: [], dimensions: [], identifiers: [] };

export function useDatasetFields(datasetId?: number | null) {
  const [groups, setGroups] = useState<FieldGroup>(EMPTY);
  const [datasetName, setDatasetName] = useState("");

  useEffect(() => {
    if (!datasetId) {
      setGroups(EMPTY);
      setDatasetName("");
      return;
    }
    client.get(`/bi/semantic/datasets/${datasetId}`).then((res) => {
      setDatasetName(res.data?.name || "");
      const raw: { name: string; role: string }[] = res.data?.fields || [];
      const metricsRaw: { name: string }[] = res.data?.metrics || [];
      setGroups({
        metrics: [
          ...metricsRaw.map((m) => ({ name: m.name, role: "metric" })),
          ...raw.filter((f) => f.role === "measure"),
        ],
        dimensions: raw.filter((f) => f.role !== "measure" && f.role !== "id"),
        identifiers: raw.filter((f) => f.role === "id"),
      });
    }).catch(() => setGroups(EMPTY));
  }, [datasetId]);

  return { groups, datasetName };
}
