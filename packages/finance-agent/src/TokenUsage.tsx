import type { TokenUsage as TU } from "./types";

export default function TokenUsage({ usage }: { usage?: TU }) {
  if (!usage) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--text-secondary, #aaa)", marginTop: 6 }}>
      tokens: {usage.total} | cost: ${usage.cost.toFixed(4)}
    </div>
  );
}
