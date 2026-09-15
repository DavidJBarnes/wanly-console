import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, List, ListItemButton, ListItemText, TablePagination, TextField,
  Typography,
} from "@mui/material";
import {
  ArrowBackIosNew as ArrowBackIosNewIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

import {
  getFileUrl, getImageFolder, getImageFolders, getImageTagCounts, searchImages, updateDataset,
} from "../api/client";
import { mergeIntoSet } from "../lib/datasets";
import { clampPage, repoBrowseMode } from "../lib/repoBrowse";
import { hasFilter, toggleTag } from "../lib/tagFilter";
import type { Dataset, ImageFile, ImageFolder, TagCount } from "../api/types";
import TagFilterBar from "./TagFilterBar";

const ROWS_OPTIONS = [24, 48, 96];
const DEFAULT_ROWS = 24;

/**
 * Pull images into a dataset from the existing Image Repo (#489).
 *
 * The workflow lived where the images are: the only path into a dataset from the repo ran
 * from the Image Repo page's select mode, and someone standing on the Datasets page had no
 * path at all — "Add images" opens the local file picker. This is the other direction:
 * browse the repo's folders, pick images, they join the set. The set's own order is kept;
 * new images append, duplicates are dropped. Nothing is copied — a dataset is a list of
 * s3:// URIs, so the objects stay where they are in the bucket.
 *
 * #506 added the second arm. Folders are fine when you know which folder a face is in, but the
 * repo is tagged, and "the Kelly faces" span folders and number in the hundreds — so the dialog
 * now carries the same tag pills, filename search and pagination the Image Repo page does,
 * fed by the same /images/search and /images/tag-counts endpoints. Selection is shared across
 * both arms and across pages: the set is what gets appended, not the current screen.
 */
export default function AddFromRepoDialog({
  ds, onClose, onAdded,
}: { ds: Dataset; onClose: () => void; onAdded: (updated: Dataset) => void }) {
  const [folders, setFolders] = useState<ImageFolder[] | null>(null);
  const [openFolder, setOpenFolder] = useState<ImageFolder | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);

  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [results, setResults] = useState<ImageFile[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filterActive = hasFilter(committedQuery, selectedTags);
  const mode = repoBrowseMode(openFolder !== null, filterActive);

  useEffect(() => {
    if (openFolder) return;
    getImageFolders()
      .then(setFolders)
      .catch(() => setError("could not load the repo folders"));
  }, [openFolder]);

  // Counts are scoped to the current tag filter, same as the Image Repo page: with Kelly
  // selected the pills left standing are the ones that actually co-occur, so a dead end is
  // visible before it is clicked.
  useEffect(() => {
    getImageTagCounts({ tags: selectedTags.length ? selectedTags : undefined })
      .then(setTagCounts)
      .catch(() => { /* pills are a convenience; a failure must not block browsing */ });
  }, [selectedTags]);

  // Commit the filename box after a pause, and snap back to page 1 — a new filter's results
  // have nothing to do with the page you were on.
  useEffect(() => {
    if (searchQuery === committedQuery) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCommittedQuery(searchQuery);
      setPage(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, committedQuery]);

  useEffect(() => {
    if (!filterActive) {
      setResults([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchImages({
      q: committedQuery || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
      limit: rowsPerPage,
      offset: page * rowsPerPage,
    })
      .then((res) => {
        if (cancelled) return;
        setResults(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) setError("could not search the repo");
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => { cancelled = true; };
  }, [filterActive, committedQuery, selectedTags, page, rowsPerPage]);

  // A tag click narrows the set while the page may be past the end; clamp rather than strand
  // the user on an empty page they cannot page away from.
  useEffect(() => {
    if (!filterActive) return;
    const next = clampPage(page, total, rowsPerPage);
    if (next !== page) setPage(next);
  }, [filterActive, page, total, rowsPerPage]);

  const openImages = async (folder: ImageFolder) => {
    setOpenFolder(folder);
    setImages([]);
    setSelected(new Set());
    setError("");
    setLoadingImages(true);
    try {
      setImages(await getImageFolder(folder.name));
    } catch {
      setError("could not load that folder");
    } finally {
      setLoadingImages(false);
    }
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const merged = mergeIntoSet(ds.images, Array.from(selected));
      const updated = await updateDataset(ds.id, { images: merged });
      onAdded(updated);
      onClose();
    } catch {
      setError("could not add them");
    } finally {
      setBusy(false);
    }
  };

  const alreadyIn = (path: string) => ds.images.includes(path);

  const shown = mode === "search" ? results : images;
  const loading = mode === "search" ? searching : loadingImages;

  return (
    <Dialog open maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {openFolder && (
          <IconButton size="small" disabled={busy} onClick={() => setOpenFolder(null)} aria-label="Back">
            <ArrowBackIosNewIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
        {openFolder
          ? `Add from ${openFolder.name}`
          : "Add from the Image Repo"}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!openFolder && (
          <TextField
            size="small"
            fullWidth
            placeholder="Search by filename or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}

        {!openFolder && (
          <Box sx={{ mt: 2 }}>
            <TagFilterBar
              counts={tagCounts}
              selected={selectedTags}
              onToggle={(tag) => { setSelectedTags(toggleTag(selectedTags, tag)); setPage(0); }}
              onClear={() => { setSelectedTags([]); setPage(0); }}
            />
          </Box>
        )}

        {mode === "folders" && (
          <>
            {folders === null && !error && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            <List dense>
              {folders?.map((f) => (
                <ListItemButton key={f.name} onClick={() => openImages(f)}>
                  <ListItemText primary={f.name} />
                </ListItemButton>
              ))}
            </List>
            {folders !== null && folders.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", pb: 2 }}>
                The Image Repo has no folders yet.
              </Typography>
            )}
          </>
        )}

        {loading && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        )}

        {/* Thumbnails, not file names (console#492): selecting a face from a name is
            selecting blind. Big enough to tap on a phone, which is where this dialog
            gets used. A name under each thumbnail — thumb covers the image, the name
            disambiguates two shots of the same scene. */}
        {!loading && shown.length > 0 && (
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", pt: 2 }}>
            {shown.map((img) => {
              const inSet = alreadyIn(img.path);
              const picked = selected.has(img.path);
              return (
                <Box
                  key={img.path}
                  onClick={inSet || busy ? undefined : () => toggle(img.path)}
                  sx={{
                    width: 96, cursor: inSet || busy ? "default" : "pointer",
                    textAlign: "center",
                  }}
                >
                  <Box
                    component="img"
                    src={getFileUrl(img.path)}
                    sx={{
                      width: 96, height: 96, objectFit: "cover", borderRadius: 1,
                      display: "block", border: "3px solid",
                      borderColor: inSet ? "divider" : picked ? "secondary.main" : "transparent",
                      opacity: inSet ? 0.4 : picked ? 1 : 0.75,
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block", overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", mt: 0.25,
                      color: inSet ? "text.disabled" : picked ? "secondary.main" : "text.secondary",
                    }}
                  >
                    {inSet ? "in dataset" : img.filename}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}

        {!loading && mode === "folder" && images.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", pb: 2 }}>
            That folder is empty.
          </Typography>
        )}
        {!loading && mode === "search" && results.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", pt: 2 }}>
            No images match that filter.
          </Typography>
        )}

        {mode === "search" && total > rowsPerPage && (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={ROWS_OPTIONS}
            sx={{ mt: 1 }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {selected.size > 0 ? `${selected.size} selected` : ""}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="contained"
            disabled={selected.size === 0 || busy}
            onClick={add}
          >
            {busy ? "Adding…" : `Add ${selected.size || ""}${selected.size === 1 ? " image" : selected.size > 1 ? " images" : ""}`}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
