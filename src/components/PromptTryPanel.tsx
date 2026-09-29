import { useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, IconButton, InputAdornment,
  TextField, Typography,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";

import { getFileUrl, searchImages, tryCaptionPrompts } from "../api/client";
import type { CaptionTryResult, ImageFile } from "../api/types";
import { apiError } from "../lib/apiError";
import { draftMatchesSaved, draftTryBody, imagePathProblem } from "../lib/captionPrompts";
import { useSettingsStore } from "../stores/settingsStore";

const SEARCH_LIMIT = 12;

type Column = { result: CaptionTryResult | null; error: string | null };
const EMPTY: Column = { result: null, error: null };

/**
 * "Try on an image" for the Settings prompt editors (console#555).
 *
 * Runs the editors' CURRENT, unsaved text on one image and shows it beside what the SAVED
 * prompts produce for the same image, so an edit can be judged before it replaces anything.
 * Nothing is stored: POST /images/scene/try never writes the image's description.
 *
 * The two runs are made one after the other rather than together. They share one captioner
 * that does one caption at a time, and the API queues them anyway; firing both at once would
 * just have the second wait inside its HTTP request, which is how requests time out. When the
 * current text resolves to the saved prompts, the second run is skipped: it would be the same
 * prompt again, and the captioner's variance between two identical runs is not a comparison.
 *
 * The image is chosen from the repo by filename or description (the same /images/search the
 * Image Repo uses), or by pasting an s3:// path, which also covers a generated frame in the jobs bucket.
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

  const pathProblem = imagePathProblem(path);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      // Filename or description fragment, the same `q` the Image Repo's search box sends.
      const r = await searchImages({ q, limit: SEARCH_LIMIT });
      setHits(r.items);
    } catch (e) {
      setSearchError(apiError(e, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  const run = async () => {
    const p = path.trim();
    const body = draftTryBody({
      captionStyle: s.captionStyle,
      captionDraft: s.captionDraft,
      captionDefault: s.captionStylePrompts[s.captionStyle] ?? "",
      motionStyle: s.motionStyle,
      motionDraft: s.motionDraft,
      motionDefault: s.motionTemplateDefault,
    });
    const same = draftMatchesSaved(body, {
      captionStyle: s.savedCaptionStyle,
      captionOverride: s.captionInstruction,
      motionStyle: s.savedMotionStyle,
      motionOverride: s.motionInstruction,
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            sx={{ flex: "1 1 220px" }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => void search()}
                      disabled={!query.trim() || searching} aria-label="Search images">
                      {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                    </IconButton>
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
        {hits && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
            {hits.length === 0 && (
              <Typography variant="body2" color="text.secondary">No images match.</Typography>
            )}
            {hits.map((img) => (
              <Box
                key={img.path}
                component="button"
                type="button"
                onClick={() => setPath(img.path)}
                title={img.filename}
                sx={{
                  p: 0, border: 2, borderRadius: 1, cursor: "pointer", background: "none",
                  borderColor: img.path === path.trim() ? "primary.main" : "transparent",
                }}
              >
                <Box component="img" src={getFileUrl(img.path)} alt={img.filename}
                  loading="lazy"
                  sx={{ width: 72, height: 72, objectFit: "cover", display: "block", borderRadius: 0.5 }} />
              </Box>
            ))}
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
          <Box component="details" sx={{ mt: 1 }}>
            <Typography component="summary" variant="caption" sx={{ cursor: "pointer" }}>
              Exactly what was sent
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
