import { useEffect, useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip,
  CircularProgress, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { ExpandMore, Casino } from "@mui/icons-material";
import {
  listRecipes, listLoras, ltxError, renderPrompt,
  type RecipeBook, type Character, type Pose,
} from "../api/ltx";
import { createJob, sha256Hex } from "../api/client";
import type { JobCreate } from "../api/types";

/**
 * Pick a validated (character, pose) configuration and a start frame. Everything
 * else comes from the recipe.
 *
 * ONE component, rendered in two places — the Storyboard page and the New Job
 * dialog. Two hand-maintained copies of this form is exactly how the prompt and
 * the recipe drift apart, and this project has already paid for that once with
 * two copies of recipes.json.
 *
 * It exposes very little on purpose. Across the validated recipes only the
 * character LoRA and the prompt ever varied; everything else is one global
 * stack. Character, pose and start frame really is the whole decision.
 */
export interface RecipeFormProps {
  /** "dialog" drops the heading and tightens spacing. The fields are identical. */
  variant?: "page" | "dialog";
  /** Called with the new job id once it is created. */
  onCreated?: (jobId: string) => void;
}

/** LTX wants dimensions on the /64 grid. The engine derives the final size from
 *  the image itself; this is the same arithmetic so the job record agrees with
 *  what actually renders instead of carrying a placeholder. */
const to64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return { width: to64(img.naturalWidth), height: to64(img.naturalHeight) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RecipeForm({ variant = "page", onCreated }: RecipeFormProps) {
  const compact = variant === "dialog";

  const [book, setBook] = useState<RecipeBook | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [characterName, setCharacterName] = useState("");
  const [poseName, setPoseName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Pre-filled from the recipe, editable. Editing means this is no longer the
  // validated configuration — which is recorded, not prevented.
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [charLora, setCharLora] = useState("");
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  const [frames, setFrames] = useState("");

  // A DRAW, not part of the recipe: a new seed is still the validated
  // configuration. Random so repeated renders explore, overridable so a good one
  // reproduces exactly.
  const newSeed = () => String(Math.floor(Math.random() * 9007199254740991));
  const [seed, setSeed] = useState(newSeed);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRecipes()
      .then((b) => {
        setBook(b);
        setCharacterName(b.characters[0]?.name ?? "");
        listLoras(b).then(setLoras).catch(() => {});
      })
      .catch((e) => setError(ltxError(e)));
  }, []);

  // `poses ?? []` rather than `book.poses`. An API returning an older or unexpected shape
  // must not white-screen the form — that is the worst possible failure mode, because it
  // reports nothing and looks like the app is broken rather than the data.
  const poses = book?.poses ?? [];

  const character: Character | null =
    book?.characters.find((c) => c.name === characterName) ?? null;
  // Poses are character-agnostic, so the list never changes with the character —
  // which is the point: a new LoRA gets every pose the moment it exists.
  const pose: Pose | null = poses.find((p) => p.name === poseName) ?? null;
  // What this pose renders as for THIS character — the baseline an edit is measured against.
  const renderedPrompt =
    pose && character ? renderPrompt(pose.prompt_template, character.trigger) : "";

  useEffect(() => {
    if (book && !poseName) setPoseName(poses[0]?.name ?? "");
  }, [book, poseName, poses]);

  // The prompt shown is the RENDERED one, not the template. It is editable, so
  // showing "<TRIGGER>, a woman..." would mean editing around a placeholder and
  // being unable to see what actually renders.
  useEffect(() => {
    if (!pose || !character) return;
    setPrompt(renderPrompt(pose.prompt_template, character.trigger));
    setNegative(pose.negative_prompt);
    setCharLora(character.char_lora);
    setS1(String(character.strength_stage_1));
    setS2(String(character.strength_stage_2));
    setFrames(String(pose.frames));
  }, [pose, character]);

  const onFile = (f: File | null) => {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!file || !pose || !character || !book) return;
    setBusy(true);
    setError(null);
    try {
      const { width, height } = await imageSize(file);
      const fps = book.stack.frame_rate;
      const nFrames = Number(frames) || pose.frames;

      const job: JobCreate = {
        name: `${character.name} — ${pose.name}`,
        width,
        height,
        fps,
        seed: seed.trim() === "" ? null : Number(seed),
        continuation_mode: "traditional",
        first_segment: {
          prompt: prompt.trim(),
          negative_prompt: negative.trim() || null,
          // The queue speaks seconds; LTX speaks frames. Sent both ways round so
          // neither side has to guess, and ltx_pose.frames is authoritative.
          duration_seconds: nFrames / fps,
          speed: 1.0,
          // What actually ran, recorded against the segment. graph_sha256 is
          // filled in by the worker once the engine resolves the graph — it is a
          // record of what happened, not an input.
          ltx_recipe: {
            recipe: pose.name,
            character: character.name,
            char_lora: charLora,
            char_s1: Number(s1),
            char_s2: Number(s2),
            frames: nFrames,
            edited:
              [
                prompt.trim() !== renderedPrompt.trim() ? "prompt" : null,
                negative.trim() !== pose.negative_prompt.trim() ? "negative" : null,
                charLora !== character.char_lora ? "char_lora" : null,
                Number(s1) !== character.strength_stage_1 ? "char_s1" : null,
                Number(s2) !== character.strength_stage_2 ? "char_s2" : null,
              ].filter(Boolean),
          },
        },
      } as JobCreate;

      const form = new FormData();
      form.append("data", JSON.stringify(job));
      form.append("starting_image", file);
      await sha256Hex(file).catch(() => undefined);
      const created = await createJob(form);
      setSeed(newSeed());
      onCreated?.(created.id);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  const edited = pose
    ? prompt.trim() !== renderedPrompt.trim() || negative.trim() !== pose.negative_prompt.trim()
    : false;

  return (
    <Stack spacing={compact ? 1.5 : 2}>
      {error && <Alert severity="error">{error}</Alert>}
      {!book && !error && <CircularProgress size={20} />}
      {book && poses.length === 0 && (
        <Alert severity="warning">
          No poses returned by the API. Nothing to render until at least one exists.
        </Alert>
      )}
      {book && (book.characters ?? []).length === 0 && (
        <Alert severity="warning">
          No characters yet — a character supplies the LoRA and the trigger word.
        </Alert>
      )}

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
        <TextField
          select label="Character" value={characterName}
          sx={{ flex: "1 1 180px", minWidth: 160 }} size={compact ? "small" : "medium"}
          onChange={(e) => setCharacterName(e.target.value)}
        >
          {(book?.characters ?? []).map((c) => (
            <MenuItem key={c.id} value={c.name}>{c.name}</MenuItem>
          ))}
        </TextField>
        <TextField
          select label="Pose" value={poseName}
          sx={{ flex: "2 1 240px", minWidth: 200 }} size={compact ? "small" : "medium"}
          onChange={(e) => setPoseName(e.target.value)}
          helperText={compact ? undefined : "Fields below are this recipe's defaults."}
        >
          {poses.map((r) => (
            <MenuItem key={r.id} value={r.name}>
              {r.name}{r.validated ? "" : "  (unvalidated)"}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Box>
        <Button variant="outlined" component="label" size={compact ? "small" : "medium"}>
          {file ? "Change start frame" : "Choose start frame"}
          <input hidden type="file" accept="image/*"
                 onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </Button>
        {file && (
          <Typography variant="caption" sx={{ ml: 2 }} color="text.secondary">
            {file.name} — resolution derived from this image
          </Typography>
        )}
        {preview && (
          <Box sx={{ mt: 1 }}>
            <img src={preview} alt="start frame"
                 style={{ maxHeight: compact ? 120 : 220, borderRadius: 4 }} />
          </Box>
        )}
      </Box>

      {pose && character && (
        <>
          <TextField
            fullWidth multiline minRows={compact ? 2 : 4} label="Prompt" value={prompt}
            size={compact ? "small" : "medium"}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              select label="Char LoRA" value={charLora}
              sx={{ flex: "2 1 220px", minWidth: 180 }} size={compact ? "small" : "medium"}
              onChange={(e) => setCharLora(e.target.value)}
            >
              {/* the recipe's own first, so it is never buried under the rest */}
              <MenuItem value={character.char_lora}>{character.char_lora}</MenuItem>
              {loras.filter((l) => l !== character.char_lora).map((l) => (
                <MenuItem key={l} value={l}>{l}</MenuItem>
              ))}
            </TextField>
            <TextField label="Stage 1" value={s1} size={compact ? "small" : "medium"}
                       sx={{ flex: "1 1 100px", minWidth: 90 }}
                       onChange={(e) => setS1(e.target.value)} />
            <TextField label="Stage 2" value={s2} size={compact ? "small" : "medium"}
                       sx={{ flex: "1 1 100px", minWidth: 90 }}
                       onChange={(e) => setS2(e.target.value)} />
            <TextField label="Frames" value={frames} size={compact ? "small" : "medium"}
                       sx={{ flex: "1 1 100px", minWidth: 90 }}
                       onChange={(e) => setFrames(e.target.value)} />
            <TextField
              label="Seed" value={seed} size={compact ? "small" : "medium"}
              sx={{ flex: "1.4 1 160px", minWidth: 140 }}
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
            size={compact ? "small" : "medium"}
            onChange={(e) => setNegative(e.target.value)}
          />

          {edited && (
            <Alert severity="info" sx={{ py: 0 }}>
              Edited — this render is recorded as a variation on {pose.name}, not the
              validated configuration.
            </Alert>
          )}

          {/* Collapsed by default, so it costs no space but the form is never opaque:
              this is what the recipe pins and the user does not choose. */}
          <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: "divider" }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2" color="text.secondary">Fixed by the recipe</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={0.5}>
                {book && ([
                  ["Checkpoint", book.stack.checkpoint],
                  ["Content LoRA", book.stack.content_lora],
                  ["Distill", `${book.stack.distill} @ ${book.stack.distill_stage_1}/${book.stack.distill_stage_2}`],
                  ["Guidance", `cfg ${book.stack.cfg}, stg ${book.stack.stg}, rescale ${book.stack.rescale}, blocks ${book.stack.stg_blocks}`],
                  ["Steps", `${book.stack.steps_stage_1} then ${book.stack.sigmas_stage_2}`],
                  ["Frame rate", `${book.stack.frame_rate} fps`],
                ] as [string, string][]).map(([k, v]) => (
                  <Stack key={k} direction="row" spacing={1}>
                    <Typography variant="caption" sx={{ minWidth: 96 }} color="text.secondary">{k}</Typography>
                    <Typography variant="caption" sx={{ flex: 1 }}>{v}</Typography>
                  </Stack>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </>
      )}

      <Box>
        <Button variant="contained" onClick={submit} disabled={!pose || !file || busy}>
          {busy ? "Creating…" : "Queue render"}
        </Button>
        {pose && !pose.validated && (
          <Chip size="small" label="unvalidated pose" sx={{ ml: 1 }} />
        )}
      </Box>
    </Stack>
  );
}
