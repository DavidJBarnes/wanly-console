import { useEffect, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItemButton, ListItemText, Typography,
} from "@mui/material";
import { ArrowBackIosNew as ArrowBackIosNewIcon } from "@mui/icons-material";

import { getFileUrl, getImageFolder, getImageFolders, updateDataset } from "../api/client";
import { mergeIntoSet } from "../lib/datasets";
import type { Dataset, ImageFile, ImageFolder } from "../api/types";

/**
 * Pull images into a dataset from the existing Image Repo (#489).
 *
 * The workflow lived where the images are: the only path into a dataset from the repo ran
 * from the Image Repo page's select mode, and someone standing on the Datasets page had no
 * path at all — "Add images" opens the local file picker. This is the other direction:
 * browse the repo's folders, pick images, they join the set. The set's own order is kept;
 * new images append, duplicates are dropped. Nothing is copied — a dataset is a list of
 * s3:// URIs, so the objects stay where they are in the bucket.
 */
export default function AddFromRepoDialog({
  ds, onClose, onAdded,
}: { ds: Dataset; onClose: () => void; onAdded: (updated: Dataset) => void }) {
  const [folders, setFolders] = useState<ImageFolder[] | null>(null);
  const [openFolder, setOpenFolder] = useState<ImageFolder | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (openFolder) return;
    getImageFolders()
      .then(setFolders)
      .catch(() => setError("could not load the repo folders"));
  }, [openFolder]);

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

  return (
    <Dialog open maxWidth="xs" fullWidth>
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
      <DialogContent dividers sx={{ p: 0 }}>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {!openFolder && (
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
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 2, display: "block" }}>
                The Image Repo has no folders yet.
              </Typography>
            )}
          </>
        )}
        {openFolder && (
          <>
            {loadingImages && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            {/* Thumbnails, not file names (console#492): selecting a face from a name is
                selecting blind. Big enough to tap on a phone, which is where this dialog
                gets used. A name under each thumbnail — thumb covers the image, the name
                disambiguates two shots of the same scene. */}
            {!loadingImages && images.length > 0 && (
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", p: 2 }}>
                {images.map((img) => {
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
            {!loadingImages && images.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 2, display: "block" }}>
                That folder is empty.
              </Typography>
            )}
          </>
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
