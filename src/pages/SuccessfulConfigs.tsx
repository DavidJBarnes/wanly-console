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
} from "@mui/material";
import { Star } from "@mui/icons-material";
import { getJobs, getFileUrl } from "../api/client";
import StatusChip from "../components/StatusChip";
import type { JobResponse } from "../api/types";

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
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <ConfigChip label="CFG" value={`${job.cfg_high ?? 1}/${job.cfg_low ?? 1}`} />
                      <ConfigChip
                        label="LX2V"
                        value={`${job.lightx2v_strength_high ?? 2.0}/${job.lightx2v_strength_low ?? 1.0}`}
                      />
                      {job.steps_total != null && (
                        <ConfigChip label="Steps" value={`${job.steps_total} (${job.high_noise_steps ?? "?"}h)`} />
                      )}
                      {job.flow_shift != null && <ConfigChip label="Shift" value={job.flow_shift} />}
                      <ConfigChip label="" value={`${job.width}x${job.height}`} />
                    </Box>
                  </CardContent>
                </Box>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
