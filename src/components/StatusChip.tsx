import { Chip } from "@mui/material";
import type { JobStatus, SegmentStatus } from "../api/types";

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#f5f5f5", fg: "#616161" },
  processing: { bg: "#e3f2fd", fg: "#1565c0" },
  claimed: { bg: "#e3f2fd", fg: "#1565c0" },
  awaiting: { bg: "#fff3e0", fg: "#e65100" },
  completed: { bg: "#e8f5e9", fg: "#2e7d32" },
  failed: { bg: "#ffebee", fg: "#c62828" },
  paused: { bg: "#f3e5f5", fg: "#6a1b9a" },
  finalized: { bg: "#e0f2f1", fg: "#00695c" },
};

interface Props {
  status: JobStatus | SegmentStatus | string;
}

export default function StatusChip({ status }: Props) {
  const colors = STATUS_COLORS[status] ?? { bg: "#f5f5f5", fg: "#616161" };
  return (
    <Chip
      label={status}
      size="small"
      sx={{
        bgcolor: colors.bg,
        color: colors.fg,
        fontWeight: 600,
        fontSize: 12,
        textTransform: "capitalize",
      }}
    />
  );
}
