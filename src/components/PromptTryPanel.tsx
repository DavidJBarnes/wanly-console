import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, InputAdornment, TextField, Typography,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";

import {
  getFileUrl, getImageFolder, getImageFolders, searchImages, tryCaptionPrompts,
} from "../api/client";
import type { CaptionTryResult, ImageFile } from "../api/types";
import { apiError } from "../lib/apiError";
import {
  draftMatchesSaved, draftTryBody, finderEmptyMessage, imagePathProblem, looksLikeS3Path,
  recentRepoImages,
} from "../lib/captionPrompts";
import { useSettingsStore } from "../stores/settingsStore";

const SEARCH_LIMIT = 12;
/** Long enough that typing a word is one request, short enough to feel like a search box. */
const SEARCH_DEBOUNCE_MS = 300;

type Column = { result: CaptionTryResult | null; error: string | null };
const EMPTY: Column = { result: null, error: null };

/**
 * "Try on an image" for the Settings prompt editors (console#555).
 *
 * Runs the editors' CURRENT, unsaved text on one image and shows it beside what the SAVED
 * prompts produce for the same image, so an edit can be judged before it replaces anything.
 * Nothing is stored: POST /images/scene/try never writes the image's description. Each column
 * shows the full text the captioner was sent -- for motion, the instructions WITH the style
 * sentence and grounding the API adds (console#573) -- so nothing the editor hides is hidden.
 *
 * The two runs are made one after the other rather than together. They share one captioner
 * that does one caption at a time, and the API queues them anyway; firing both at once would
 * just have the second wait inside its HTTP request, which is how requests time out. When the
 * current text resolves to the saved prompts, the second run is skipped: it would be the same
 * prompt again, and the captioner's variance between two identical runs is not a comparison.
 *
 * THE FINDER (console#573) is a search box, not a form: it searches as you type (debounced,
 * the same /images/search the Image Repo uses), and with nothing typed it shows the newest
 * repo images, so a test image can be picked without searching at all. Pasting an s3:// path
 * into it, or into the path box beside it, chooses that image directly -- which also covers a
 * generated frame in the jobs bucket.
 */
export default function PromptTryPanel({ disabledReason }: { disabledReason: string | null }) {
  const s = useSettingsStore();
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ImageFile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [running, setRunning] = useState<"draft" | "saved" | null>(null);
  const [draft, setDraft] = useState<Column>(EMPTY);
  const [saved, setSaved] = useState<Column>(EMPTY);
  const [sameAsSaved, setSameAsSaved] = useState(false);
  // The newest images, fetched once: the empty box goes back to them without asking again.
  const recent = useRef<ImageFile[] | null>(null);
  // Only the latest request may set results; an earlier, slower one must not overwrite them.
  const seq = useRef(0);

  const pathProblem = imagePathProblem(path);
  const q = query.trim();

  useEffect(() => {
    // A pasted path is not a query; onChange has already made it the image.
    if (looksLikeS3Path(q)) return;
    const mine = ++seq.current;
    const load = async () => {
      setSearching(true);
      setSearchError(null);
      try {
        let items: ImageFile[];
        if (q) {
          // Filename or description fragment, the same `q` the Image Repo's search box sends.
          items = (await searchImages({ q, limit: SEARCH_LIMIT })).items;
        } else {
          recent.current ??= await recentRepoImages(
            (await getImageFolders()).map((f) => f.name), getImageFolder, SEARCH_LIMIT);
          items = recent.current;
        }
        if (mine === seq.current) setHits(items);
      } catch (e) {
        if (mine === seq.current) {
          setHits(null);
          setSearchError(apiError(e, q ? "Search failed" : "Could not list recent images"));
        }
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    };
    // The empty box loads at once; typing waits for a pause.
    const timer = setTimeout(() => void load(), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [q]);

  const emptyMessage = finderEmptyMessage(q, hits);

  const run = async () => {
    const p = path.trim();
    const body = draftTryBody({
      captionStyle: s.captionStyle,
      captionDraft: s.captionDraft,
      captionDefault: s.captionStylePrompts[s.captionStyle] ?? "",
      motionStyle: s.motionStyle,
      motionDraft: s.motionDraft,
      motionDefault: s.motionInstructionDefault,
      motionLegacy: s.motionLegacyPrompt,
    });
    const same = draftMatchesSaved(body, {
      captionStyle: s.savedCaptionStyle,
      captionOverride: s.captionInstruction,
      motionStyle: s.savedMotionStyle,
      motionOverride: s.motionInstruction,
      motionLegacy: s.motionLegacyPrompt,
    });
    setDraft(EMPTY);
    setSaved(EMPTY);
    setSameAsSaved(same);
    setRunning("draft");
    try {
      setDraft({ result: await tryCaptionPrompts(p, body), error: null });
    } catch (e) {
      setDraft({ result: null, error: apiError(e, "The captioner did not answer") });
    }
    if (!same) {
      setRunning("saved");
      try {
        setSaved({ result: await tryCaptionPrompts(p, {}), error: null });
      } catch (e) {
        setSaved({ result: null, error: apiError(e, "The captioner did not answer") });
      }
    }
    setRunning(null);
  };

  const blocked = disabledReason ?? pathProblem;

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Try on an image
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Runs the two prompts above, as they are now, on one image, next to what the saved
          prompts produce. Nothing is saved, neither the prompts nor the description.
          Each run is two captioner calls and waits its turn behind any other captioning.
        </Typography>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", maxWidth: 900 }}>
          <TextField
            size="small"
            label="Find an image (name or description)"
            placeholder="Type to search, or pick a recent one below"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (looksLikeS3Path(e.target.value)) setPath(e.target.value.trim());
            }}
            sx={{ flex: "1 1 220px" }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            size="small"
            label="…or paste an s3:// path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            sx={{ flex: "2 1 320px" }}
          />
        </Box>
        {searchError && <Alert severity="error" sx={{ mt: 1 }}>{searchError}</Alert>}
        {!looksLikeS3Path(q) && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {q ? "Matches, newest first" : "Most recent images"} · click one to use it
            </Typography>
            {emptyMessage ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {emptyMessage}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}>
                {(hits ?? []).map((img) => (
                  <Box
                    key={img.path}
                    component="button"
                    type="button"
                    onClick={() => setPath(img.path)}
                    title={img.filename}
                    aria-label={`Use ${img.filename}`}
                    aria-pressed={img.path === path.trim()}
                    sx={{
                      p: 0, border: 2, borderRadius: 1, cursor: "pointer", background: "none",
                      borderColor: img.path === path.trim() ? "primary.main" : "transparent",
                      opacity: searching ? 0.5 : 1,
                    }}
                  >
                    <Box component="img" src={getFileUrl(img.path)} alt={img.filename}
                      loading="lazy"
                      sx={{ width: 72, height: 72, objectFit: "cover", display: "block", borderRadius: 0.5 }} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 2 }}>
          {!pathProblem && (
            <Box component="img" src={getFileUrl(path.trim())} alt=""
              sx={{ width: 96, height: 96, objectFit: "cover", borderRadius: 1 }} />
          )}
          <Box>
            <Button variant="outlined" size="small" onClick={() => void run()}
              disabled={!!blocked || running !== null}>
              {running === "draft" ? "Captioning (current text)…"
                : running === "saved" ? "Captioning (saved prompt)…" : "Try it"}
            </Button>
            {blocked && path.trim() && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {blocked}
              </Typography>
            )}
          </Box>
        </Box>

        {(draft.result || draft.error || running) && (
          <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, mt: 2 }}>
            <ResultColumn title="Current text" column={draft} busy={running === "draft"} />
            {sameAsSaved ? (
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Saved prompt</Typography>
                <Typography variant="body2" color="text.secondary">
                  The current text is the saved prompt, so there is nothing to compare it with.
                  Edit a prompt or a style and try again.
                </Typography>
              </Box>
            ) : (
              <ResultColumn title="Saved prompt" column={saved} busy={running === "saved"} />
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function ResultColumn({ title, column, busy }: { title: string; column: Column; busy: boolean }) {
  const r = column.result;
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{title}</Typography>
      {busy && <CircularProgress size={20} />}
      {column.error && <Alert severity="error">{column.error}</Alert>}
      {r && (
        <>
          <Typography variant="overline" color="text.secondary">
            Image caption · {r.words} words
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>{r.caption}</Typography>
          <Typography variant="overline" color="text.secondary">
            Motion{r.motion ? ` · ${r.motion_words} words` : ""}
          </Typography>
          {r.motion ? (
            <Typography variant="body2">{r.motion}</Typography>
          ) : r.motion_error ? (
            <Alert severity="warning">The motion half failed: {r.motion_error}</Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {r.motion_enabled ? "No motion description." : "Motion descriptions are switched off on the API."}
            </Typography>
          )}
          {/* In full, not behind a toggle: the editors show only the instructions, and this is
              where the style sentence and grounding the API adds can be seen (console#573). */}
          <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: "divider" }}>
            <Typography variant="overline" color="text.secondary">
              Sent to the captioner
            </Typography>
            <PromptText label="Caption" text={r.caption_instruction_used} />
            {r.motion_instruction_used && (
              <PromptText label="Motion" text={r.motion_instruction_used} />
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

function PromptText({ label, text }: { label: string; text: string }) {
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" component="pre"
        sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", m: 0 }}>
        {text}
      </Typography>
    </Box>
  );
}
