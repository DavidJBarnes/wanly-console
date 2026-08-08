import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  getRunPodAvailability,
  launchRunPodWorker,
  createReservation,
  type RunPodAvailability,
} from "../api/client";

/**
 * Launch a RunPod worker.
 *
 * Availability is checked on open and shown before the button is usable, because launching
 * costs money per hour and "no 4090s right now" is a common, temporary answer — it should be
 * visible up front rather than discovered as a failure.
 *
 * The GPU and datacenter are not choices. The network volume holding the ~39GB model set is
 * region-locked, so the pod must launch beside it; and 3090 inventory there is transient, so
 * offering it would produce launches that cannot be honoured.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onLaunched: () => void;
}

export default function LaunchRunPodDialog({ open, onClose, onLaunched }: Props) {
  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<RunPodAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reservation options only appear when there is no capacity — offering them alongside a
  // working Launch button would be a choice nobody needs to make.
  const [minutes, setMinutes] = useState(30);
  const [drainAfter, setDrainAfter] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAvailability(null);
    setChecking(true);
    getRunPodAvailability()
      .then(setAvailability)
      .catch((e) => setError(detail(e) ?? "Could not check RunPod availability"))
      .finally(() => setChecking(false));
  }, [open]);

  const handleLaunch = async () => {
    setLaunching(true);
    setError(null);
    try {
      await launchRunPodWorker(name.trim());
      onLaunched();
      onClose();
      setName("");
    } catch (e) {
      // The API forwards RunPod's own wording for capacity failures — it distinguishes
      // no-stock from a bad spec better than anything we would write here.
      setError(detail(e) ?? "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const handleReserve = async () => {
    setLaunching(true);
    setError(null);
    try {
      const drain = drainAfter ? Number(drainAfter) : undefined;
      await createReservation(name.trim(), minutes, drain);
      onLaunched();
      onClose();
      setName("");
    } catch (e) {
      setError(detail(e) ?? "Could not create the reservation");
    } finally {
      setLaunching(false);
    }
  };

  const nameOk = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,48}$/.test(name.trim());
  const noCapacity = !!availability && !availability.available;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Launch RunPod worker</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {checking && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Checking availability…
              </Typography>
            </Stack>
          )}

          {availability && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color={availability.available ? "success" : "default"}
                label={availability.available ? `Available${availability.stock ? ` · ${availability.stock}` : ""}` : "No capacity"}
              />
              {availability.price_per_hr != null && (
                <Chip size="small" variant="outlined" label={`$${availability.price_per_hr}/hr`} />
              )}
              <Typography variant="caption" color="text.secondary">
                {availability.gpu_type_id.replace("NVIDIA GeForce ", "")} · {availability.datacenter_id}
              </Typography>
            </Stack>
          )}

          {noCapacity && (
            <Alert severity="info">
              No capacity right now. Availability changes minute to minute — a reservation keeps
              checking and launches the moment one frees up.
            </Alert>
          )}

          <TextField
            label="Worker name"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. runpod-1"
            helperText="Shown on this page and in the worker's logs"
            error={name.length > 0 && !nameOk}
            fullWidth
          />

          {noCapacity && (
            <>
              <TextField
                label="Keep trying for"
                size="small"
                select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                SelectProps={{ native: true }}
                fullWidth
              >
                {[15, 30, 60, 120, 240].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                  </option>
                ))}
              </TextField>

              <TextField
                label="Drain after N jobs (optional)"
                size="small"
                type="number"
                value={drainAfter}
                onChange={(e) => setDrainAfter(e.target.value)}
                placeholder="e.g. 3"
                helperText="A reservation can fire while you are away. This bounds what it costs."
                fullWidth
              />
            </>
          )}

          {!noCapacity && (
            <Typography variant="caption" color="text.secondary">
              The worker starts claiming jobs as soon as it boots. Set a drain policy from its
              card when you want it to stop.
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={launching}>
          Cancel
        </Button>
        {noCapacity ? (
          <Button variant="contained" onClick={handleReserve} disabled={launching || !nameOk}>
            {launching ? "Reserving…" : `Reserve for ${minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}`}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleLaunch}
            disabled={launching || checking || !nameOk || !availability?.available}
          >
            {launching ? "Launching…" : "Launch"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Pull the API's `detail` out of an axios error without dragging axios types in here. */
function detail(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" ? d : null;
}
