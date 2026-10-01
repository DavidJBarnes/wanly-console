import { useState } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { Star, StarBorder } from "@mui/icons-material";

/** THE default pose or character (console#543): preselected in New render and Next segment.
 *  Shared by the LoRA Recipes page (poses) and the Characters page. */
export default function DefaultStar({
  isDefault,
  what,
  onToggle,
}: {
  isDefault: boolean;
  what: "pose" | "character";
  onToggle: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Tooltip
      title={isDefault
        ? `Default ${what} — preselected in New render and Next segment. Click to clear.`
        : `Make this the default ${what}`}
    >
      <span>
        <IconButton
          size="small"
          disabled={busy}
          aria-label={isDefault ? `clear default ${what}` : `make default ${what}`}
          aria-pressed={isDefault}
          onClick={async () => {
            setBusy(true);
            try {
              await onToggle();
            } finally {
              setBusy(false);
            }
          }}
        >
          {isDefault
            ? <Star fontSize="small" color="warning" />
            : <StarBorder fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
