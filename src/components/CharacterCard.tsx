import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, IconButton, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, Tooltip, Typography,
} from "@mui/material";
import {
  AutoAwesome, CheckCircle, Close, ContentCopy, DeleteOutline, Edit, Image as ImageIcon,
} from "@mui/icons-material";
import { Link } from "react-router";

import { getFileUrl, listTrainingJobs } from "../api/client";
import { ltxError, TRIGGER_PLACEHOLDER, updateCharacter } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { TrainingJob } from "../api/types";
import CharacterAvatar from "./CharacterAvatar";
import DefaultStar from "./DefaultStar";
import PickFromRepoDialog from "./PickFromRepoDialog";
import SheetBuilderDialog from "./SheetBuilderDialog";
import { SheetPreview, SheetViewerDialog } from "./SheetPreview";
import StatusChip from "./StatusChip";
import { characterIconUri } from "../lib/characterIcon";
import {
  fillPhrase, hasLora, identityBadges, referenceMode,
} from "../lib/characterIdentity";
import { latestVersions, runDatasetName, versionRows } from "../lib/characterVersions";
import { checkpointInUse, scpCommand } from "../lib/trainingJob";

/**
 * A character's own card (console#616): everything about one character in one place.
 *
 *   - its icon, chosen here -- the image every picker shows for it
 *   - hide / unhide (console#617), default, edit, delete
 *   - its character sheet, and BUILD SHEET -- which lives here and nowhere else
 *   - its versions, LTX and SDXL side by side, so which SDXL LoRA goes with which LTX one is
 *     visible at a glance
 */
export default function CharacterCard({
  character, characters, onClose, onChanged, onEdit, onDelete, onToggleDefault,
}: {
  character: Character;
  /** Every character, for "is this checkpoint the one in use". */
  characters: Character[];
  onClose: () => void;
  /** Something about the character changed; the page reloads. */
  onChanged: (c?: Character) => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDefault: () => Promise<void>;
}) {
  const c = character;
  const [runs, setRuns] = useState<TrainingJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [choosingIcon, setChoosingIcon] = useState(false);
  const [building, setBuilding] = useState(false);
  const [viewing, setViewing] = useState(false);
  const solo = (c.kind ?? "solo") !== "pair";

  useEffect(() => {
    let cancelled = false;
    listTrainingJobs({ character: c.name })
      .then((r) => { if (!cancelled) setRuns(r); })
      .catch(() => {
        if (cancelled) return;
        setRuns([]);
        setError("could not load this character's training runs");
      });
    return () => { cancelled = true; };
  }, [c.name]);

  const patch = async (p: Parameters<typeof updateCharacter>[1]) => {
    setError(null);
    try {
      onChanged(await updateCharacter(c.id, p));
    } catch (e) {
      setError(ltxError(e));
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied`);
    } catch {
      setMsg(`could not copy the ${what}`);
    }
  };

  const rows = versionRows(runs ?? []);
  const latest = latestVersions(runs ?? []);
  const badges = identityBadges(c);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>{c.name}</Typography>
        <DefaultStar isDefault={!!c.is_default} what="character" onToggle={onToggleDefault} />
        <Tooltip title="Edit"><IconButton onClick={onEdit}><Edit /></IconButton></Tooltip>
        <Tooltip title="Delete"><IconButton onClick={onDelete}><DeleteOutline /></IconButton></Tooltip>
        <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* ---- who: icon, identity, visibility */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3} alignItems="flex-start">
          <Stack spacing={1} alignItems="center">
            <CharacterAvatar character={c} name={c.name} size={160} />
            <Button size="small" startIcon={<ImageIcon fontSize="small" />}
                    onClick={() => setChoosingIcon(true)}>
              Change icon
            </Button>
          </Stack>
          <Stack spacing={1} sx={{ minWidth: 0, flexGrow: 1 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {badges.map((b) => (
                <Chip key={b} size="small" label={b} variant="outlined"
                      color={b === "LoRA" ? "primary" : "secondary"} />
              ))}
              {c.trigger && (
                <Chip size="small" variant="outlined" label={`trigger: ${c.trigger}`}
                      onClick={() => void copy(c.trigger!, "trigger")} />
              )}
              {c.hidden && <Chip size="small" color="default" label="Hidden" />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {hasLora(c.char_lora)
                ? `LTX LoRA in use: ${c.char_lora} @ ${c.strength_stage_1}/${c.strength_stage_2}`
                : "No LTX LoRA"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {fillPhrase(c)
                ? `${TRIGGER_PLACEHOLDER} renders “${fillPhrase(c)}”`
                : `${TRIGGER_PLACEHOLDER} is dropped (no trigger or description)`}
              {referenceMode(c) === "face" ? " · renders with the face reference" : ""}
            </Typography>
            {/* ON = OFFERED (console#619). The first version was checked when HIDDEN, with a
                label that described the current state -- so switching "on" the characters
                wanted in the pickers hid exactly those. The label now says what ON does. */}
            <FormControlLabel
              control={<Switch checked={!c.hidden}
                               onChange={(e) => void patch({ hidden: !e.target.checked })} />}
              label="Show in character pickers"
            />
            {c.hidden && (
              <Typography variant="caption" color="text.secondary">
                Hidden: not offered in any character picker. Jobs that already use her keep her.
              </Typography>
            )}
          </Stack>
        </Stack>

        {/* ---- the sheet, and Build sheet: only here (console#616) */}
        {solo && (
          <>
            <Divider textAlign="left" sx={{ my: 2 }}>
              <Typography variant="overline">Character sheet</Typography>
            </Divider>
            <Stack direction="row" spacing={2} alignItems="center">
              {c.sheet_uri && (
                <Box sx={{ width: 220, flexShrink: 0 }}>
                  <SheetPreview uri={c.sheet_uri} alt={`${c.name} sheet`} labels={false}
                                onClick={() => setViewing(true)} />
                </Box>
              )}
              <Stack spacing={1}>
                <Button variant={c.sheet_uri ? "outlined" : "contained"}
                        startIcon={<AutoAwesome fontSize="small" />}
                        onClick={() => setBuilding(true)}>
                  {c.sheet_uri ? "Sheets & build new" : "Build sheet"}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {c.sheet_uri
                    ? "See every sheet saved for her, switch between them, or build a new one."
                    : "Build a 1536×1024 sheet from one photo of her."}
                </Typography>
              </Stack>
            </Stack>
          </>
        )}

        {/* ---- versions, LTX and SDXL side by side */}
        <Divider textAlign="left" sx={{ my: 2 }}>
          <Typography variant="overline">Versions</Typography>
        </Divider>
        {runs === null ? (
          <CircularProgress size={20} />
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No training runs yet.</Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
              <Typography variant="body2">Latest:</Typography>
              <Chip size="small" color="info" variant="outlined"
                    label={`LTX ${latest.ltx !== null ? `v${latest.ltx}` : "—"}`} />
              <Chip size="small" color="secondary" variant="outlined"
                    label={`SDXL ${latest.sdxl !== null ? `v${latest.sdxl}` : "—"}`} />
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" component={Link}
                      to={`/training?character=${encodeURIComponent(c.name)}`}>
                All runs
              </Button>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 56 }}>Version</TableCell>
                  <TableCell>LTX (video)</TableCell>
                  <TableCell>SDXL (start images)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.version}>
                    <TableCell sx={{ fontFamily: "monospace" }}>v{r.version}</TableCell>
                    <TableCell>
                      <RunCell run={r.ltx} latest={r.version === latest.ltx}
                               inUse={!!r.ltx && checkpointInUse(r.ltx, characters) !== null}
                               onCopy={copy} />
                    </TableCell>
                    <TableCell>
                      <RunCell run={r.sdxl} latest={r.version === latest.sdxl}
                               inUse={false} onCopy={copy} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {msg && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {msg}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {choosingIcon && (
        <IconChooser
          character={c} runs={runs ?? []}
          onClose={() => setChoosingIcon(false)}
          onChoose={(uri) => { setChoosingIcon(false); void patch({ icon_uri: uri }); }}
        />
      )}
      {building && (
        <SheetBuilderDialog
          character={c}
          onClose={() => setBuilding(false)}
          onSaved={(saved) => onChanged(saved)}
        />
      )}
      {viewing && c.sheet_uri && (
        <SheetViewerDialog
          uri={c.sheet_uri}
          title={`${c.name} — character sheet`}
          subtitle={`${c.sheet_uri.split("/").pop()}${referenceMode(c) === "face"
            ? " · not used: renders with the face reference" : ""}`}
          onClose={() => setViewing(false)}
        />
      )}
    </Dialog>
  );
}

/** One arch's run at one version: status, dataset, date, and the final checkpoint. */
function RunCell({
  run, latest, inUse, onCopy,
}: {
  run: TrainingJob | null;
  latest: boolean;
  inUse: boolean;
  onCopy: (text: string, what: string) => void;
}) {
  if (!run) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const when = run.completed_at ?? run.created_at;
  const dataset = runDatasetName(run);
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap">
        <StatusChip status={run.status} />
        {latest && <Chip size="small" label="latest" variant="outlined" />}
        {inUse && (
          <Tooltip title="The LoRA this character renders with">
            <Chip size="small" color="success" icon={<CheckCircle />} label="in use" />
          </Tooltip>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {[dataset, when && new Date(when).toLocaleDateString()].filter(Boolean).join(" · ")}
      </Typography>
      {run.status === "completed" && (
        <Box>
          <Button size="small" startIcon={<ContentCopy fontSize="small" />}
                  onClick={() => onCopy(scpCommand(run, "final"), "scp for the final checkpoint")}>
            Copy scp
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/**
 * Pick the character's icon (console#616): its own images first -- the face reference, the
 * sheet, the trained LoRA's face, each training run's anchor -- or anything in the Image Repo.
 */
function IconChooser({
  character, runs, onClose, onChoose,
}: {
  character: Character;
  runs: TrainingJob[];
  onClose: () => void;
  /** null: back to the automatic choice. */
  onChoose: (uri: string | null) => void;
}) {
  const [fromRepo, setFromRepo] = useState(false);
  const candidates = [...new Set([
    character.icon_uri, character.face_ref_uri, character.image_uri, character.sheet_uri,
    ...runs.map((r) => r.thumbnail_uri),
  ].filter((u): u is string => !!u))];
  const current = characterIconUri(character);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Icon for {character.name}</DialogTitle>
      <DialogContent dividers>
        {candidates.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No images of her yet — pick one from the Image Repo.
          </Typography>
        )}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {candidates.map((uri) => (
            <Box key={uri} component="img" src={getFileUrl(uri)} alt=""
                 onClick={() => onChoose(uri)}
                 sx={{
                   width: 112, height: 112, objectFit: "cover", borderRadius: 1,
                   cursor: "pointer", border: "3px solid",
                   borderColor: uri === current ? "secondary.main" : "transparent",
                 }} />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        {character.icon_uri && (
          <Button sx={{ mr: "auto" }} onClick={() => onChoose(null)}>Use the automatic one</Button>
        )}
        <Button onClick={() => setFromRepo(true)}>From the Image Repo…</Button>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
      {fromRepo && (
        <PickFromRepoDialog
          title={`Icon for ${character.name}`}
          onClose={() => setFromRepo(false)}
          onPick={(path) => { setFromRepo(false); onChoose(path); }}
        />
      )}
    </Dialog>
  );
}
