import { useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert, Box, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import { ViewInAr } from "@mui/icons-material";
import { getFileUrl, listFaceLoops } from "../api/client";
import type { FaceLoop } from "../api/types";
import { loopFile, loopVersion } from "../lib/faceLoops";
import { useFaceAr } from "../lib/useFaceAr";
import type { FaceAr } from "../lib/useFaceAr";
import { HAIR_MODE_LABEL, HAIR_MODES } from "../lib/faceHair";

/**
 * Face Loops (console#749): every character's ready loops. On the Quest, one tap wears the
 * loop on the face in front of you; in a desktop browser a tap plays the preview. Loops are
 * made on a character's Face loops tab.
 */
export default function FaceLoops() {
  const [loops, setLoops] = useState<FaceLoop[] | null>(null);
  const [error, setError] = useState("");
  const ar = useFaceAr();

  useEffect(() => {
    listFaceLoops("ready").then(setLoops, () => setError("Could not load the face loops."));
  }, []);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>Face Loops</Typography>
        <ToggleButtonGroup size="small" exclusive value={ar.mode} onChange={(_, m) => m && ar.setMode(m)}>
          {HAIR_MODES.map((m) => (
            <ToggleButton key={m} value={m}>{HAIR_MODE_LABEL[m]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ArStatus ar={ar} />
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {ar.error && <Alert severity="warning" sx={{ mb: 2 }}>AR: {ar.error}</Alert>}
      {loops === null && !error && <CircularProgress />}
      {loops?.length === 0 && (
        <Typography color="text.secondary">
          No face loops yet. Make one on a character's page, <RouterLink to="/characters">Characters</RouterLink> →
          Face loops.
        </Typography>
      )}
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {loops?.map((l) => <LoopTile key={l.id} loop={l} ar={ar} />)}
      </Box>
    </Box>
  );
}

export function ArStatus({ ar }: { ar: FaceAr }) {
  if (ar.supported === false) {
    return <Chip size="small" variant="outlined" label="Open on the Quest to wear a face" />;
  }
  if (ar.supported === null || ar.state === "starting" || ar.state === "idle") {
    return <Chip size="small" icon={<CircularProgress size={12} />} label="Starting the cameras…" />;
  }
  if (ar.state === "failed") return <Chip size="small" color="error" label="Cameras unavailable" />;
  return <Chip size="small" color="success" icon={<ViewInAr />} label="Tap a face to wear it" />;
}

function LoopTile({ loop, ar }: { loop: FaceLoop; ar: FaceAr }) {
  const video = useRef<HTMLVideoElement>(null);
  const clip = loopFile(loop, "loop.mp4");
  const poster = loopFile(loop, "poster.jpg");
  const tap = () => {
    if (ar.supported) {
      ar.launch(loop);
      return;
    }
    const v = video.current;
    if (v) void (v.paused ? v.play().catch(() => {}) : v.pause());
  };
  return (
    <Card variant="outlined">
      <CardActionArea onClick={tap} disabled={ar.inSession}>
        <Box sx={{ aspectRatio: "1 / 1", bgcolor: "action.hover" }}>
          {clip && (
            <video ref={video} src={getFileUrl(clip, loopVersion(loop))} poster={poster ? getFileUrl(poster, loopVersion(loop)) : undefined}
              muted loop playsInline preload="none" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          )}
        </Box>
        <CardContent sx={{ py: 1 }}>
          <Typography variant="subtitle2" noWrap title={loop.label}>{loop.label}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">{loop.character}</Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
