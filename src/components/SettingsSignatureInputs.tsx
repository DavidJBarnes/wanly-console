import { Box, Tooltip, TextField } from "@mui/material";
import { SIG_COLS } from "./SettingsSignature";

// Editable version of the signature table: abbreviated headers over a row of number inputs.
export default function SettingsSignatureInputs({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${SIG_COLS.length}, minmax(52px, 1fr))`,
        gap: 0.75,
        alignItems: "end",
      }}
    >
      {SIG_COLS.map((c) => (
        <Tooltip key={`h-${c.key}`} title={c.full} arrow>
          <Box sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", textAlign: "center", cursor: "default" }}>
            {c.label}
          </Box>
        </Tooltip>
      ))}
      {SIG_COLS.map((c) => (
        <TextField
          key={`v-${c.key}`}
          type="number"
          size="small"
          value={values[c.key] ?? ""}
          onChange={(e) => onChange(c.key, e.target.value)}
          slotProps={{ htmlInput: { style: { textAlign: "center", padding: "6px 4px" } } }}
        />
      ))}
    </Box>
  );
}
