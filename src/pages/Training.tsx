import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Box, CircularProgress, Typography } from "@mui/material";

import { getRunHome, listDatasets } from "../api/client";

/**
 * /training is gone from the nav (wanly-console#647): training is reached through datasets,
 * each of which shows its own run history. This route stays so old links and bookmarks land
 * somewhere sensible:
 *
 *   /training?run=<id>         -> that run's dataset page, the run scrolled to
 *   /training?character=<name> -> the character's living dataset (a pair's composition set);
 *                                 the recipe popovers and character cards link this way
 *   /training                  -> the Datasets grid
 */
export default function Training() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const run = searchParams.get("run");
  const character = searchParams.get("character");

  useEffect(() => {
    let live = true;
    const go = (to: string) => { if (live) navigate(to, { replace: true }); };
    if (run) {
      getRunHome(run)
        .then((id) => go(id ? `/datasets/${id}?run=${run}` : "/datasets"))
        .catch(() => go("/datasets"));
    } else if (character) {
      listDatasets()
        .then((sets) => {
          const own = sets.find((d) => d.character === character
            && (d.kind === "character" || d.kind === "composition"));
          go(own ? `/datasets/${own.id}` : "/datasets");
        })
        .catch(() => go("/datasets"));
    } else {
      go("/datasets");
    }
    return () => { live = false; };
  }, [run, character, navigate]);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <CircularProgress size={20} />
      <Typography variant="body2" color="text.secondary">
        LoRA training lives on each dataset now — taking you there…
      </Typography>
    </Box>
  );
}
