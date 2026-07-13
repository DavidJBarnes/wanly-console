import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import { Star } from "@mui/icons-material";
import { getJobs, getFileUrl, createVideoPreset } from "../api/client";
import StatusChip from "../components/StatusChip";
import SettingsSignature from "../components/SettingsSignature";
import type { JobResponse, JobLoraSummary } from "../api/types";

function loraLabel(l: JobLoraSummary): string {
  const raw = l.name || l.high_file || l.low_file || l.lora_id || "lora";
  return raw.replace(/\.safetensors$/i, "");
}

function ConfigChip({ label, value }: { label: string; value: string | number }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={
        <span>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {label}
          </Box>{" "}
          {value}
        </span>
      }
    />
  );
}

export default function SuccessfulConfigs() {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetFromJob, setPresetFromJob] = useState<JobResponse | null>(null);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetDone, setPresetDone] = useState(false);

  const handleMakePreset = async () => {
    if (!presetFromJob || !presetName.trim()) {
      setPresetError("Name is required");
      return;
    }
    setSavingPreset(true);
    setPresetError(null);
    const j = presetFromJob;
    try {
      await createVideoPreset({
        name: presetName.trim(),
        lightx2v_strength_high: j.lightx2v_strength_high,
        lightx2v_strength_low: j.lightx2v_strength_low,
        cfg_high: j.cfg_high,
        cfg_low: j.cfg_low,
        steps_total: j.steps_total,
        high_noise_steps: j.high_noise_steps,
        flow_shift: j.flow_shift,
        loras: j.loras
          .filter((l) => l.lora_id)
          .map((l) => ({
            lora_id: l.lora_id as string,
            high_weight: l.high_weight ?? 1,
            low_weight: l.low_weight ?? 1,
          })),
      });
      setPresetDone(true);
      setTimeout(() => {
        setPresetFromJob(null);
        setPresetDone(false);
      }, 900);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPresetError(detail || (e instanceof Error ? e.message : "Failed to create preset"));
    } finally {
      setSavingPreset(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    getJobs({ starred: true, limit: 200 })
      .then((res) => {
        if (active) setJobs(res.items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
        <Star color="warning" />
        <Typography variant="h5">Successful Configs</Typography>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : jobs.length === 0 ? (
        <Typography color="text.secondary">
          No configs flagged yet. Open a job whose result you liked and tap the star in its top card.
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
            gap: 2,
          }}
        >
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardActionArea component={RouterLink} to={`/jobs/${job.id}`}>
                <Box sx={{ display: "flex" }}>
                  {job.starting_image && (
                    <Box
                      component="img"
                      src={getFileUrl(job.starting_image)}
                      alt={job.name}
                      sx={{
                        width: 96,
                        height: 96,
                        objectFit: "cover",
                        flexShrink: 0,
                        bgcolor: "action.hover",
                      }}
                    />
                  )}
                  <CardContent sx={{ py: 1.5, flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography
                        variant="subtitle2"
                        noWrap
                        sx={{ flex: 1, minWidth: 0 }}
                        title={job.name}
                      >
                        {job.name}
                      </Typography>
                      <StatusChip status={job.status} />
                    </Stack>
                    <Box sx={{ mb: 0.75 }}>
                      <SettingsSignature values={job} />
                    </Box>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <ConfigChip label="" value={`${job.width}x${job.height}`} />
                    </Box>
                    {job.loras.length > 0 && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}>
                        {job.loras.map((l, i) => (
                          <Chip
                            key={i}
                            size="small"
                            color="secondary"
                            variant="outlined"
                            label={
                              <span>
                                {loraLabel(l)}{" "}
                                <Box component="span" sx={{ color: "text.secondary" }}>
                                  hi {l.high_weight ?? 0} · lo {l.low_weight ?? 0}
                                </Box>
                              </span>
                            }
                          />
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Box>
              </CardActionArea>
              <Box sx={{ px: 1.5, pb: 1 }}>
                <Button
                  size="small"
                  startIcon={<Star fontSize="small" />}
                  onClick={() => {
                    setPresetFromJob(job);
                    setPresetName(job.name);
                    setPresetError(null);
                    setPresetDone(false);
                  }}
                >
                  Make preset from this config
                </Button>
              </Box>
            </Card>
          ))}
        </Box>
      )}

      <Dialog
        open={!!presetFromJob}
        onClose={() => !savingPreset && setPresetFromJob(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Make preset from config</DialogTitle>
        <DialogContent>
          {presetError && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>{presetError}</Typography>
          )}
          {presetDone ? (
            <Typography color="success.main">Preset created ✓</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Captures this config's sampler settings
                {presetFromJob && presetFromJob.loras.length > 0
                  ? ` + ${presetFromJob.loras.length} LoRA${presetFromJob.loras.length > 1 ? "s" : ""}`
                  : ""}{" "}
                as a reusable preset.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                label="Preset name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPresetFromJob(null)} disabled={savingPreset}>Cancel</Button>
          {!presetDone && (
            <Button variant="contained" onClick={handleMakePreset} disabled={savingPreset}>
              {savingPreset ? "Saving…" : "Create Preset"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
