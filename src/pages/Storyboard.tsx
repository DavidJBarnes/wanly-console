import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  LinearProgress, MenuItem, Stack, TextField, Typography, Accordion,
  AccordionSummary, AccordionDetails,
} from "@mui/material";
import { ExpandMore, Casino, Download, Movie } from "@mui/icons-material";
import {
  listRecipes, listLoras, submitJob, getJob, videoUrl, ltxHealth, ltxError,
  type RecipeBook, type Recipe, type LtxJob,
} from "../api/ltx";

/** Not a sheet tab: "none" means checkpoint + prompt with no character LoRA. */
const NO_CHAR = "none";

/**
 * Storyboard — LTX 2.3 recipe renders.
 *
 * Pick a validated (character, pose) configuration and a start frame.
 * Everything else comes from the recipe.
 *
 * Ported from the storyboard POC's Recipes tab. That project also had a
 * free-form panel exposing every lever, used to FIND configurations; it is not
 * ported, because this is the reproduce-a-validated-one path and the value of it
 * is precisely that it exposes almost nothing. The engine resolves the recipe
 * server-side and hashes the graph, so a render here is provably the same one
 * that was signed off — which stays true only while this page does not quietly
 * add parameters.
 */
export default function Storyboard() {
  const [book, setBook] = useState<RecipeBook | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [character, setCharacter] = useState("");
  const [recipe, setRecipe] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Fields the sheet marks "ui with defaults": pre-filled from the recipe,
  // editable. Editing one means this is no longer the validated configuration,
  // which the engine reports back in the job notes.
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [charLora, setCharLora] = useState("");
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  const [frames, setFrames] = useState("241");
  // Seed is a DRAW, not part of the recipe: a new seed is still the validated
  // configuration. Random by default so repeated renders explore, overridable
  // so a good one can be reproduced exactly.
  const newSeed = () => String(Math.floor(Math.random() * 2147483647));
  const [seed, setSeed] = useState(newSeed);
  const [job, setJob] = useState<LtxJob | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [queue, setQueue] = useState<{ queue_depth: number; running: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    listRecipes()
      .then((b) => {
        setBook(b);
        setCharacter(Object.keys(b.characters ?? {})[0] ?? b.character ?? "");
      })
      .catch((e) => setError(ltxError(e)));
    // Char LoRA is "ui" in the sheet — the user picks it, so offer what the
    // engine actually has rather than trusting a typed string.
    listLoras().then((r) => setLoras(r.loras.map((l) => l.name))).catch(() => {});
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  // Each sheet tab is a character. Fall back to the flat top-level map for an
  // engine that predates multi-character.
  const chars = book?.characters ?? {};
  const charNames = Object.keys(chars);
  // "none" borrows the recipe list (the prompts ARE the recipe) and drops the
  // LoRA below.
  const recipesFor = (c: string) =>
    ((c === NO_CHAR ? chars[charNames[0]]?.recipes : chars[c]?.recipes) ??
      book?.recipes ?? {}) as Record<string, Recipe>;
  const sel = book && recipe ? recipesFor(character)[recipe] ?? null : null;

  // Changing character invalidates the chosen recipe, so land on that
  // character's first recipe. Clearing to "" instead left the panel empty on
  // load — every field below is gated behind `sel`, so the user saw two
  // dropdowns and nothing else.
  useEffect(() => {
    if (!character) return;
    setRecipe(Object.keys(recipesFor(character))[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, book]);

  useEffect(() => {
    if (!book || !recipe) return;
    const r = recipesFor(character)[recipe];
    if (!r) return;
    setPrompt(book.definitions[r.prompt] ?? r.prompt);
    setNegative(book.definitions[r.negative] ?? r.negative);
    setCharLora(character === NO_CHAR ? NO_CHAR : r.char_lora);
    setS1(r.char_s1);
    setS2(r.char_s2);
    setFrames(r.frames.match(/\d+/)?.[0] ?? "241");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, recipe, character]);

  const src = (k: string) => book?.sources?.[k] ?? "";
  const def = (k: string) => book?.definitions?.[k] ?? k;

  const onFile = (f: File | null) => {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  // A render takes ~10 minutes. Without elapsed time there is no way to tell a
  // slow one from a stuck one.
  useEffect(() => {
    const live = job?.status === "None" || job?.status === "Processing";
    if (!live) return;
    const t = window.setInterval(() => {
      setElapsed((e) => e + 1);
      ltxHealth()
        .then((h) => setQueue({ queue_depth: h.queue_depth, running: h.running }))
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(t);
  }, [job?.status]);

  const poll = (id: string) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const j = await getJob(id);
        setJob(j);
        if (j.status === "Done" || j.status === "Failed") {
          if (timer.current) window.clearInterval(timer.current);
        }
      } catch {
        // The engine holds jobs in memory: a restart loses the record while the
        // rendered file survives. Keep polling rather than declaring failure.
      }
    }, 4000);
  };

  const render = async () => {
    if (!file || !sel) return;
    setBusy(true); setError(null); setJob(null);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const d = book?.definitions ?? {};
      const changed = (v: string, key: string) => v.trim() !== (d[key] ?? key).trim();
      const j = await submitJob({
        recipe,
        character,
        // Only send a field if it differs from the recipe's default — an
        // unchanged field must not alter the graph, or the hash would stop
        // meaning "this is the validated configuration".
        prompt: changed(prompt, sel.prompt) ? prompt : "",
        negative_prompt: changed(negative, sel.negative) ? negative : null,
        loras:
          charLora !== sel.char_lora || s1 !== sel.char_s1 || s2 !== sel.char_s2
            ? [{ name: charLora, strength: Number(s1),
                 strength_stage_1: Number(s1), strength_stage_2: Number(s2) }]
            : [],
        keyframes: [{ image: dataUrl }],
        // Width/height are DERIVED by the engine from the start frame (rounded
        // to /64). They are sent only because the request requires them; the
        // engine overwrites them.
        width: 768, height: 1344,
        num_frames: Number(frames) || 241, frame_rate: 24,
        seed: seed.trim() === "" ? null : Number(seed),
      });
      setJob(j);
      setElapsed(0);
      poll(j.job_id);
      setSeed(newSeed());
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  const running = job?.status === "None" || job?.status === "Processing";
  const vsrc = job ? videoUrl(job) : null;

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
        Storyboard
      </Typography>

      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1}
                 useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
            <Movie fontSize="small" />
            <Typography variant="h6">Recipe render</Typography>
            {character && <Chip size="small" label={character} />}
            {sel && (
              <Chip
                size="small"
                color={sel.validated === "Yes" ? "success" : "default"}
                label={sel.validated === "Yes" ? "validated" : `validated: ${sel.validated}`}
              />
            )}
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!book && !error && <CircularProgress size={20} />}

          <Stack spacing={2}>
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
              <TextField
                select label="Character" value={character}
                sx={{ flex: "1 1 180px", minWidth: 160 }}
                onChange={(e) => setCharacter(e.target.value)}
              >
                {charNames.map((c) => (
                  <MenuItem key={c} value={c}>{c}</MenuItem>
                ))}
                <MenuItem value={NO_CHAR}>
                  <em>none — no character LoRA</em>
                </MenuItem>
              </TextField>
              <TextField
                select label="Recipe" value={recipe}
                sx={{ flex: "2 1 260px", minWidth: 220 }}
                onChange={(e) => setRecipe(e.target.value)}
                helperText="A validated pose configuration. Fields below are its defaults."
              >
                {Object.entries(recipesFor(character)).map(([n, r]) => (
                  <MenuItem key={n} value={n}>
                    {n}{r.validated !== "Yes" ? "  (unvalidated)" : ""}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Box>
              <Button variant="outlined" component="label">
                {file ? "Change start frame" : "Choose start frame"}
                <input hidden type="file" accept="image/*"
                       onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              </Button>
              {file && (
                <Typography variant="caption" sx={{ ml: 2 }} color="text.secondary">
                  {file.name} — resolution is derived from this image
                </Typography>
              )}
              {preview && (
                <Box sx={{ mt: 1 }}>
                  <img src={preview} alt="start frame"
                       style={{ maxHeight: 220, borderRadius: 4 }} />
                </Box>
              )}
            </Box>

            {sel && (
              <>
                <TextField
                  fullWidth multiline minRows={4} label="Prompt" value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  helperText="Default comes from the recipe. Editing it means this is no longer the validated configuration."
                />
                <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
                  <TextField
                    select label="Char LoRA" value={charLora}
                    sx={{ flex: "2 1 240px", minWidth: 200 }}
                    onChange={(e) => setCharLora(e.target.value)}
                    helperText={
                      charLora === NO_CHAR
                        ? "Checkpoint only — the start frame carries identity"
                        : charLora !== sel.char_lora
                        ? "Not this recipe's LoRA — check the prompt's trigger word"
                        : " "
                    }
                  >
                    {/* what the engine actually has, recipe's default first and
                        "none" right behind it so it is never buried */}
                    <MenuItem value={sel.char_lora}>
                      {sel.char_lora.replace(/\.safetensors$/, "")}
                    </MenuItem>
                    <MenuItem value={NO_CHAR}>
                      <em>none — checkpoint only</em>
                    </MenuItem>
                    {loras
                      .filter((l) => l !== sel.char_lora &&
                              l.replace(/\.safetensors$/, "") !== sel.char_lora)
                      .map((l) => (
                        <MenuItem key={l} value={l}>
                          {l.replace(/\.safetensors$/, "")}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField label="Stage 1 strength" value={s1}
                             sx={{ flex: "1 1 130px", minWidth: 110 }}
                             onChange={(e) => setS1(e.target.value)} />
                  <TextField label="Stage 2 strength" value={s2}
                             sx={{ flex: "1 1 130px", minWidth: 110 }}
                             onChange={(e) => setS2(e.target.value)} />
                  <TextField label="Frames" value={frames}
                             sx={{ flex: "1 1 110px", minWidth: 90 }}
                             onChange={(e) => setFrames(e.target.value)} />
                  <TextField
                    label="Seed" value={seed}
                    sx={{ flex: "1.4 1 170px", minWidth: 150 }}
                    onChange={(e) => setSeed(e.target.value)}
                    InputProps={{
                      endAdornment: (
                        <Button size="small" onClick={() => setSeed(newSeed())}
                                title="New random seed" sx={{ minWidth: 0, px: 0.5 }}>
                          <Casino fontSize="small" />
                        </Button>
                      ),
                    }}
                  />
                </Stack>
                <TextField
                  fullWidth multiline minRows={2} label="Negative prompt" value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                />
                <Accordion disableGutters elevation={0}
                           sx={{ border: 1, borderColor: "divider" }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="body2" color="text.secondary">
                      Fixed by the recipe
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1}>
                      {[
                        ["Checkpoint", sel.checkpoint, src("checkpoint")],
                        ["Content LoRA", sel.content_lora, src("content_lora")],
                        ["Distill", def(sel.distill), src("distill")],
                        ["Guidance", def(sel.guidance), src("guidance")],
                        ["Steps", def(sel.steps), src("steps")],
                        ["Resolution", def(sel.resolution), src("resolution")],
                      ].map(([k, v, sc]) => (
                        <Stack key={k as string} direction="row" spacing={1}>
                          <Typography variant="caption" sx={{ minWidth: 110 }}
                                      color="text.secondary">
                            {k}
                          </Typography>
                          <Typography variant="caption" sx={{ flex: 1 }}>{v}</Typography>
                          {sc ? <Chip size="small" variant="outlined" label={sc as string} /> : null}
                        </Stack>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </>
            )}

            <Box>
              <Button variant="contained" onClick={render}
                      disabled={!recipe || !file || busy || running}>
                {busy || running ? "Rendering…" : "Render"}
              </Button>
            </Box>

            {job && (
              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                <Stack direction="row" spacing={2} alignItems="center"
                       sx={{ mb: running ? 1 : 0 }}>
                  <Chip
                    size="small"
                    color={job.status === "Done" ? "success"
                         : job.status === "Failed" ? "error" : "info"}
                    label={job.status === "None" ? "Queued" : job.status}
                  />
                  {running && (
                    <Typography variant="body2">
                      {Math.floor(elapsed / 60)}m {String(elapsed % 60).padStart(2, "0")}s
                      <Typography component="span" variant="caption" color="text.secondary">
                        {"  "}· a render is typically 8–12m
                      </Typography>
                    </Typography>
                  )}
                  {running && queue && queue.queue_depth > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {queue.queue_depth} waiting ahead
                    </Typography>
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  {vsrc && job.status === "Done" && (
                    <Button size="small" startIcon={<Download />} component="a"
                            href={vsrc}
                            download={`${character}-${recipe}.mp4`.replace(/\s+/g, "-")}>
                      Download
                    </Button>
                  )}
                </Stack>
                {running && <LinearProgress />}
                <Typography variant="caption" color="text.secondary"
                            sx={{ display: "block", mt: 1 }}>
                  {job.job_id}
                  {job.notes?.length ? ` · ${job.notes.join(" · ")}` : ""}
                </Typography>
                {job.stages?.length ? (
                  <Typography variant="caption" color="text.secondary"
                              sx={{ display: "block" }}>
                    {job.stages.map((st) => `stage ${st.stage}: ${st.steps} steps`).join("  ·  ")}
                  </Typography>
                ) : null}
              </Box>
            )}

            {job?.status === "Failed" && <Alert severity="error">{job.error}</Alert>}
            {vsrc && job?.status === "Done" && (
              <video src={vsrc} controls
                     style={{ maxHeight: 420, maxWidth: "100%", borderRadius: 4,
                              display: "block", margin: "0 auto" }} />
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
