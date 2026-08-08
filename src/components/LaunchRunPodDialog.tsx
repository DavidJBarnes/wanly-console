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
  getRunPodGpuOptions,
  launchRunPodWorker,
  createReservation,
  type RunPodGpuOption,
} from "../api/client";

/**
 * Launch a RunPod worker.
 *
 * Price and stock are fetched per GPU on open, because launching costs money per hour and that
 * should be visible before the button is, not after.
 *
 * The GPU IS a choice, and has to be. Community 4090s are frequently unplaceable — RunPod
 * matches a host and answers "this machine does not have the resources", a fit failure rather
 * than an empty fleet — while a 3090 places immediately at roughly two thirds the price. With no
 * choice offered, that state is a dead end.
 *
 * Launch is NOT gated on `available`. That flag means "RunPod prices this GPU here", which is a
 * weaker claim than "a pod can be placed": community 4090 read available/"Low" continuously
 * through an hour of failed creates. Gating on it would block launches that would have worked,
 * and — worse — a green flag never made a doomed one succeed. The launch attempt itself is the
 * only honest test, and its error message is far more specific than anything shown up front.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onLaunched: () => void;
}

export default function LaunchRunPodDialog({ open, onClose, onLaunched }: Props) {
  const [name, setName] = useState("");
  const [gpus, setGpus] = useState<RunPodGpuOption[]>([]);
  const [gpu, setGpu] = useState<string>("");
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
    setGpus([]);
    setChecking(true);
    getRunPodGpuOptions()
      .then((options) => {
        setGpus(options);
        // Prefer a GPU that is actually priced; fall back to the server default. Opening on an
        // option we already know is unsellable would make the first click a guaranteed failure.
        const priced = options.find((o) => o.available);
        const fallback = options.find((o) => o.is_default) ?? options[0];
        setGpu((priced ?? fallback)?.gpu_type_id ?? "");
      })
      .catch((e) => setError(detail(e) ?? "Could not check RunPod availability"))
      .finally(() => setChecking(false));
  }, [open]);

  const handleLaunch = async () => {
    setLaunching(true);
    setError(null);
    try {
      await launchRunPodWorker(name.trim(), gpu || undefined);
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
      await createReservation(name.trim(), minutes, drain, gpu || undefined);
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
  const selected = gpus.find((g) => g.gpu_type_id === gpu) ?? null;
  // Only "RunPod does not sell this GPU here" switches the dialog to reserve-instead. A priced
  // GPU always gets a real launch attempt, because pricing does not predict placement.
  const noCapacity = !!selected && !selected.available;

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

          {gpus.length > 0 && (
            <TextField
              label="GPU"
              size="small"
              select
              value={gpu}
              onChange={(e) => setGpu(e.target.value)}
              SelectProps={{ native: true }}
              helperText="Price and stock are live. Stock is a band, not a guarantee of placement."
              fullWidth
            >
              {gpus.map((g) => (
                <option key={g.gpu_type_id} value={g.gpu_type_id}>
                  {short(g.gpu_type_id)}
                  {g.price_per_hr != null ? ` — $${g.price_per_hr}/hr` : ""}
                  {g.stock ? ` · ${g.stock}` : g.available ? "" : " · not sold here"}
                </option>
              ))}
            </TextField>
          )}

          {selected && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color={selected.available ? "success" : "default"}
                label={
                  selected.available
                    ? `Priced${selected.stock ? ` · ${selected.stock}` : ""}`
                    : "Not sold here"
                }
              />
              {selected.price_per_hr != null && (
                <Chip size="small" variant="outlined" label={`$${selected.price_per_hr}/hr`} />
              )}
              {selected.error && (
                <Typography variant="caption" color="warning.main">
                  price lookup failed
                </Typography>
              )}
            </Stack>
          )}

          {selected?.available && (
            <Alert severity="info" sx={{ py: 0 }}>
              Stock is a price band, not a promise. In-demand GPUs can be priced here and still
              refuse to place — if that happens, the error says so and another GPU usually works.
            </Alert>
          )}

          {noCapacity && (
            <Alert severity="warning">
              RunPod is not quoting a price for this GPU right now. That usually means no stock —
              but it is not reliable: a 3090 pod placed on the first attempt minutes after this
              same check reported nothing. Launching anyway is worth a try; a reservation keeps
              retrying if you would rather walk away.
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
        {noCapacity && (
          <Button onClick={handleReserve} disabled={launching || !nameOk}>
            {launching ? "Reserving…" : `Reserve for ${minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}`}
          </Button>
        )}
        {/* Launch is ALWAYS offered. Pricing predicts placement in neither direction: measured
            2026-08-08, community 4090 read priced/"Low" through an hour of failures, and minutes
            after a 3090 pod placed on the first try the 3090 reported no price at all. Disabling
            the button on that flag blocked launches that would have worked. */}
        <Button
          variant="contained"
          onClick={handleLaunch}
          disabled={launching || checking || !nameOk || !gpu}
        >
          {launching ? "Launching…" : noCapacity ? "Launch anyway" : "Launch"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** RunPod's own ids are long and repetitive in a dropdown. */
function short(gpuTypeId: string): string {
  return gpuTypeId.replace("NVIDIA GeForce ", "").replace("NVIDIA ", "");
}

/** Pull the API's `detail` out of an axios error without dragging axios types in here. */
function detail(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" ? d : null;
}
