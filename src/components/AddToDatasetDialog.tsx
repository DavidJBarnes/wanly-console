import { useEffect, useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton,
  ListItemText, Stack, TextField, Typography,
} from "@mui/material";

import { createDataset, listDatasets, updateDataset } from "../api/client";
import { byRecent, datasetNameProblem } from "../lib/datasets";
import type { Dataset } from "../api/types";

/**
 * Put images from the repo into a dataset (#464).
 *
 * The only link from the Image Repo to training, and it runs one way: pick an existing
 * dataset or name a new one, the images join it, and training happens from the dataset.
 * The objects stay where they are in the bucket; a dataset is a list, not a folder.
 */
export default function AddToDatasetDialog({
  imageUris, onClose, onAdded,
}: { imageUris: string[]; onClose: () => void; onAdded: (ds: Dataset) => void }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listDatasets().then((d) => setDatasets(d.sort(byRecent))).catch(() => {});
  }, []);

  const addTo = async (ds: Dataset) => {
    setBusy(true);
    setError("");
    try {
      const merged = [...ds.images, ...imageUris.filter((u) => !ds.images.includes(u))];
      const updated = await updateDataset(ds.id, { images: merged });
      onAdded(updated);
      onClose();
    } catch {
      setError("could not add them");
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    setBusy(true);
    setError("");
    try {
      const ds = await createDataset({ name: newName.trim() });
      await addTo(ds);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "could not create it");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add {imageUris.length} image{imageUris.length === 1 ? "" : "s"} to a dataset</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        <List dense>
          {datasets.map((ds) => (
            <ListItemButton key={ds.id} disabled={busy} onClick={() => addTo(ds)}>
              <ListItemText primary={ds.name} secondary={`${ds.images.length} images`} />
            </ListItemButton>
          ))}
        </List>
        <Stack direction="row" spacing={1} sx={{ p: 2, alignItems: "flex-start" }}>
          <TextField
            size="small"
            label={datasets.length ? "Or a new dataset" : "New dataset"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !datasetNameProblem(newName)) createAndAdd(); }}
            error={newName !== "" && datasetNameProblem(newName) !== null}
            helperText={newName !== "" ? datasetNameProblem(newName) ?? " " : " "}
            fullWidth
          />
          <Button
            variant="contained"
            disabled={busy || datasetNameProblem(newName) !== null}
            onClick={createAndAdd}
            sx={{ whiteSpace: "nowrap" }}
          >
            Create
          </Button>
        </Stack>
        {datasets.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 2, display: "block" }}>
            No datasets yet.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
