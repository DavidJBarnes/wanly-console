import { Chip, Stack, Tooltip, Typography } from "@mui/material";
import type { Character } from "../api/ltx";
import { dateTimeLabel } from "../lib/dateTime";
import { shortLora } from "../lib/loraName";
import { sdxlChipLabel, sdxlTooltip } from "../lib/sdxlStatus";

/**
 * Has the character's newest LTX LoRA been tried? (David, 2026-10-10.) "Latest LoRA v3·e03 ·
 * Oct 7, 2:09 PM" plus Tested (green, with the render count) or Untested (amber); when the
 * newest is not the one renders use, the starred one is named too. Nothing at all for a
 * character with no completed LTX run.
 *
 * SDXL (wanly-api#458) gets its own line underneath: "SDXL v4·e11 · Oct 8, 3:12 PM" with
 * "Tested in A1111 · N images" or "Untested" -- counted from A1111's saved images on 3090b,
 * since SDXL LoRAs are used by hand there, never by a Wanly render.
 */
export default function LatestLoraStatus({ c, dense = false }: { c: Character; dense?: boolean }) {
  const ltx = <LtxLine c={c} dense={dense} />;
  const sx = c.latest_sdxl_lora;
  if (!c.latest_lora && !sx) return null;
  return (
    <>
      {c.latest_lora && ltx}
      {sx && (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center"
               sx={{ mt: 0.5 }}>
          <Tooltip title={sdxlTooltip(sx)}>
            <Typography variant="caption" color="text.secondary" noWrap={dense}>
              SDXL {shortLora(sx.name) ?? `v${sx.run_version}`}
              {sx.at ? ` · ${dateTimeLabel(sx.at)}` : ""}
            </Typography>
          </Tooltip>
          <Tooltip title={sdxlTooltip(sx)}>
            <Chip size="small" variant={sx.tested ? "filled" : "outlined"}
                  color={sx.tested ? "success" : "warning"} label={sdxlChipLabel(sx)} />
          </Tooltip>
        </Stack>
      )}
    </>
  );
}

function LtxLine({ c, dense }: { c: Character; dense: boolean }) {
  const l = c.latest_lora;
  if (!l) return null;
  const starred = c.starred_lora_renders;
  const last = l.last_rendered_at ? `last rendered ${dateTimeLabel(l.last_rendered_at)}` : "never rendered";
  const tip = [
    `Newest LTX run: v${l.run_version}${l.at ? `, finished ${dateTimeLabel(l.at)}` : ""}.`,
    l.tested ? `${l.renders} completed render${l.renders === 1 ? "" : "s"} used its checkpoints; ${last}.`
      : "No completed render has used any of its checkpoints yet.",
    !l.uploaded ? "Its checkpoint is still on the trainer — upload or ★ star it to render with it." : "",
  ].filter(Boolean).join(" ");
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center"
           sx={{ mt: dense ? 0.5 : 0.75 }}>
      <Tooltip title={tip}>
        <Typography variant="caption" color="text.secondary" noWrap={dense}>
          Latest LoRA {shortLora(l.name) ?? `v${l.run_version}`}
          {l.at ? ` · ${dateTimeLabel(l.at)}` : ""}
        </Typography>
      </Tooltip>
      <Tooltip title={tip}>
        <Chip size="small" variant={l.tested ? "filled" : "outlined"}
              color={l.tested ? "success" : "warning"}
              label={l.tested ? `Tested · ${l.renders} render${l.renders === 1 ? "" : "s"}` : "Untested"} />
      </Tooltip>
      {!l.is_starred && starred && (
        <Tooltip title={`Renders use ${starred.name}${starred.last_rendered_at
          ? ` — last rendered ${dateTimeLabel(starred.last_rendered_at)}` : ""}`}>
          <Chip size="small" variant="outlined" label={`★ ${shortLora(starred.name)} in use`} />
        </Tooltip>
      )}
    </Stack>
  );
}
