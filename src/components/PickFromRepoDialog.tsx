import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, List, ListItemButton, ListItemText, TextField, Typography,
} from "@mui/material";
import { ArrowBackIosNew, Search } from "@mui/icons-material";

import { getFileUrl, getImageFolder, getImageFolders, searchImages } from "../api/client";
import type { ImageFile, ImageFolder } from "../api/types";

/**
 * Pick ONE image from the Image Repo (console#579): a character's sheet or face reference.
 *
 * AddFromRepoDialog is the multi-select version for datasets. This is the same two arms --
 * open a folder, or search by filename/description -- reduced to a single choice, because a
 * character has one sheet. The image is referenced by its s3:// path; nothing is copied.
 */
const PAGE = 48;

export default function PickFromRepoDialog({
  title, onClose, onPick,
}: { title: string; onClose: () => void; onPick: (path: string) => void }) {
  const [folders, setFolders] = useState<ImageFolder[] | null>(null);
  const [openFolder, setOpenFolder] = useState<ImageFolder | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageFile[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The query a response belongs to: a slow page for "gen" must not land under "gena".
  const committed = useRef("");

  useEffect(() => {
    getImageFolders().then(setFolders).catch(() => setError("could not load the repo folders"));
  }, []);

  // The search is committed after a pause; clearing the box goes back to the folders.
  const onQuery = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) {
      committed.current = "";
      setResults(null);
      return;
    }
    debounce.current = setTimeout(() => {
      const term = q.trim();
      committed.current = term;
      setLoading(true);
      searchImages({ q: term, limit: PAGE, offset: 0 })
        .then((r) => {
          if (committed.current !== term) return;
          setResults(r.items);
          setTotal(r.total);
        })
        .catch(() => setError("could not search the repo"))
        .finally(() => setLoading(false));
    }, 300);
  };

  // console#699: the search used to stop at the first page with no sign there was more.
  // Appending rather than paging keeps every image seen so far on screen to compare.
  const showMore = () => {
    if (!results) return;
    const term = committed.current;
    setLoadingMore(true);
    searchImages({ q: term, limit: PAGE, offset: results.length })
      .then((r) => {
        if (committed.current !== term) return;
        setResults((prev) => [...(prev ?? []), ...r.items]);
        setTotal(r.total);
      })
      .catch(() => setError("could not load more results"))
      .finally(() => setLoadingMore(false));
  };

  const open = async (f: ImageFolder) => {
    setOpenFolder(f);
    setImages([]);
    setLoading(true);
    try {
      setImages(await getImageFolder(f.name));
    } catch {
      setError("could not load that folder");
    } finally {
      setLoading(false);
    }
  };

  const shown = results ?? (openFolder ? images : []);

  return (
    <Dialog open maxWidth="md" fullWidth onClose={onClose}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {openFolder && results === null && (
          <IconButton size="small" onClick={() => setOpenFolder(null)} aria-label="Back">
            <ArrowBackIosNew sx={{ fontSize: 14 }} />
          </IconButton>
        )}
        {openFolder && results === null ? `${title} — ${openFolder.name}` : title}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          size="small" fullWidth placeholder="Search by tag, filename or description…"
          value={query} onChange={(e) => onQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>
              ),
            },
          }}
        />
        {results === null && !openFolder && (
          <List dense>
            {folders === null && !error && (
              <Box sx={{ textAlign: "center", py: 3 }}><CircularProgress size={22} /></Box>
            )}
            {folders?.map((f) => (
              <ListItemButton key={f.name} onClick={() => void open(f)}>
                <ListItemText primary={f.name} />
              </ListItemButton>
            ))}
          </List>
        )}
        {loading && (
          <Box sx={{ textAlign: "center", py: 3 }}><CircularProgress size={22} /></Box>
        )}
        {!loading && shown.length > 0 && (
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", pt: 2 }}>
            {shown.map((img) => (
              <Box key={img.path} onClick={() => onPick(img.path)}
                   sx={{ width: 144, cursor: "pointer", textAlign: "center" }}>
                {/* contain, not cover: a sheet is a wide 3:2 turnaround and cropping it to a
                    square hides exactly what is being chosen. */}
                <Box component="img" loading="lazy" src={getFileUrl(img.path)} alt={img.filename}
                     sx={{ width: 144, height: 96, objectFit: "contain", borderRadius: 1,
                           bgcolor: "action.hover", display: "block" }} />
                <Typography variant="caption" color="text.secondary"
                            sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis",
                                  whiteSpace: "nowrap" }}>
                  {img.filename}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {!loading && results !== null && results.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, pt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {results.length < total
                ? `Showing ${results.length} of ${total}`
                : `${total} image${total === 1 ? "" : "s"}`}
            </Typography>
            {results.length < total && (
              <Button size="small" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            )}
          </Box>
        )}
        {!loading && (results !== null || openFolder) && shown.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", pt: 2 }}>
            {results !== null ? "No images match that search." : "That folder is empty."}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
