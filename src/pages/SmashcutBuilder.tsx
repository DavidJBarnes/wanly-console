import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert,
  Box,
  Button,
  Card,
  CardMedia,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import { Close, Favorite, FavoriteBorder } from "@mui/icons-material";
import { getSegmentClips, getFavorites, toggleFavorite, createSmashcut, getFileUrl } from "../api/client";
import type { SegmentClip } from "../api/types";

export default function SmashcutBuilder() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<SegmentClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SegmentClip[]>([]);
  const [name, setName] = useState("");
  const [transition, setTransition] = useState<"seamless" | "black">("seamless");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [rows, favs] = await Promise.all([
        getSegmentClips({ favorites_only: favoritesOnly, limit: 200 }),
        getFavorites("segment"),
      ]);
      const favSet = new Set(favs.item_refs);
      setClips(rows.map((c) => ({ ...c, favorite: favSet.has(c.id) })));
    } catch {
      setError("Failed to load clips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesOnly]);

  // Resolution lock: the first selected clip fixes the montage resolution; the rest are filtered to match.
  const lockRes = selected.length > 0 ? { w: selected[0].width, h: selected[0].height } : null;
  const selectedIds = useMemo(() => new Set(selected.map((c) => c.id)), [selected]);

  const visible = clips.filter(
    (c) => !lockRes || (c.width === lockRes.w && c.height === lockRes.h) || selectedIds.has(c.id),
  );

  const toggleSelect = (clip: SegmentClip) => {
    if (selectedIds.has(clip.id)) {
      setSelected((s) => s.filter((c) => c.id !== clip.id));
    } else {
      if (lockRes && (clip.width !== lockRes.w || clip.height !== lockRes.h)) return;
      setSelected((s) => [...s, clip]);
    }
  };

  const toggleFav = async (clip: SegmentClip, e: React.MouseEvent) => {
    e.stopPropagation();
    setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, favorite: !c.favorite } : c)));
    try {
      await toggleFavorite({ item_type: "segment", item_ref: clip.id });
    } catch {
      setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, favorite: clip.favorite } : c)));
    }
  };

  const build = async () => {
    if (selected.length < 2 || !name.trim()) return;
    setBuilding(true);
    setError(null);
    try {
      await createSmashcut({ name: name.trim(), segment_ids: selected.map((c) => c.id), transition });
      navigate("/videos");
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to build smashcut");
      setBuilding(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h5">Smashcut Builder</Typography>
        <FormControlLabel
          control={<Radio checked={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} />}
          label="Favorites only"
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pick clips in the order you want them. The first pick locks the resolution; others are filtered to match.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Selected strip */}
      {selected.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, overflowX: "auto", mb: 2, p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
          {selected.map((c, i) => (
            <Box key={c.id} sx={{ position: "relative", flexShrink: 0 }}>
              <Chip label={`${i + 1}`} size="small" sx={{ position: "absolute", top: 2, left: 2, zIndex: 1 }} />
              {c.thumbnail_path && (
                <Box component="img" src={getFileUrl(c.thumbnail_path)} sx={{ height: 72, borderRadius: 1, display: "block" }} />
              )}
              <IconButton size="small" onClick={() => toggleSelect(c)} sx={{ position: "absolute", top: 0, right: 0, bgcolor: "rgba(0,0,0,0.5)" }}>
                <Close fontSize="small" sx={{ color: "#fff" }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* Controls */}
      <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} />
        <RadioGroup row value={transition} onChange={(e) => setTransition(e.target.value as "seamless" | "black")}>
          <FormControlLabel value="seamless" control={<Radio size="small" />} label="Seamless" />
          <FormControlLabel value="black" control={<Radio size="small" />} label="Dip to black" />
        </RadioGroup>
        <Button variant="contained" disabled={selected.length < 2 || !name.trim() || building} onClick={build}>
          {building ? "Building…" : `Build (${selected.length})`}
        </Button>
      </Box>

      {/* Clip grid */}
      {loading ? (
        <CircularProgress />
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          {visible.map((c) => {
            const sel = selectedIds.has(c.id);
            return (
              <Card
                key={c.id}
                onClick={() => toggleSelect(c)}
                sx={{ width: 180, cursor: "pointer", outline: sel ? "3px solid" : "none", outlineColor: "primary.main", position: "relative" }}
              >
                {c.thumbnail_path && (
                  <CardMedia component="img" image={getFileUrl(c.thumbnail_path)} sx={{ height: 100 }} />
                )}
                <IconButton size="small" onClick={(e) => toggleFav(c, e)} sx={{ position: "absolute", top: 2, right: 2, bgcolor: "rgba(0,0,0,0.4)" }}>
                  {c.favorite ? <Favorite fontSize="small" sx={{ color: "#f48fb1" }} /> : <FavoriteBorder fontSize="small" sx={{ color: "#fff" }} />}
                </IconButton>
                <Box sx={{ px: 1, py: 0.5 }}>
                  <Typography variant="caption" noWrap display="block">{c.job_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{c.width}×{c.height} · {c.duration_seconds}s</Typography>
                </Box>
              </Card>
            );
          })}
          {visible.length === 0 && <Typography color="text.secondary">No matching clips.</Typography>}
        </Box>
      )}
    </Box>
  );
}
