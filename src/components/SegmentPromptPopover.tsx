import { useState } from "react";
import {
  Box,
  Divider,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router";
import NotesIcon from "@mui/icons-material/Notes";
import { triggerPhrase } from "../api/ltx";
import type { LtxRecipeRef } from "../api/types";
import { recipeCharacters } from "../lib/recipeBlob";
import {
  contentLoraLine,
  editedFields,
  recipeTitle,
  shortGraphHash,
  trainingLinks,
} from "../lib/recipeDisplay";

/**
 * The prompt behind a segment, on demand.
 *
 * The timeline had no way to see it at all, and showing every prompt inline would drown the
 * table -- they run to several sentences each. So: one small button per row.
 *
 * It also shows the TEMPLATE when wildcards were resolved. That is not a detail: the <face>
 * wildcard holds four variants that fire at random on every job, and they are the deformation
 * text that costs roughly 0.13 identity. Without this there is no way to tell after the fact
 * which variant a given segment drew, so two segments of the "same" job can differ for reasons
 * invisible in the UI.
 *
 * And for recipe renders (#452), the RECORD of what the segment ran: pose, character, LoRAs
 * and the base model. The base model and content LoRAs show even when nothing was overridden
 * -- a render that looks different from last week is most often a base-model or content-LoRA
 * change, and this is the line that answers it. Whole sections stay out of the popover when
 * the segment carries no recipe (WAN-era, hologram, free-form), which is most of the time:
 * the blob is a record, not a lookup, and there is nothing to display but the record.
 */

interface Props {
  index: number;
  prompt: string;
  promptTemplate?: string | null;
  negativePrompt?: string | null;
  ltxRecipe?: LtxRecipeRef | null;
}

/** One labelled line, in the "Fixed by the recipe" accordion's format. */
function RecipeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <Typography variant="caption" sx={{ minWidth: 96 }} color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Stack>
  );
}

export default function SegmentPromptPopover({
  index,
  prompt,
  promptTemplate,
  negativePrompt,
  ltxRecipe,
}: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Only interesting when the template actually differs — the API stores it unconditionally,
  // so an equal value just means "no wildcards in this prompt".
  const resolvedFromTemplate = !!promptTemplate && promptTemplate !== prompt;

  const recipe = ltxRecipe ?? null;
  const recipeEdits = editedFields(recipe);
  const graphHash = shortGraphHash(recipe);
  // One row per person in the shot (console#473); a blob from before the list still yields
  // its one character.
  const people = recipeCharacters(recipe);
  const runLinks = Object.fromEntries(trainingLinks(recipe).map((l) => [l.name, l.href]));

  // The hash is compared against other segments', so click copies the eight characters
  // rather than the full 64, and says so for a moment after it has.
  const [hashCopied, setHashCopied] = useState(false);
  const copyHash = async (prefix: string) => {
    try {
      await navigator.clipboard.writeText(prefix);
    } catch {
      return;
    }
    setHashCopied(true);
    window.setTimeout(() => setHashCopied(false), 1500);
  };

  return (
    <>
      <Tooltip
        title={
          resolvedFromTemplate ? "Prompt (wildcards resolved)" : recipe ? "Prompt and recipe" : "Prompt"
        }
      >
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)}>
          <NotesIcon
            fontSize="small"
            // A quiet hint that this row drew from a wildcard, without opening the popover.
            color={resolvedFromTemplate ? "primary" : "inherit"}
          />
        </IconButton>
      </Tooltip>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxWidth: 560, p: 2 } } }}
      >
        <Typography variant="subtitle2" gutterBottom>
          Segment {index} prompt
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {prompt || <em>(empty)</em>}
        </Typography>

        {resolvedFromTemplate && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Template — one of the wildcard's options was chosen at random for this segment
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: "pre-wrap", color: "text.secondary", fontStyle: "italic" }}
            >
              {promptTemplate}
            </Typography>
          </>
        )}

        {negativePrompt && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Negative
            </Typography>
            <Box component={Typography} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {negativePrompt}
            </Box>
          </>
        )}

        {recipe && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Recipe — what this segment ran, as recorded when it was queued
            </Typography>
            <Typography variant="body2" gutterBottom>
              {recipeTitle(recipe)}
            </Typography>
            <Stack spacing={0.5}>
              {people.map((person, i) => {
                const link = runLinks[person.name];
                const line = `${person.char_lora} @ ${person.s1}/${person.s2}`;
                return (
                  <RecipeRow key={i} label={i === 0 ? "Character LoRA" : "Second character"}>
                    {link ? (
                      // Ties the training runs to the job view: the recorded name opens
                      // the character's runs on the LoRA Training page. The blob carries a
                      // name, not an id, so a renamed or deleted character simply lands
                      // unhighlighted.
                      <RouterLink to={link} style={{ color: "inherit", textDecorationLine: "none" }}>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ "&:hover": { textDecorationLine: "underline" } }}
                        >
                          {line}
                        </Typography>
                      </RouterLink>
                    ) : (
                      <Typography variant="caption">{line}</Typography>
                    )}
                    {person.trigger && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        trigger “{triggerPhrase(person)}”
                      </Typography>
                    )}
                  </RecipeRow>
                );
              })}

              {/* One LoRA to a line: after the second content LoRA the chain acquired names
                  long enough to wrap mid-pair inside a 560px popover. */}
              <RecipeRow label="Content LoRAs">
                {recipe.content_loras?.length ? (
                  <Stack spacing={0}>
                    {recipe.content_loras.map((lora) => (
                      <Typography key={lora.name} variant="caption">
                        {contentLoraLine(lora)}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="caption">none</Typography>
                )}
              </RecipeRow>

              <RecipeRow label="Base model">
                <Typography variant="caption">{recipe.checkpoint ?? "not recorded"}</Typography>
              </RecipeRow>

              <RecipeRow label="Frames">
                <Typography variant="caption">
                  {recipe.frames ? `${recipe.frames} frames` : "not recorded"}
                  {recipe.img_compression != null ? ` · conditioning CRF ${recipe.img_compression}` : ""}
                </Typography>
              </RecipeRow>

              {recipeEdits.length > 0 && (
                <RecipeRow label="Overrode">
                  <Typography variant="caption">{recipeEdits.join(", ")}</Typography>
                </RecipeRow>
              )}

              {graphHash && (
                <RecipeRow label="Graph hash">
                  <Tooltip title={hashCopied ? "Copied" : "Copy — to compare against another segment"}>
                    <Typography
                      component="button"
                      type="button"
                      variant="caption"
                      onClick={() => copyHash(graphHash)}
                      sx={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "monospace",
                        color: hashCopied ? "success.main" : "text.primary",
                      }}
                    >
                      {hashCopied ? "copied" : graphHash}
                    </Typography>
                  </Tooltip>
                </RecipeRow>
              )}
            </Stack>
          </>
        )}
      </Popover>
    </>
  );
}
