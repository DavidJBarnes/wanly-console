import { Box, Tooltip } from "@mui/material";

export type SignatureValues = {
  lightx2v_strength_high?: number | null;
  lightx2v_strength_low?: number | null;
  cfg_high?: number | null;
  cfg_low?: number | null;
  steps_total?: number | null;
  high_noise_steps?: number | null;
  flow_shift?: number | null;
};

// Canonical order + abbreviated headers for the 7 sampler params.
// step: 0.1 for the continuous knobs (weights/cfg/flow); 1 for the integer step-count fields
// (steps_total / high_noise_steps must stay whole — the API rejects fractional ints).
export const SIG_COLS: { key: keyof SignatureValues; label: string; full: string; step: number }[] = [
  { key: "lightx2v_strength_high", label: "LX-H", full: "LightX2V High", step: 0.1 },
  { key: "lightx2v_strength_low", label: "LX-L", full: "LightX2V Low", step: 0.1 },
  { key: "cfg_high", label: "CFG-H", full: "CFG High", step: 0.1 },
  { key: "cfg_low", label: "CFG-L", full: "CFG Low", step: 0.1 },
  { key: "steps_total", label: "Steps", full: "Steps Total", step: 1 },
  { key: "high_noise_steps", label: "St-H", full: "High-Noise Steps (high/low split)", step: 1 },
  { key: "flow_shift", label: "Flow", full: "Flow Shift", step: 0.1 },
];

// Parse "1,1,3,1,8,4,5" or grouped "1,1 · 3,1 · 8/4 · 5" into the 7 keyed values.
export function parseSignature(s: string): SignatureValues | null {
  const nums = s
    .split(/[^0-9.]+/)
    .filter((x) => x !== "")
    .map(Number);
  if (nums.length !== SIG_COLS.length || nums.some((n) => Number.isNaN(n))) return null;
  const out: SignatureValues = {};
  SIG_COLS.forEach((c, i) => (out[c.key] = nums[i]));
  return out;
}

export default function SettingsSignature({ values }: { values: SignatureValues }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${SIG_COLS.length}, 1fr)`,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {SIG_COLS.map((c) => (
        <Tooltip key={`h-${c.key}`} title={c.full} arrow>
          <Box
            sx={{
              px: 0.25,
              py: 0.25,
              bgcolor: "action.hover",
              borderBottom: "1px solid",
              borderColor: "divider",
              textAlign: "center",
              fontWeight: 700,
              color: "text.secondary",
              cursor: "default",
            }}
          >
            {c.label}
          </Box>
        </Tooltip>
      ))}
      {SIG_COLS.map((c) => (
        <Box key={`v-${c.key}`} sx={{ px: 0.25, py: 0.25, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {values[c.key] ?? "—"}
        </Box>
      ))}
    </Box>
  );
}
