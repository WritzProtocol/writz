import type { BentoMetric } from "../types/bentoMetric.types";

export const spvMetrics: BentoMetric[] = [
  { label: "Confirmations", num: 6, suffix: "" },
  { label: "Header size", num: 80, suffix: "B" },
  { label: "Oracles", num: 0, suffix: "" },
  { label: "On-chain call", num: 1, suffix: "" },
];
