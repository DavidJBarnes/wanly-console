import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip,
  CircularProgress, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { ExpandMore, Casino } from "@mui/icons-material";
import {
  listRecipes, listLoras, ltxError, renderPrompt,
  NO_CHARACTER,
  type RecipeBook, type Character, type Pose,
} from "../api/ltx";
import {
  addSegment, createJob, describeImageScene, getFileUrl, getImageScene,
} from "../api/client";
import {
  fillScene, hasScenePlaceholder, hasSceneRegion, restoreScenePlaceholder,
  stripSceneMarkers,
} from "../lib/sceneRegion";
import type { JobCreate, SegmentCreate, SegmentResponse } from "../api/types";

/**
 * Pick a validated (character, pose) configuration and a start frame. Everything
 * else comes from the recipe.
 *
 * ONE component, rendered in two places — the New Job dialog and Next Segment.
 * (A third, the Storyboard page, is gone: recipe renders go through the queue
 * like anything else.) Two hand-maintained copies of this form is exactly how
 * the prompt and the recipe drift apart, and this project has already paid for
 * that once with two copies of recipes.json.
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
  /** An image already in S3, from the Image Repo. Re-uploading it would duplicate
   *  the object, so it is referenced by path instead. */
  initialStartingImageUri?: string | null;
  /** Tags carried from the source image. Job tags drive filtering on the queue and
   *  Videos, so an image's tags should reach the job it starts. */
  initialTags?: string | null;
  /** Continue an existing job instead of creating one: appends a segment rather than
   *  posting a new job.
   *
   *  The start frame is deliberately OPTIONAL here. The claim endpoint already resolves a
   *  segment's start image from the previous segment's last_frame_path when it is null, and
   *  every LTX render uploads its last frame — so the chain works without asking, and
   *  choosing one is an override rather than a requirement. */
  continueJobId?: string;
  /** The segment a continuation follows. Its choices are the starting point for the next
   *  one — a continuation almost always keeps the same character and LoRA strengths, and
   *  making the user re-pick them from defaults every time is how a chain silently changes
   *  configuration halfway through. */
  initialFrom?: SegmentResponse | null;
}

/**
 * The start frame, from either source.
 *
 * ONE piece of state holding a File or an S3 path, not two. A start image reaches
 * a job two ways — uploaded, or referenced because it is already in S3 — and
 * keeping them as separate fields means every reader has to remember both. That
 * is the shape that dropped ltx_recipe from segment 0: two paths doing one job,
 * and only one of them maintained.
 */
type StartFrame =
  | { kind: "file"; file: File; previewUrl: string }
  | { kind: "uri"; uri: string; previewUrl: string };

/** LTX wants dimensions on the /64 grid. The engine derives the final size from
 *  the image itself; this is the same arithmetic so the job record agrees with
 *  what actually renders instead of carrying a placeholder. */
const to64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);

/** Measured from the rendered image, so it works for an uploaded File and an S3
 *  object alike — the object URL and the presigned file URL both just load. */
async function imageSize(url: string): Promise<{ width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("could not load the start frame to measure it"));
    i.src = url;
  });
  return { width: to64(img.naturalWidth), height: to64(img.naturalHeight) };
}

export default function RecipeForm({
  variant = "page",
  onCreated,
  initialStartingImageUri,
  initialTags,
  continueJobId,
  initialFrom,
}: RecipeFormProps) {
  const continuing = Boolean(continueJobId);
  const compact = variant === "dialog";

  const [book, setBook] = useState<RecipeBook | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [characterName, setCharacterName] = useState("");
  const [poseName, setPoseName] = useState("");
  const [start, setStart] = useState<StartFrame | null>(null);
  // <SCENE> preview (console#405). Only for a start frame already in S3: a freshly picked
  // file has not been uploaded yet, so there is nothing for the captioner to fetch. That
  // case still works -- the API resolves the placeholder at claim time once the upload has
  // landed -- it just cannot be previewed here.
  const [describing, setDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  // The description already saved against the chosen start frame, if it has one
  // (console#414). A ref as well as state: the pose/character effect fills the prompt the
  // moment it renders a template, and it must read the CURRENT value without listing it as
  // a dependency — that would re-render the template, discarding the user's edits, every
  // time a description arrived.
  const [savedScene, setSavedScene] = useState<string | null>(null);
  const savedSceneRef = useRef<string | null>(null);
  savedSceneRef.current = savedScene;

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
  //
  // Memoised because it is a hook dependency: a fresh [] every render would re-run the
  // effect below forever.
  const poses = useMemo(() => book?.poses ?? [], [book]);

  const character: Character | null =
    characterName === NO_CHARACTER.name
      ? NO_CHARACTER
      : book?.characters.find((c) => c.name === characterName) ?? null;
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
    const rendered = renderPrompt(pose.prompt_template, character.trigger);
    // Auto-filled the moment there is something to fill it with (console#427). The words
    // land in the editable box, so they are still read before they are used — what changes
    // is that a description already paid for is not paid for again.
    setPrompt(savedSceneRef.current ? fillScene(rendered, savedSceneRef.current) : rendered);
    setNegative(pose.negative_prompt);
    setCharLora(character.char_lora);
    setS1(String(character.strength_stage_1));
    setS2(String(character.strength_stage_2));
    setFrames(String(pose.frames));
  }, [pose, character]);

  // ---- Prefill a continuation from the segment it follows -------------------------------
  //
  // Without this the dialog opened on defaults: first character, first pose, default
  // strengths — so continuing a chain meant re-entering every choice, and forgetting one
  // changed the configuration mid-chain without saying so.
  //
  // Two effects, because the pose/character defaults effect above fires in between. The first
  // selects the same pose and character; that triggers the defaults; then the second restores
  // what actually RAN, including anything the user had overridden. The ref makes it once-only,
  // so changing the pose afterwards still resets to that pose's own defaults rather than
  // dragging the old values along.
  const prefilled = useRef(false);

  useEffect(() => {
    if (!book || prefilled.current) return;
    const r = initialFrom?.ltx_recipe;
    if (!r) return;
    setCharacterName(r.character);
    setPoseName(r.recipe);
  }, [book, initialFrom]);

  useEffect(() => {
    if (prefilled.current) return;
    const r = initialFrom?.ltx_recipe;
    if (!r || !pose || !character) return;
    // Only once the defaults for the RIGHT pose have landed, otherwise this overwrites
    // values that are about to be replaced.
    if (pose.name !== r.recipe || character.name !== r.character) return;
    prefilled.current = true;
    // The PROMPT is deliberately not carried forward (console#438). It holds the previous
    // segment's resolved scene — a description of the frame that segment STARTED from, which
    // is not the frame this one starts from. Inheriting it meant every continuation that kept
    // its pose described the wrong frame, with no placeholder left to notice or replace.
    // The pose template is re-rendered instead, and its <SCENE> is filled from the frame this
    // segment actually continues from. The cost is that hand-edits to the previous segment's
    // wording do not follow; the arc comes from the pose, clean, every time.
    if (initialFrom?.negative_prompt) setNegative(initialFrom.negative_prompt);
    if (r.char_lora) setCharLora(r.char_lora);
    if (r.char_s1 != null) setS1(String(r.char_s1));
    if (r.char_s2 != null) setS2(String(r.char_s2));
    if (r.frames != null) setFrames(String(r.frames));
  }, [initialFrom, pose, character]);

  /**
   * The frame this segment will actually start from — which is not always one that was
   * picked (console#427).
   *
   * A continuation picks nothing: the claim endpoint resolves its start image from the
   * previous segment's last frame. That left `<SCENE>` unfillable in Next Segment — the
   * button was disabled, the helper said "pick a start frame first", and the placeholder
   * always shipped to be described blind at claim time with nobody reading it. The frame
   * usually exists by then, and `initialFrom` is holding it.
   *
   * `cacheable` is about WHICH BUCKET it is in, decided by where the path came from rather
   * than by parsing it. A picked frame is a repo image and its description belongs on its
   * record; a continuation's last frame is a generated jobs-bucket image, and giving those
   * image_meta rows would leak them into the Image Repo's search.
   */
  const describePath: string | null =
    start?.kind === "uri"
      ? start.uri
      : continuing && initialFrom?.last_frame_path
        ? initialFrom.last_frame_path
        : null;

  // Whether the saved description for THIS path has been looked up yet. Distinct from
  // "there is none": one means wait, the other means describe it.
  const [sceneLookedUpFor, setSceneLookedUpFor] = useState<string | null>(null);

  useEffect(() => {
    setSavedScene(null);
    setSceneLookedUpFor(null);
    if (!describePath) return;
    let live = true;
    getImageScene(describePath)
      .then((s) => {
        if (!live) return;
        setSavedScene(s.scene_description);
        setSceneLookedUpFor(describePath);
      })
      // A failure here costs the auto-fill, not the form. The button still works and the API
      // still resolves the placeholder at claim time.
      .catch(() => {
        if (live) setSavedScene(null);
      });
    return () => {
      live = false;
    };
  }, [describePath]);

  /**
   * Describe the frame on OPEN, not on a click (console#438).
   *
   * Continuations are the case this exists for: the frame is generated, nobody has ever
   * described it, and the dialog used to offer a dead button beside a placeholder that then
   * shipped to be described blind at claim time. Now the words are on screen before the
   * segment is submitted, which is the whole point of a human being present.
   *
   * Fires once per frame and only when there is a slot to fill, so a pose with no <SCENE>
   * costs nothing and reopening the dialog costs nothing — the API kept the words.
   */
  const autoDescribed = useRef<Set<string>>(new Set());
  const needsScene = hasScenePlaceholder(prompt);
  useEffect(() => {
    if (!describePath || !needsScene) return;
    if (sceneLookedUpFor !== describePath) return;
    if (savedScene) return;
    if (autoDescribed.current.has(describePath)) return;
    autoDescribed.current.add(describePath);
    void handleDescribe();
    // handleDescribe is stable in behaviour but not in identity; the guard set is what makes
    // this once-only, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [describePath, needsScene, sceneLookedUpFor, savedScene]);

  // The description can arrive after the prompt was rendered — the fetch is async and the
  // pose effect does not wait for it. Fills only a prompt that is still UNFILLED, so a
  // description landing late can never overwrite one the user re-rolled or edited.
  useEffect(() => {
    if (!savedScene) return;
    setPrompt((p) => (hasScenePlaceholder(p) ? fillScene(p, savedScene) : p));
  }, [savedScene]);

  // An image passed in from the Image Repo. Referenced, never re-uploaded.
  useEffect(() => {
    if (!initialStartingImageUri) return;
    setStart({
      kind: "uri",
      uri: initialStartingImageUri,
      previewUrl: getFileUrl(initialStartingImageUri),
    });
  }, [initialStartingImageUri]);

  const onFile = (f: File | null) => {
    setStart((prev) => {
      // Only object URLs need revoking; a file URL is not ours to release.
      if (prev?.kind === "file") URL.revokeObjectURL(prev.previewUrl);
      return f ? { kind: "file", file: f, previewUrl: URL.createObjectURL(f) } : null;
    });
  };

  const submit = async () => {
    if (!pose || !character || !book) return;
    if (!continuing && !start) return;
    setBusy(true);
    setError(null);
    try {
      const fps = book.stack.frame_rate;
      const nFrames = Number(frames) || pose.frames;

      // The segment, identical either way. What differs is only where it is posted: a new job
      // carries it as first_segment, a continuation appends it to an existing one.
      // The markers are an editing affordance and stop here. A literal <scene> or <SCENE>
      // reaching the text encoder is garbage tokens -- the same reason the API drops an
      // unresolved placeholder rather than shipping it.
      const submittedPrompt = stripSceneMarkers(prompt).trim();

      const segment = {
        prompt: submittedPrompt,
        negative_prompt: negative.trim() || null,
        // The queue speaks seconds; LTX speaks frames. Sent both ways round so neither side
        // has to guess, and ltx_recipe.frames is authoritative.
        duration_seconds: nFrames / fps,
        speed: 1.0,
        ltx_recipe: {
          recipe: pose.name,
          character: character.name,
          trigger: character.trigger,
          char_lora: charLora,
          char_s1: Number(s1),
          char_s2: Number(s2),
          frames: nFrames,
          // Carried so the render records the CRF it actually used, and so the engine can
          // apply a pose's override. Sent as-is including 0, which is a real setting.
          img_compression: pose.img_compression,
          // The pose's content LoRAs — motion and act — chained AHEAD of the character
          // LoRA, which is identity, in the order given. Recorded rather than looked up
          // later: the recipe row can be edited afterwards, and a segment has to say
          // what it actually ran, including the ORDER, which changes the result.
          content_loras: pose.content_loras,
          // The base model this render used. Recorded because it materially changes the
          // output and because a character LoRA can fuse NOTHING against a base it was
          // not trained on — a segment has to say which one it ran against.
          checkpoint: pose.checkpoint,
          edited: [
            restoreScenePlaceholder(prompt).trim() !== renderedPrompt.trim() ? "prompt" : null,
            negative.trim() !== pose.negative_prompt.trim() ? "negative" : null,
            charLora !== character.char_lora ? "char_lora" : null,
            Number(s1) !== character.strength_stage_1 ? "char_s1" : null,
            Number(s2) !== character.strength_stage_2 ? "char_s2" : null,
          ].filter(Boolean),
        },
      };

      if (continuing) {
        // start_image stays NULL unless one was picked. The claim endpoint resolves it from
        // the previous segment's last_frame_path, which every LTX render uploads — so the
        // chain is the API's job, not this form's.
        const created = await addSegment(continueJobId!, {
          ...segment,
          start_image: start?.kind === "uri" ? start.uri : null,
        } as SegmentCreate);
        onCreated?.(created.id);
        return;
      }

      const { width, height } = await imageSize(start!.previewUrl);

      const job: JobCreate = {
        // "none — Missionary" reads as a broken template. Name it for what it is.
        name: character.name === NO_CHARACTER.name
          ? `${pose.name} (no character)`
          : `${character.name} — ${pose.name}`,
        width,
        height,
        fps,
        seed: seed.trim() === "" ? null : Number(seed),
        continuation_mode: "traditional",
        tags: initialTags || null,
        first_segment: {
          prompt: submittedPrompt,
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
            // Carried so the render records the CRF it actually used, and so the engine
            // can apply a pose's override. Sent as-is including 0, a real setting.
            img_compression: pose.img_compression,
            // The pose's content LoRAs — motion and act — chained AHEAD of the character
            // LoRA, which is identity, in the order given. Recorded rather than looked up
            // later: the recipe row can be edited afterwards, and a segment has to say
            // what it actually ran, including the ORDER, which changes the result.
            content_loras: pose.content_loras,
            // The base model this render used. Recorded because it materially changes the
            // output and because a character LoRA can fuse NOTHING against a base it was
            // not trained on — a segment has to say which one it ran against.
            checkpoint: pose.checkpoint,
            edited:
              [
                restoreScenePlaceholder(prompt).trim() !== renderedPrompt.trim() ? "prompt" : null,
                negative.trim() !== pose.negative_prompt.trim() ? "negative" : null,
                charLora !== character.char_lora ? "char_lora" : null,
                Number(s1) !== character.strength_stage_1 ? "char_s1" : null,
                Number(s2) !== character.strength_stage_2 ? "char_s2" : null,
              ].filter(Boolean),
          },
        },
      } as JobCreate;

      // One decision about how the start frame is sent, in one place. An uploaded
      // file goes as multipart; an image already in S3 is referenced by path,
      // because re-uploading it would duplicate the object.
      const form = new FormData();
      form.append(
        "data",
        JSON.stringify(
          start!.kind === "uri" ? { ...job, starting_image_uri: start!.uri } : job,
        ),
      );
      if (start!.kind === "file") form.append("starting_image", start!.file);
      const created = await createJob(form);
      setSeed(newSeed());
      onCreated?.(created.id);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  // The scene is put back to its placeholder first: filling <SCENE> is the recipe working
  // as designed, not somebody departing from it, and reading it as an edit would light this
  // up on every auto-filled render.
  const edited = pose
    ? restoreScenePlaceholder(prompt).trim() !== renderedPrompt.trim()
      || negative.trim() !== pose.negative_prompt.trim()
    : false;

  /**
   * Describe the start frame and put the words into the prompt's scene region.
   *
   * Called automatically when the dialog has a frame and a slot to fill, and by the button
   * as a re-roll. The same act either way, so the same code.
   *
   * Always through the image record, so the words are SAVED — for a repo image that means
   * the next job starting from it is free, and for a generated continuation frame it means
   * reopening this dialog is free and the CLAIM renders with the same words that were shown
   * rather than describing the frame a second time and getting different ones.
   */
  const handleDescribe = async () => {
    if (!describePath) return;
    setDescribing(true);
    setDescribeError(null);
    try {
      const { scene_description: caption } = await describeImageScene(describePath);
      if (!caption) throw new Error("the captioner returned nothing for this frame");
      setSavedScene(caption);
      // fillScene rewrites an existing region, so re-rolling replaces the words rather than
      // pasting a second description beside the first.
      setPrompt((p) => fillScene(p, caption));
    } catch (e) {
      // A MISSING FRAME IS NOT A CAPTION PROBLEM (console#440). 404 means the object the
      // previous segment points at is not in storage — the claim resolves this segment's
      // start image from that same path, so the render will fail too, not merely lose its
      // description. Saying "you can still submit" there would be false comfort.
      const missing = axios.isAxiosError(e) && e.response?.status === 404;
      setDescribeError(
        missing
          ? "The frame this segment would continue from is missing from storage, so this "
            + "segment would fail. Pick a start frame above to continue from instead."
          : ltxError(e)
            + " -- you can still submit; it will be described when the segment runs.",
      );
    } finally {
      setDescribing(false);
    }
  };

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
          {/* Render on the base model alone — no LoRA, and no trigger token in the prompt.
              Last, because it is the deliberate exception (console#412). */}
          <MenuItem value={NO_CHARACTER.name}><em>None — no character</em></MenuItem>
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
          {start
            ? "Change start frame"
            : continuing
            ? "Override start frame"
            : "Choose start frame"}
          <input hidden type="file" accept="image/*"
                 onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </Button>
        {!start && continuing && (
          <Typography variant="caption" sx={{ ml: 2 }} color="text.secondary">
            Continues from the previous segment's last frame
          </Typography>
        )}
        {start && (
          <Typography variant="caption" sx={{ ml: 2 }} color="text.secondary">
            {start.kind === "file"
              ? start.file.name
              : `${start.uri.split("/").pop()} — from the Image Repo`}
            {" — resolution derived from this image"}
          </Typography>
        )}
        {start && (
          <Box sx={{ mt: 1 }}>
            <img src={start.previewUrl} alt="start frame"
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
          {/* Offered while there is a scene at all -- unfilled OR filled. A filled region is
              still a thing to re-roll, which the old one-way paste could not express: once
              <SCENE> was gone there was nothing left to aim at. */}
          {(hasScenePlaceholder(prompt) || hasSceneRegion(prompt)) && (
            <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                onClick={handleDescribe}
                disabled={describing || !describePath}
              >
                {describing
                  ? "Describing..."
                  : hasSceneRegion(prompt)
                    ? "Re-describe frame"
                    : "Describe start frame"}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {!describePath
                  ? start
                    ? "Available once the frame is saved -- it is described automatically when the segment runs."
                    : continuing
                      ? "The previous segment has not rendered yet, so there is no frame to describe. It is described automatically when this segment runs."
                      : "Pick a start frame first."
                  : describing
                    ? continuing
                      ? "Describing the frame this segment continues from..."
                      : "Describing this frame..."
                    : hasSceneRegion(prompt)
                      ? "Re-rolls the scene and saves the new words on the frame."
                      : "Describes the frame and saves the words, so this is free next time."}
              </Typography>
            </Stack>
          )}
          {describeError && (
            <Alert
              severity={describeError.startsWith("The frame this segment") ? "error" : "warning"}
              onClose={() => setDescribeError(null)}
            >
              {describeError}
            </Alert>
          )}
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
              {/* Renders on the checkpoint alone — useful for judging what the LoRA is
                  actually contributing, and for a shot whose start frame already carries
                  the identity. The engine has always understood "none"; it simply was not
                  offered (console#412). Last in the list, because it is the deliberate
                  exception rather than a thing to land on by accident. */}
              <MenuItem value="none"><em>None — no character LoRA</em></MenuItem>
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
                  // The POSE's values, not the stack's. These were the same thing when
                  // checkpoint and content LoRA were globals; they are not any more
                  // (console#404, console#395), and a panel headed "Fixed by the recipe"
                  // showing sulphur while the pose renders on 10Eros is worse than showing
                  // nothing — it is confidently wrong at the moment of choosing.
                  //
                  // pose.* arrives already resolved: the pose's own value or the stack's.
                  ["Base model", pose.checkpoint],
                  // All of them, in the order applied — order changes the result, so a
                  // panel that showed only the first would be describing a different chain.
                  ["Content LoRAs",
                    pose.content_loras?.length
                      ? pose.content_loras.map((c) => `${c.name} @ ${c.s1}/${c.s2}`).join(", ")
                      : "none"],
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
        <Button
          variant="contained"
          onClick={submit}
          disabled={!pose || busy || (!continuing && !start)}
        >
          {busy ? "Queueing…" : continuing ? "Queue next segment" : "Queue render"}
        </Button>
        {pose && !pose.validated && (
          <Chip size="small" label="unvalidated pose" sx={{ ml: 1 }} />
        )}
      </Box>
    </Stack>
  );
}
