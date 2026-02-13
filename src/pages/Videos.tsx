import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Button,
} from "@mui/material";
import { Close, PlayCircleOutline, VideoLibrary } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { useJobStore } from "../stores/jobStore";
import { getJob, getFileUrl } from "../api/client";
import type { JobDetailResponse } from "../api/types";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Videos() {
  const { jobs, loading, fetchJobs } = useJobStore();
  const navigate = useNavigate();
  const [videoModal, setVideoModal] = useState<{ path: string | null; jobId: string } | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetailResponse>>({});

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const finalizedJobs = jobs
    .filter((j) => j.status === "finalized" || j.status === "finalizing")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Fetch details for finalized jobs to get video info
  useEffect(() => {
    for (const job of finalizedJobs) {
      if (!jobDetails[job.id]) {
        getJob(job.id).then((detail) => {
          setJobDetails((prev) => ({ ...prev, [job.id]: detail }));
        }).catch(() => {});
      }
    }
  }, [finalizedJobs.map((j) => j.id).join(",")]);

  const getVideoPath = (jobId: string): string | null => {
    const detail = jobDetails[jobId];
    if (!detail) return null;
    const video = detail.videos?.find((v) => v.output_path);
    if (video?.output_path) return video.output_path;
    return null;
  };

  const getHeroImage = (jobId: string): string | null => {
    const detail = jobDetails[jobId];
    if (!detail?.segments?.length) return null;
    // Use first segment's last_frame_path (segment index 0)
    const firstSeg = detail.segments.find((s) => s.index === 0);
    return firstSeg?.last_frame_path ?? null;
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Videos
      </Typography>

      {loading && finalizedJobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {finalizedJobs.length > 0 ? (
        <Grid container spacing={3}>
          {finalizedJobs.map((job) => {
            const videoPath = getVideoPath(job.id);
            const heroImage = getHeroImage(job.id);
            const detail = jobDetails[job.id];
            return (
              <Grid key={job.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card sx={{ height: "100%" }}>
                  <CardActionArea
                    onClick={() => setVideoModal({ path: videoPath, jobId: job.id })}
                  >
                    <Box
                      sx={{
                        position: "relative",
                        paddingTop: "56.25%", // 16:9 aspect ratio
                        bgcolor: "#1a1a2e",
                        overflow: "hidden",
                      }}
                    >
                      {heroImage ? (
                        <Box
                          component="img"
                          src={getFileUrl(heroImage)}
                          alt={job.name}
                          sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : job.starting_image ? (
                        <Box
                          component="img"
                          src={getFileUrl(job.starting_image)}
                          alt={job.name}
                          sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : null}
                      {videoPath && (
                        <PlayCircleOutline
                          sx={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            fontSize: 56,
                            color: "rgba(255,255,255,0.85)",
                            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                          }}
                        />
                      )}
                    </Box>
                  </CardActionArea>
                  <CardContent sx={{ pb: "12px !important" }}>
                    <Typography variant="subtitle2" noWrap sx={{ mb: 0.5 }}>
                      {job.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {detail ? `${detail.completed_segment_count} segments` : "..."} &middot;{" "}
                      {detail ? formatDuration(detail.total_video_time) : "..."} &middot;{" "}
                      {job.width}x{job.height}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {formatDate(job.updated_at)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      ) : (
        !loading && (
          <Card>
            <Box sx={{ textAlign: "center", py: 8 }}>
              <VideoLibrary sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
              <Typography variant="h6" color="text.secondary">
                No finalized videos yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Finalized videos will appear here once you complete and merge a job.
              </Typography>
            </Box>
          </Card>
        )
      )}

      {/* Video modal */}
      <Dialog
        open={!!videoModal}
        onClose={() => setVideoModal(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
          <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
            <IconButton
              onClick={() => setVideoModal(null)}
              sx={{ color: "white" }}
            >
              <Close />
            </IconButton>
          </Box>
          {videoModal?.path ? (
            <Box
              component="video"
              controls
              autoPlay
              src={getFileUrl(videoModal.path)}
              sx={{ width: "100%", display: "block" }}
            />
          ) : videoModal ? (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <CircularProgress sx={{ color: "white", mb: 2 }} />
              <Typography color="white" variant="body2">
                Loading video...
              </Typography>
            </Box>
          ) : null}
          {videoModal && (
            <Box sx={{ p: 1.5, display: "flex", justifyContent: "flex-end", bgcolor: "rgba(0,0,0,0.8)" }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  navigate(`/jobs/${videoModal.jobId}`);
                  setVideoModal(null);
                }}
                sx={{ textTransform: "none" }}
              >
                View Job
              </Button>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
