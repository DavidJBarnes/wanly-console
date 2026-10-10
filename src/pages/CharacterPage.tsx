import { useCallback, useEffect, useState } from "react";
import LatestLoraStatus from "../components/LatestLoraStatus";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router";
import {
  Alert, Box, Button, Card, CardActionArea, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import { Add, ArrowBack, DeleteOutline, Edit, Star } from "@mui/icons-material";

import { createDataset, getCharacterFull, getFileUrl } from "../api/client";
import {
  deleteCharacter, listLoras, listRecipes, ltxError, setDefaultCharacter,
} from "../api/ltx";
import type { Character } from "../api/ltx";
import type { CharacterFull } from "../api/types";
import CharacterCard from "../components/CharacterCard";
import { DatasetCard } from "../components/DatasetCard";
import DatasetRunsPanel from "../components/DatasetRunsPanel";
import DefaultStar from "../components/DefaultStar";
import TrainLoraDialog from "../components/TrainLoraDialog";
import { characterPicture } from "../lib/characterPage";
import { hasLora } from "../lib/characterIdentity";
import { CharacterDialog } from "./Characters";

type TabKey = "images" | "training" | "identity" | "history";
const TABS: TabKey[] = ["images", "training", "identity", "history"];

/**
 * One character, with everything that belongs to it (wanly-api#452): Characters and Datasets
 * collapsed. A character HAS its dataset (Images), its runs for both arches (Training, where
 * the ★ star picks the LTX checkpoint it renders with), its sheet/face reference (Identity)
 * and its archived version sets (History). A pair's page links its members; its Images are the
 * together set.
 *
 * One read per change: GET /ltx/characters/{name}/full.
 */
export default function CharacterPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.includes(searchParams.get("tab") as TabKey)
    ? searchParams.get("tab") : "images") as TabKey;
  const focusRun = searchParams.get("run");
  const [full, setFull] = useState<CharacterFull | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");
  const [training, setTraining] = useState(false);
  const [runsKey, setRunsKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [loras, setLoras] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, b] = await Promise.all([getCharacterFull(name), listRecipes()]);
      setFull(f);
      setCharacters(b.characters ?? []);
      setError("");
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? `No character ${name}.` : ltxError(e));
    }
  }, [name]);

  useEffect(() => {
    let live = true;
    Promise.all([getCharacterFull(name), listRecipes()])
      .then(([f, b]) => { if (live) { setFull(f); setCharacters(b.characters ?? []); setError(""); } })
      .catch((e: unknown) => {
        if (!live) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        setError(status === 404 ? `No character ${name}.` : ltxError(e));
      });
    return () => { live = false; };
  }, [name]);

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    next.delete("run");
    setSearchParams(next, { replace: true });
  };

  const c = full?.character ?? null;
  const ds = full?.dataset ?? null;
  const pair = (c?.kind ?? "solo") === "pair";
  // The anchor stands for the character (David: "make the anchor the card pic too"); an icon
  // chosen by hand still wins, and the old fallbacks follow.
  const icon = c ? characterPicture(c, ds?.anchor_uri) : null;

  const createSet = async () => {
    if (!c) return;
    setBusy(true);
    try {
      await createDataset({ name: c.name, kind: pair ? "composition" : "character", character: c.name });
      await load();
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!c) return;
    setBusy(true);
    try {
      await deleteCharacter(c.id);
      navigate("/characters", { replace: true });
    } catch (e) {
      setError(ltxError(e));
      setBusy(false);
    }
  };

  const openEditor = async () => {
    try {
      const b = await listRecipes();
      setLoras(await listLoras(b, "character"));
    } catch { setLoras([]); }
    setEditing(true);
  };

  if (!full && !error) return <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}><CircularProgress /></Box>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Button component={RouterLink} to="/characters" startIcon={<ArrowBack />} size="small">
          Characters
        </Button>
      </Stack>
      {error && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {c && full && (
        <>
          {/* ---- header */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mb: 2 }}>
            <Box sx={{ width: 96, height: 96, borderRadius: 2, overflow: "hidden", flexShrink: 0,
                       bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {icon ? (
                <Box component="img" src={getFileUrl(icon)} alt={c.name}
                     sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Typography variant="h3" color="text.secondary">{c.name.slice(0, 1).toUpperCase()}</Typography>
              )}
            </Box>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h4" noWrap>{c.name}</Typography>
                {pair && <Chip size="small" label="pair" variant="outlined" />}
                {c.hidden && <Chip size="small" label="Hidden" />}
              </Stack>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                {c.trigger && <Chip size="small" variant="outlined" label={`trigger: ${c.trigger}`} />}
                {hasLora(c.char_lora) ? (
                  <Tooltip title="The LTX checkpoint this character renders with — change it with the ★ on the Training tab">
                    <Chip size="small" color="warning" icon={<Star fontSize="small" />}
                          label={`${c.char_lora} @ ${c.strength_stage_1}/${c.strength_stage_2}`} />
                  </Tooltip>
                ) : (
                  <Chip size="small" color="warning" variant="outlined"
                        label="no LTX checkpoint starred — draft" />
                )}
                {c.star_pending && (
                  <Chip size="small" color="warning" variant="outlined"
                        label={`★ ${c.star_pending.label} uploading`} />
                )}
                {c.base_checkpoint && <Chip size="small" variant="outlined" label={`base: ${c.base_checkpoint}`} />}
                {full.members.map((m) => (
                  <Chip key={m.id} size="small" clickable component={RouterLink}
                        to={`/characters/${encodeURIComponent(m.name)}`} label={`member: ${m.name}`} />
                ))}
                {full.pairs.map((p) => (
                  <Chip key={p.id} size="small" clickable variant="outlined" component={RouterLink}
                        to={`/characters/${encodeURIComponent(p.name)}`} label={`pair: ${p.name}`} />
                ))}
              </Stack>
              <LatestLoraStatus c={c} />
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <DefaultStar isDefault={!!c.is_default} what="character"
                           onToggle={async () => { await setDefaultCharacter(c.id, !c.is_default); await load(); }} />
              <Tooltip title="Edit name, trigger, strengths…"><IconButton onClick={() => void openEditor()}><Edit /></IconButton></Tooltip>
              <Tooltip title="Delete the character"><IconButton onClick={() => setConfirmDelete(true)}><DeleteOutline /></IconButton></Tooltip>
            </Stack>
          </Stack>

          <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
            <Tab value="images" label={`Images${ds ? ` (${ds.images.length})` : ""}`} />
            <Tab value="training" label={`Training (${full.runs.length})`} />
            <Tab value="identity" label="Identity" />
            <Tab value="history" label={`History (${full.archived.length})`} />
          </Tabs>

          {tab === "images" && (ds ? (
            <DatasetCard
              key={ds.id}
              ds={ds}
              characters={characters}
              onChanged={() => void load()}
              onCharactersChanged={() => void load()}
              onTrain={() => setTraining(true)}
              onCloned={(copy) => navigate(`/datasets/${copy.id}`)}
              onDeleted={() => void load()}
            />
          ) : (
            <Alert severity="info" action={
              <Button color="inherit" size="small" startIcon={<Add />} disabled={busy} onClick={() => void createSet()}>
                Create it
              </Button>
            }>
              {c.name} has no {pair ? "together set" : "dataset"} yet.
              {full.archived.length > 0 ? " Its old version sets are under History." : ""}
            </Alert>
          ))}

          {tab === "training" && (
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                <Button variant="contained" disabled={!ds} onClick={() => setTraining(true)}>Train</Button>
                <Typography variant="body2" color="text.secondary">
                  One dataset trains both LoRAs: LTX for renders (★ star the one {c.name} renders
                  with) and SDXL for start images in A1111.
                </Typography>
              </Stack>
              <DatasetRunsPanel ds={ds} refreshKey={runsKey} focusRun={focusRun} title="Runs"
                                loadRuns={async () => (await getCharacterFull(c.name)).runs} />
            </Box>
          )}

          {tab === "identity" && (
            <CharacterCard
              embedded
              character={c}
              characters={characters}
              onClose={() => setTab("images")}
              onChanged={() => void load()}
              onEdit={() => void openEditor()}
              onDelete={() => setConfirmDelete(true)}
              onToggleDefault={async () => { await setDefaultCharacter(c.id, !c.is_default); await load(); }}
            />
          )}

          {tab === "history" && (
            full.archived.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No archived version sets — {c.name} has always had just the one dataset.
              </Typography>
            ) : (
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {full.archived.map((a) => (
                  <Card key={a.id} variant="outlined">
                    <CardActionArea component={RouterLink} to={`/datasets/${a.id}`} sx={{ p: 1.5 }}>
                      <Typography variant="subtitle2" noWrap>{a.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {a.images.length} images · archived {a.archived_at ? new Date(a.archived_at).toLocaleDateString() : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(a.trained_by ?? []).length > 0
                          ? `trained ${(a.trained_by ?? []).map((t) => `v${t.version}`).join(", ")}`
                          : "read-only history"}
                      </Typography>
                    </CardActionArea>
                  </Card>
                ))}
              </Box>
            )
          )}

          {training && ds && (
            <TrainLoraDialog
              dataset={ds}
              onClose={() => setTraining(false)}
              onQueued={() => { setTraining(false); setRunsKey((k) => k + 1); void load(); setTab("training"); }}
            />
          )}
          {editing && (
            <CharacterDialog
              character={c}
              loras={loras}
              onFixed={() => void load()}
              onClose={() => setEditing(false)}
              onSaved={(saved) => {
                setEditing(false);
                if (saved.name !== c.name) navigate(`/characters/${encodeURIComponent(saved.name)}`, { replace: true });
                else void load();
              }}
            />
          )}
          <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
            <DialogTitle>Delete {c.name}?</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                Its dataset and runs stay, and no file is deleted: renders already made keep
                working, and every run keeps its record of what it trained on.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button color="error" disabled={busy} onClick={() => void remove()}>Delete</Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
