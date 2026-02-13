import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Button,
  Alert,
} from "@mui/material";
import { Close, Error as ErrorIcon, PlayCircleOutline, VideoLibrary } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { getJobs, getJob, getFileUrl } from "../api/client";
import type { JobDetailResponse, JobResponse } from "../api/types";

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
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoModal, setVideoModal] = useState<{ jobId: string } | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetailResponse>>({});

  const fetchVideos = useCallback(async () => {
    try {
      const res = await getJobs({ status: "finalized,finalizing", limit: 200 });
      setJobs(res.items);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
    const interval = setInterval(fetchVideos, 5000);
    return () => clearInterval(interval);
  }, [fetchVideos]);

  const finalizedJobs = [...jobs].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  // Fetch details for jobs to get video info
  useEffect(() => {
    for (const job of finalizedJobs) {
      if (!jobDetails[job.id]) {
        getJob(job.id)
          .then((detail) => {
            setJobDetails((prev) => ({ ...prev, [job.id]: detail }));
          })
          .catch(() => {});
      }
    }
  }, [finalizedJobs.map((j) => j.id).join(",")]);

  const getVideoInfo = (jobId: string) => {
    const detail = jobDetails[jobId];
    if (!detail?.videos?.length) return null;
    return detail.videos[0];
  };

  const getHeroImage = (jobId: string): string | null => {
    const detail = jobDetails[jobId];
    if (!detail?.segments?.length) return null;
    const firstSeg = detail.segments.find((s) => s.index === 0);
    return firstSeg?.last_frame_path ?? null;
  };

  const modalJob = videoModal ? finalizedJobs.find((j) => j.id === videoModal.jobId) : null;
  const modalDetail = videoModal ? jobDetails[videoModal.jobId] : null;
  const modalVideo = modalDetail?.videos?.[0] ?? null;

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
            const videoInfo = getVideoInfo(job.id);
            const heroImage = getHeroImage(job.id);
            const detail = jobDetails[job.id];
            const isStitching = job.status === "finalizing" || videoInfo?.status === "pending";
            const isFailed = videoInfo?.status === "failed";
            const isCompleted = videoInfo?.status === "completed" && videoInfo.output_path;
            return (
              <Grid key={job.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card sx={{ height: "100%" }}>
                  <CardActionArea
                    onClick={() => setVideoModal({ jobId: job.id })}
                  >
                    <Box
                      sx={{
                        position: "relative",
                        paddingTop: "56.25%",
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
                      {isCompleted && (
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
                      {isStitching && (
                        <Box
                          sx={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                          }}
                        >
                          <CircularProgress size={40} sx={{ color: "white", mb: 1 }} />
                        </Box>
                      )}
                      {isFailed && (
                        <ErrorIcon
                          sx={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            fontSize: 56,
                            color: "rgba(244,67,54,0.85)",
                            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                          }}
                        />
                      )}
                      {/* Status chip overlay */}
                      {(isStitching || isFailed) && (
                        <Chip
                          label={isStitching ? "Stitching..." : "Failed"}
                          size="small"
                          color={isFailed ? "error" : "default"}
                          sx={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            bgcolor: isStitching ? "rgba(0,0,0,0.6)" : undefined,
                            color: isStitching ? "white" : undefined,
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
          {modalVideo?.status === "completed" && modalVideo.output_path ? (
            <Box
              component="video"
              controls
              autoPlay
              src={getFileUrl(modalVideo.output_path)}
              sx={{ width: "100%", display: "block" }}
            />
          ) : modalVideo?.status === "failed" ? (
            <Box sx={{ p: 4 }}>
              <Alert severity="error" sx={{ mb: 2 }}>
                Video stitching failed
              </Alert>
              {modalVideo.error_message && (
                <Typography
                  variant="body2"
                  sx={{ color: "rgba(255,255,255,0.7)", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}
                >
                  {modalVideo.error_message}
                </Typography>
              )}
            </Box>
          ) : videoModal ? (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <CircularProgress sx={{ color: "white", mb: 2 }} />
              <Typography color="white" variant="body2">
                Stitching video...
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
