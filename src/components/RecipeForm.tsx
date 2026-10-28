import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CharacterAvatar from "./CharacterAvatar";
import { offeredCharacters } from "../lib/characterIcon";
import axios from "axios";
import { Link } from "react-router";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  CircularProgress, FormControlLabel, ListSubheader, MenuItem, Stack, Switch, TextField,
  Typography,
} from "@mui/material";
import { ExpandMore, Casino } from "@mui/icons-material";
import {
  listRecipes, listLoras, ltxError, renderPrompt,
  NO_CHARACTER,
  type RecipeCatalog, type Character, type Pose,
} from "../api/ltx";
import {
  addSegment, createJob, getFileUrl, getImageScene, requestImageDescribe, waitForCaptionTicket,
} from "../api/client";
import {
  fill, hasPlaceholder, restorePlaceholders, submitPrompt, wants,
} from "../lib/captionRegion";
import {
  PROMPT_TOKEN, fillEnhanced, hasEnhancedRegion, submitEnhanced, unfillEnhanced, wantsEnhanced,
  withTriggers,
} from "../lib/enhancedPrompt";
import type { JobCreate, SegmentCreate, SegmentResponse } from "../api/types";
import {
  buildLtxRecipe, jobName, recipeCharacters, slotCount, slotFor,
} from "../lib/recipeBlob";
import type { CharacterSlot } from "../lib/recipeBlob";
import { groupPosesByBook } from "../lib/poseGroups";
import { lorasForCharacter, SHOW_ALL_LORAS } from "../lib/loraOptions";
import { sceneAction, sceneInFlight } from "../lib/captionStatus";
import CaptionStatusChip from "./CaptionStatusChip";
import {
  noteCaptionTicket, refreshCaptionStatus, useCaptionStatus,
} from "../stores/captionStore";

/** A caption ticket that finished as failed; its message is the API's reason. */
class CaptionTicketFailed extends Error {}
import { seedRecipePrefill } from "../lib/recipePrefill";
import { preselectCharacter, preselectPose } from "../lib/defaultSelection";
import { guessPoseFromTags, type PoseGuess } from "../lib/poseFromTags";
import { guessCharacterFromTags, type CharacterGuess } from "../lib/characterFromTags";
import {
  draftRenderProblem, fillPhrase, hasLora, identityRefToSend, identityStatus, referenceMode,
} from "../lib/characterIdentity";

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
/**
 * The submit action, handed to whoever is drawing the frame around this form.
 *
 * The button used to live at the bottom of the form itself. In a dialog that put it above
 * the footer, with Close sitting below the thing it was not the primary action for. The
 * form still OWNS the action -- it is the only thing that knows whether a pose is chosen or
 * a render is in flight -- it just no longer decides where the button is painted.
 */
export interface RecipeFormActions {
  submit: () => void;
  busy: boolean;
  disabled: boolean;
  label: string;
}

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
  /** Receives the submit action so a dialog can render it in its own footer. MUST be stable
   *  — a plain setState suffices — or the effect that reports state will loop. */
  onActions?: (actions: RecipeFormActions) => void;
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

/** How often the dialog re-asks about a frame whose caption is running elsewhere. Captions
 *  are ~25 s a call, so faster buys nothing (same reasoning as stores/captionStore). */
const JOIN_POLL_MS = 3000;

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
  onActions,
}: RecipeFormProps) {
  const continuing = Boolean(continueJobId);
  const compact = variant === "dialog";

  const [book, setBook] = useState<RecipeCatalog | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  // Slots whose Char LoRA dropdown was asked to show every LoRA, not just that
  // character's own (console#680).
  const [allLorasAt, setAllLorasAt] = useState<number[]>([]);
  // ONE character per render (console#473, post-#102): a joint LoRA carries every
  // identity in its trigger phrase. The array shape stays (a list of one) so nothing
  // downstream has to learn a second shape.
  const [characterNames, setCharacterNames] = useState<string[]>([""]);
  const characterName = characterNames[0] ?? "";
  const setCharacterName = (name: string) =>
    setCharacterNames((prev) => [name, ...prev.slice(1)]);
  // The character picked from the start image's tags (console#696), so the picker can say
  // why it opened where it did. Only while that character is still the selection.
  const [characterGuess, setCharacterGuess] = useState<CharacterGuess | null>(null);
  // What the form opened with, for the once-only catalogue load below.
  const openedWith = useRef({ initialTags, initialFrom });
  // The pose is tracked by ID, not name: names are unique only WITHIN a book (wanly-api#320),
  // so two books can each hold "Missionary" and a name-keyed selection would silently pick
  // whichever came first.
  const [poseId, setPoseId] = useState("");
  // The pose picked from the start image's tags (console#694), kept so the picker can say
  // why it opened where it did. Only while that pose is still the selection.
  const [poseGuess, setPoseGuess] = useState<PoseGuess | null>(null);
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
  // The start frame's enhanced prompt (wanly-api#480), offered as "Use enhanced prompt".
  const [savedEnhanced, setSavedEnhanced] = useState<string | null>(null);
  // Read by the pose effect for the same reason as savedSceneRef (wanly-api#484).
  const savedEnhancedRef = useRef<string | null>(null);
  savedEnhancedRef.current = savedEnhanced;
  const savedSceneRef = useRef<string | null>(null);
  savedSceneRef.current = savedScene;

  // Pre-filled from the recipe, editable. Editing means this is no longer the
  // validated configuration — which is recorded, not prevented.
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  type SlotEdit = { charLora: string; s1: string; s2: string };
  const [slotEdits, setSlotEdits] = useState<SlotEdit[]>([]);
  const editAt = (i: number): SlotEdit => slotEdits[i] ?? { charLora: "", s1: "", s2: "" };
  const setEditAt = (i: number, patch: Partial<SlotEdit>) =>
    setSlotEdits((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push({ charLora: "", s1: "", s2: "" });
      next[i] = { ...next[i], ...patch };
      return next;
    });
  const [frames, setFrames] = useState("");

  // A DRAW, not part of the recipe: a new seed is still the validated
  // configuration. Random so repeated renders explore, overridable so a good one
  // reproduces exactly.
  const newSeed = () => String(Math.floor(Math.random() * 9007199254740991));
  const [seed, setSeed] = useState(newSeed);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Use character sheet" (console#579). On by default, like the API: a character that has
  // a sheet renders with it unless this job says otherwise. Only offered on a NEW job --
  // it is a job setting, and a continuation inherits its job's.
  const [useIdentityRef, setUseIdentityRef] = useState(true);

  useEffect(() => {
    listRecipes()
      .then((b) => {
        setBook(b);
        // The starred default, or the first (console#543). A clone's or continuation's
        // character is seeded over this by the prefill below, so it still wins.
        // With nothing starred, a fresh job opens on the character the start image is tagged
        // with (console#696). A star wins over the tags, unlike the pose's (console#694).
        const starred = b.characters.some((c) => c.is_default && !c.hidden);
        const { initialTags: tags, initialFrom: from } = openedWith.current;
        const guess = starred || from ? null : guessCharacterFromTags(tags, b.characters);
        setCharacterGuess(guess);
        setCharacterNames((prev) =>
          [preselectCharacter(prev[0] || guess?.name || "", b.characters), ...prev.slice(1)]);
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

  const lookup = (name: string): Character | null =>
    name === NO_CHARACTER.name
      ? NO_CHARACTER
      : book?.characters.find((c) => c.name === name) ?? null;
  const character: Character | null = lookup(characterName);
  // Poses are character-agnostic, so the list never changes with the character —
  // which is the point: a new LoRA gets every pose the moment it exists.
  const pose: Pose | null = poses.find((p) => p.id === poseId) ?? null;
  // ONE slot, always (post-#102).
  const nSlots = slotCount();
  const slotCharacters: (Character | null)[] = Array.from(
    { length: nSlots }, (_, i) => lookup(characterNames[i] ?? ""));
  // The slot is required to SUBMIT; an empty one must not blank the form in the
  // meantime.
  const slotsReady = slotCharacters.every((c) => c !== null);
  const filledSlots: (CharacterSlot | null)[] = slotCharacters.map((c, i) =>
    c ? { character: c, ...editAt(i) } : null);
  const slots: CharacterSlot[] = filledSlots.filter((s): s is CharacterSlot => s !== null);
  const slotKey = slotCharacters.map((c) => c?.name ?? "").join("|");
  // What this pose renders as for THESE characters — the baseline an edit is measured
  // against. An unfilled slot keeps its placeholder.
  // The trigger PHRASE, "p@yton, woman" — what the LoRA trained on (console#487). A
  // character with no trigger (sheet-only, console#581) fills its description, or nothing.
  const triggersOf = (list: (CharacterSlot | null)[]) =>
    list.map((s) => (s ? fillPhrase(s.character) : undefined)) as string[];
  const renderedPrompt =
    pose && character ? renderPrompt(pose.prompt_template, triggersOf(filledSlots)) : "";

  useEffect(() => {
    // Also where an unresolvable carried-over pose lands (see seedRecipePrefill).
    if (!book || poseId) return;
    // The image's tags beat the starred default (console#694), but only for a fresh job: a
    // clone or continuation carries the pose it ran with, which the prefill below applies.
    const guess = initialFrom ? null : guessPoseFromTags(initialTags, poses);
    setPoseGuess(guess);
    setPoseId(guess?.poseId ?? preselectPose(poseId, poses));
  }, [book, poseId, poses, initialTags, initialFrom]);

  // The prompt shown is the RENDERED one, not the template. It is editable, so
  // showing "<TRIGGER>, a woman..." would mean editing around a placeholder and
  // being unable to see what actually renders.
  useEffect(() => {
    if (!pose || !character) return;
    const rendered = renderPrompt(
      pose.prompt_template,
      slotCharacters.map((c) => (c ? fillPhrase(c) : undefined)) as string[]);
    // Auto-filled the moment there is something to fill it with (console#427). The words
    // land in the editable box, so they are still read before they are used — what changes
    // is that a description already paid for is not paid for again.
    const saved = savedSceneRef.current;
    const enhanced = savedEnhancedRef.current;
    const withScene = saved ? fill(rendered, "scene", saved) : rendered;
    setPrompt(enhanced ? fillEnhanced(withScene, enhanced) : withScene);
    setNegative(pose.negative_prompt);
    // Every filled slot starts as its character's own LoRA and strengths.
    setSlotEdits(slotCharacters.map((c) => {
      if (!c) return { charLora: "", s1: "", s2: "" };
      const d = slotFor(c);
      return { charLora: d.charLora, s1: d.s1, s2: d.s2 };
    }));
    setFrames(String(pose.frames));
    // slotKey stands in for the slot characters, which are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, slotKey]);

  // ---- Prefill a continuation from the segment it follows -------------------------------
  //
  // Without this the dialog opened on defaults: first character, first pose, default
  // strengths — so continuing a chain meant re-entering every choice, and forgetting one
  // changed the configuration mid-chain without saying so.
  //
  // Two effects, because the pose/character defaults effect above fires in between. The first
  // selects the same pose and character; that triggers the defaults; then the second restores
  // what actually RAN, including anything the user had overridden. Each is once-only, so
  // changing the pose afterwards still resets to that pose's own defaults rather than
  // dragging the old values along.
  //
  // `seeded` latches the SELECTION, not its successful resolution (console#514). The parent
  // poll rebuilds `initialFrom` every five seconds, so the effect below re-runs with equal
  // content and a new identity; without this latch it re-applied the recorded character and
  // pose over whatever the user had just chosen, about five seconds after they chose it.
  // `prefilled` still latches the second, value-restoring phase.
  const seeded = useRef(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!book) return;
    const seed = seedRecipePrefill(seeded.current, initialFrom?.ltx_recipe, poses);
    if (!seed) return;
    seeded.current = true;
    setCharacterNames(seed.characterNames);
    // An unresolvable name is deliberately NOT re-seeded on the next poll; the pose-default
    // effect drops to the first pose once. See seedRecipePrefill.
    setPoseId(seed.poseId);
  }, [book, initialFrom, poses]);

  useEffect(() => {
    if (prefilled.current) return;
    const r = initialFrom?.ltx_recipe;
    if (!r || !pose || !character) return;
    // Only once the defaults for the RIGHT pose have landed, otherwise this overwrites
    // values that are about to be replaced.
    const people = recipeCharacters(r);
    if (pose.name !== r.recipe) return;
    if (people.some((c, i) => i < nSlots && slotCharacters[i]?.name !== c.name)) return;
    prefilled.current = true;
    // The PROMPT is deliberately not carried forward (console#438). It holds the previous
    // segment's resolved scene — a description of the frame that segment STARTED from, which
    // is not the frame this one starts from. Inheriting it meant every continuation that kept
    // its pose described the wrong frame, with no placeholder left to notice or replace.
    // The pose template is re-rendered instead, and its <SCENE> is filled from the frame this
    // segment actually continues from. The cost is that hand-edits to the previous segment's
    // wording do not follow; the arc comes from the pose, clean, every time.
    if (initialFrom?.negative_prompt) setNegative(initialFrom.negative_prompt);
    // What actually RAN in each slot, including anything the user had overridden.
    people.forEach((c, i) => {
      if (i >= nSlots) return;
      setEditAt(i, {
        ...(c.char_lora ? { charLora: c.char_lora } : {}),
        ...(c.s1 != null ? { s1: String(c.s1) } : {}),
        ...(c.s2 != null ? { s2: String(c.s2) } : {}),
      });
    });
    if (r.frames != null) setFrames(String(r.frames));
    // slotKey stands in for the slot characters, which are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFrom, pose, slotKey]);

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

  // Where this frame's scene caption has got to, from the shared caption store (console#564).
  const frameScene = useCaptionStatus(describePath, "scene");

  // Whether the saved description for THIS path has been looked up yet. Distinct from
  // "there is none": one means wait, the other means describe it.
  const [sceneLookedUpFor, setSceneLookedUpFor] = useState<string | null>(null);
  // Set while the SCENE of this frame is already being captioned somewhere else -- the image
  // modal, another job's caption hold (console#562). The dialog JOINS it: waits for those
  // words to be saved and fills them in, rather than asking for a second caption that would
  // replace them with different ones. The status pill says where it has got to.
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    setSavedScene(null);
    setSavedEnhanced(null);
    setSceneLookedUpFor(null);
    setJoining(false);
    if (!describePath) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      getImageScene(describePath)
        .then((s) => {
          if (!live) return;
          // A scene in flight is not saved words yet: the words about to land are the ones
          // the modal is showing. Ask again shortly.
          const flying = sceneInFlight(s);
          setSavedEnhanced(s.enhanced_prompt ?? null);
          if (!flying) {
            setSavedScene(s.scene_description);
            setSceneLookedUpFor(describePath);
          }
          setJoining(flying);
          if (flying) timer = setTimeout(look, JOIN_POLL_MS);
        })
        // A failure here costs the auto-fill, not the form. The button still works, and a
        // submit with the placeholder still in it is held until the caption exists.
        .catch(() => {
          if (live) {
            setJoining(false);
            setSavedScene(null);
          }
        });
    };
    look();
    return () => {
      live = false;
      clearTimeout(timer);
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
   *
   * NEVER WHILE ONE IS ALREADY RUNNING (console#562). The lookup above only marks the frame
   * looked-up once no caption of it is in flight, so a frame the modal is still describing
   * is joined, not described a second time.
   */
  const autoDescribed = useRef<Set<string>>(new Set());
  const needsScene = wants(prompt, "scene") && !savedScene;
  useEffect(() => {
    if (!describePath || !needsScene) return;
    if (sceneLookedUpFor !== describePath) return;
    if (autoDescribed.current.has(describePath)) return;
    autoDescribed.current.add(describePath);
    void handleDescribe();
    // handleDescribe is stable in behaviour but not in identity; the guard set is what makes
    // this once-only, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [describePath, needsScene, sceneLookedUpFor]);

  // The description can arrive after the prompt was rendered — the fetch is async and the
  // pose effect does not wait for it. Fills only a scene that is still UNFILLED, so a
  // description landing late can never overwrite one the user re-rolled or edited.
  useEffect(() => {
    if (!savedScene) return;
    setPrompt((p) => (hasPlaceholder(p, "scene") ? fill(p, "scene", savedScene) : p));
  }, [savedScene]);

  // <PROMPT> follows the start frame (wanly-api#484): this frame's enhanced prompt goes into
  // the region (a new frame's REWRITES the last one's), and a frame without one puts the
  // placeholder back so the old frame's script never renders against a new image. It is
  // reset to null while a new frame is looked up, so a change of frame passes through the
  // placeholder and lands on the new script.
  useEffect(() => {
    setPrompt((p) => {
      if (!wantsEnhanced(p)) return p;
      if (savedEnhanced) return fillEnhanced(p, savedEnhanced);
      return hasEnhancedRegion(p) ? unfillEnhanced(p) : p;
    });
  }, [savedEnhanced]);

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
    if (!pose || !character || !book || !slotsReady) return;
    if (!continuing && !start) return;
    setBusy(true);
    setError(null);
    try {
      const fps = book.stack.frame_rate;
      const nFrames = Number(frames) || pose.frames;

      // The segment, identical either way. What differs is only where it is posted: a new job
      // carries it as first_segment, a continuation appends it to an existing one.
      // Filled regions are unwrapped to their words; an UNFILLED <SCENE> is sent as-is
      // (console#577). The API holds a segment whose placeholder has no saved words yet and
      // fills them in when the caption lands -- which is what makes queueing while the frame
      // is still being described safe. A legacy <MOTION> from an older pose is dropped
      // (wanly-api#481): nothing fills it any more.
      const submittedPrompt = submitEnhanced(submitPrompt(prompt)).trim();

      const segment = {
        prompt: submittedPrompt,
        negative_prompt: negative.trim() || null,
        // The queue speaks seconds; LTX speaks frames. Sent both ways round so neither side
        // has to guess, and ltx_recipe.frames is authoritative.
        duration_seconds: nFrames / fps,
        speed: 1.0,
        // What actually ran, recorded against the segment (console#473: one entry per
        // person, and the scalar mirror of the first). graph_sha256 is filled in by the
        // worker once the engine resolves the graph — a record of what happened, not an
        // input.
        ltx_recipe: buildLtxRecipe({
          pose, slots, negative, frames: nFrames,
          prompt: unfillEnhanced(restorePlaceholders(prompt)),
          renderedPrompt,
        }),
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
        name: jobName(pose, slots),
        width,
        height,
        fps,
        seed: seed.trim() === "" ? null : Number(seed),
        continuation_mode: "traditional",
        tags: initialTags || null,
        first_segment: segment,
        // Sent only when the character HAS a reference; otherwise the toggle means nothing.
        ...(identityRefToSend(character, useIdentityRef) !== undefined
          ? { use_identity_ref: identityRefToSend(character, useIdentityRef) } : {}),
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

  // A DRAFT character -- no LoRA, no sheet (console#592) -- cannot render, and the API would
  // refuse the submit. Said here the moment it is picked, and the submit waits for a LoRA
  // in the slot below or a sheet on the Characters page.
  const draftProblem = character && character !== NO_CHARACTER
    ? draftRenderProblem(character, filledSlots[0]?.charLora)
    : null;
  const submitDisabled = !pose || busy || (!continuing && !start) || draftProblem !== null;
  const submitLabel = busy
    ? "Queueing…"
    : continuing
      ? "Queue next segment"
      : "Queue render";

  // `submit` is a new function every render, so it is reached through a ref: putting it in
  // the dependency list below would report new actions on every render, and a parent that
  // stores them in state would then re-render forever.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const stableSubmit = useCallback(() => submitRef.current(), []);

  useEffect(() => {
    onActions?.({
      submit: stableSubmit,
      busy,
      disabled: submitDisabled,
      label: submitLabel,
    });
  }, [onActions, stableSubmit, busy, submitDisabled, submitLabel]);

  // The scene is put back to its placeholder first: filling <SCENE> is
  // the recipe working as designed, not somebody departing from it, and reading it as an
  // edit would light this up on every auto-filled render.
  const edited = pose
    ? unfillEnhanced(restorePlaceholders(prompt)).trim() !== renderedPrompt.trim()
      || negative.trim() !== pose.negative_prompt.trim()
    : false;

  // The API holds a segment whose start image it KNOWS until its captions are saved
  // (console#562), so queueing mid-describe is safe there -- as long as the placeholder
  // reaches it, which submitPrompt guarantees (console#577). A continuation that picked no
  // frame sends none -- its frame is resolved at the claim -- so it is not promised this.
  const waitsNote = start?.kind === "uri"
    ? " You can queue now -- the render waits for the words."
    : "";

  /**
   * Describe the start frame and put the words into the prompt's marked regions.
   *
   * Called automatically when the dialog has a frame and a slot to fill, and by the button
   * as a re-roll. The same act either way, so the same code.
   *
   * Always through the image record, so the words are SAVED — for a repo image that means
   * the next job starting from it is free, and for a generated continuation frame it means
   * reopening this dialog is free and the CLAIM renders with the same words that were shown
   * rather than describing the frame a second time and getting different ones.
   */
  // The describe this dialog asked for, so closing the dialog or switching frames stops
  // WAITING for it. The caption itself carries on in the API either way (console#564).
  const describeAbort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    describeAbort.current?.abort();
  }, [describePath]);

  const handleDescribe = async () => {
    if (!describePath) return;
    const path = describePath;
    describeAbort.current?.abort();
    const abort = new AbortController();
    describeAbort.current = abort;
    setDescribing(true);
    setDescribeError(null);
    try {
      // A TICKET, answered at once (console#564): the caption waits its turn in the scene
      // queue in the background, and joins one already running for this frame rather than
      // making a second. This dialog only waits for it to finish; the status pill shows
      // where it is in line meanwhile.
      const ticket = await requestImageDescribe(path, { halves: ["scene"] });
      noteCaptionTicket(ticket);
      refreshCaptionStatus();
      const done = ticket.ticket_id
        ? await waitForCaptionTicket(ticket.ticket_id, { signal: abort.signal })
        : ticket;
      if (done.status === "failed") throw new CaptionTicketFailed(done.error ?? "the caption failed");
      const saved = await getImageScene(path);
      if (abort.signal.aborted) return;
      const words = saved.scene_description;
      if (!words) throw new Error("the captioner returned no scene for this frame");
      setSavedScene(words);
      // fill rewrites an existing region, so redoing replaces the words rather than pasting
      // a second description beside the first.
      setPrompt((p) => (wants(p, "scene") ? fill(p, "scene", words) : p));
    } catch (e) {
      if (abort.signal.aborted) return;
      // A MISSING FRAME IS NOT A CAPTION PROBLEM (console#440). The object the previous
      // segment points at is not in storage -- the claim resolves this segment's start image
      // from that same path, so the render will fail too, not merely lose its description.
      // Saying "you can still submit" there would be false comfort.
      const missing = (axios.isAxiosError(e) && e.response?.status === 404)
        || (e instanceof CaptionTicketFailed && e.message.startsWith("could not read"));
      setDescribeError(
        missing
          ? "The frame this segment would continue from is missing from storage, so this "
            + "segment would fail. Pick a start frame above to continue from instead."
          : (e instanceof CaptionTicketFailed ? e.message : ltxError(e))
            + (start?.kind === "uri"
              ? " -- you can still submit; the render waits until the frame is described."
              : " -- you can still submit; it will be described when the segment runs."),
      );
    } finally {
      if (describeAbort.current === abort) {
        describeAbort.current = null;
        setDescribing(false);
      }
    }
  };

  // The describe button. Disabled -- never relabelled -- while the scene is in flight: the
  // status pill is the one indicator (console#590).
  const sceneAct = sceneAction({ scene: savedScene, sceneStatus: frameScene });

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
          helperText={
            characterGuess?.name === characterName
              ? `Picked from tag${characterGuess.matched.length > 1 ? "s" : ""}: ${characterGuess.matched.join(", ")}`
              : undefined
          }
        >
          {/* Hidden characters are not offered (console#617) -- except the one already
              picked, so a job made before it was hidden still says who it is of. */}
          {offeredCharacters(book?.characters ?? [], characterName).map((c) => (
            <MenuItem key={c.id} value={c.name}>
              <Stack direction="row" spacing={1} alignItems="center">
                <CharacterAvatar character={c} name={c.name} />
                <span>{c.name}</span>
              </Stack>
            </MenuItem>
          ))}
          {/* Render on the base model alone — no LoRA, and no trigger token in the prompt.
              Last, because it is the deliberate exception (console#412). */}
          <MenuItem value={NO_CHARACTER.name}><em>None — no character</em></MenuItem>
        </TextField>
        <TextField
          select label="Pose" value={poseId}
          sx={{ flex: "2 1 240px", minWidth: 200 }} size={compact ? "small" : "medium"}
          onChange={(e) => setPoseId(e.target.value)}
          helperText={
            poseGuess?.poseId === poseId
              ? `Picked from tag${poseGuess.matched.length > 1 ? "s" : ""}: ${poseGuess.matched.join(", ")}`
              : compact ? undefined : "Fields below are this recipe's defaults."
          }
        >
          {groupPosesByBook(poses).map(([bookName, group]) => [
            <ListSubheader key={`h-${bookName}`} disableSticky>{bookName}</ListSubheader>,
            ...group.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            )),
          ])}
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
          {/* Offered while the prompt wants the scene -- unfilled OR filled. A filled
              region is still a thing to re-roll, which the old one-way paste could not
              express: once <SCENE> was gone there was nothing left to aim at. */}
          {wants(prompt, "scene") && (
            <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
              <span title={sceneAct.why ?? undefined}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => handleDescribe()}
                  disabled={sceneAct.disabled || describing || joining || !describePath}
                >
                  {sceneAct.label === "Describe" ? "Describe start frame" : sceneAct.label}
                </Button>
              </span>
              <CaptionStatusChip path={describePath} half="scene" />
              <Typography variant="caption" color="text.secondary">
                {!describePath
                  ? start
                    ? continuing
                      ? "Available once the frame is saved -- it is described automatically when the segment runs."
                      : "Available once the frame is saved -- it is described after you queue, and the render waits for the words."
                    : continuing
                      ? "The previous segment has not rendered yet, so there is no frame to describe. It is described automatically when this segment runs."
                      : "Pick a start frame first."
                  : `Words are saved on the frame, so they are free next time.${waitsNote}`}
              </Typography>
            </Stack>
          )}
          {/* The start frame's enhanced prompt (wanly-api#480), made in the Image Repo modal.
              A button, not an auto-fill: it REPLACES the pose's prompt, so it is a choice --
              and it keeps the characters' trigger phrases in front (lib/enhancedPrompt). */}
          {savedEnhanced && !wantsEnhanced(prompt) && (
            <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setPrompt(withTriggers(triggersOf(filledSlots), savedEnhanced))}
              >
                Use enhanced prompt
              </Button>
              <Typography variant="caption" color="text.secondary">
                This frame has an enhanced prompt ({savedEnhanced.trim().split(/\s+/).length} words).
                Using it replaces the pose&apos;s prompt; the character trigger stays in front.
              </Typography>
            </Stack>
          )}
          {/* <PROMPT> (wanly-api#484): what the placeholder became, or will become. */}
          {wantsEnhanced(prompt) && (
            <Alert severity={!continuing && describePath && !hasEnhancedRegion(prompt) ? "warning" : "info"}>
              {hasEnhancedRegion(prompt)
                ? `${PROMPT_TOKEN} is filled with this frame's enhanced prompt (${(savedEnhanced ?? "").trim().split(/\s+/).length} words).`
                : continuing
                  ? `${PROMPT_TOKEN} is filled with the job's start image's enhanced prompt when this segment runs, and dropped if it has none.`
                  : describePath
                    ? `This frame has no enhanced prompt, so ${PROMPT_TOKEN} will be dropped. Use Enhance prompt on it in the Image Repo first.`
                    : `${PROMPT_TOKEN} is filled from the start frame's enhanced prompt when the segment runs, and dropped if it has none.`}
            </Alert>
          )}
          {describeError && (
            <Alert
              severity={describeError.startsWith("The frame this segment") ? "error" : "warning"}
              onClose={() => setDescribeError(null)}
            >
              {describeError}
            </Alert>
          )}
          {/* What carries the identity on this render (console#579): the LoRA, the
              character sheet, or both -- and the switch for the sheet on a new job. */}
          {draftProblem && (
            <Alert severity="warning">
              {draftProblem} Build it on the <Link to="/characters">Characters</Link> page, or
              pick a LoRA below.
            </Alert>
          )}
          {character !== NO_CHARACTER && (
            <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography
                variant="caption"
                color={!hasLora(character.char_lora) && (!referenceMode(character)
                  || (!continuing && !useIdentityRef)) ? "error" : "text.secondary"}
              >
                {identityStatus(character, continuing || useIdentityRef)}
                {continuing && referenceMode(character)
                  ? " Unless this job was created with it turned off." : ""}
              </Typography>
              {!continuing && referenceMode(character) && (
                <FormControlLabel
                  control={
                    <Switch size="small" checked={useIdentityRef}
                            onChange={(e) => setUseIdentityRef(e.target.checked)} />
                  }
                  label={<Typography variant="caption">
                    {referenceMode(character) === "face"
                      ? "Use face reference" : "Use character sheet"}
                  </Typography>}
                />
              )}
            </Stack>
          )}
          {filledSlots.map((slot, i) => {
            if (!slot) return null;
            // That character's own LoRAs first and only, unless asked for all (console#680).
            const own = allLorasAt.includes(i) ? null
              : lorasForCharacter(slot.character.name, loras, [slot.charLora]);
            const options = (own ?? loras).filter((l) => l !== slot.character.char_lora);
            return (
            <Stack key={i} direction="row" spacing={2} useFlexGap flexWrap="wrap">
              <TextField
                select label={i === 0 ? "Char LoRA" : `${slot.character.name} LoRA`}
                value={slot.charLora}
                sx={{ flex: "2 1 220px", minWidth: 180 }} size={compact ? "small" : "medium"}
                onChange={(e) => {
                  if (e.target.value === SHOW_ALL_LORAS) setAllLorasAt((a) => [...a, i]);
                  else setEditAt(i, { charLora: e.target.value });
                }}
              >
                {/* the recipe's own first, so it is never buried under the rest. A
                    sheet-only character has none (console#581) and starts on "none". */}
                {hasLora(slot.character.char_lora) && (
                  <MenuItem value={slot.character.char_lora!}>{slot.character.char_lora}</MenuItem>
                )}
                {options.map((l) => (
                  <MenuItem key={l} value={l}>{l}</MenuItem>
                ))}
                {own && (
                  <MenuItem value={SHOW_ALL_LORAS}><em>Show all {loras.length} LoRAs…</em></MenuItem>
                )}
                {/* Renders on the checkpoint alone — useful for judging what the LoRA is
                    actually contributing, and for a shot whose start frame already carries
                    the identity. The engine has always understood "none"; it simply was
                    not offered (console#412). Last in the list, because it is the
                    deliberate exception rather than a thing to land on by accident. */}
                <MenuItem value="none"><em>None — no character LoRA</em></MenuItem>
              </TextField>
              <TextField label="Stage 1" value={slot.s1} size={compact ? "small" : "medium"}
                         sx={{ flex: "1 1 100px", minWidth: 90 }}
                         onChange={(e) => setEditAt(i, { s1: e.target.value })} />
              <TextField label="Stage 2" value={slot.s2} size={compact ? "small" : "medium"}
                         sx={{ flex: "1 1 100px", minWidth: 90 }}
                         onChange={(e) => setEditAt(i, { s2: e.target.value })} />
            </Stack>
            );
          })}
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
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

      {/* No submit button here: the dialog paints it in its footer, beside Close. See
          RecipeFormActions. A form rendered without an onActions handler would have no way
          to submit, which is why the fallback below exists. */}
      {!onActions && (
        <Box>
          <Button variant="contained" onClick={submit} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
