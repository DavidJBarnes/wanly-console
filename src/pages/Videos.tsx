import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
} from "@mui/material";
import { Close, PlayCircleOutline, VideoLibrary } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { useJobStore } from "../stores/jobStore";
import { getJob, getFileUrl } from "../api/client";
import type { JobDetailResponse } from "../api/types";
import StatusChip from "../components/StatusChip";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function Videos() {
  const { jobs, loading, fetchJobs } = useJobStore();
  const navigate = useNavigate();
  const [videoModal, setVideoModal] = useState<string | null>(null);
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
    // Check for finalized video in videos array
    const video = detail.videos?.find((v) => v.output_path);
    if (video?.output_path) return video.output_path;
    return null;
  };

  const getLastFrame = (jobId: string): string | null => {
    const detail = jobDetails[jobId];
    if (!detail?.segments?.length) return null;
    const lastSeg = detail.segments[detail.segments.length - 1];
    return lastSeg?.last_frame_path ?? null;
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
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 80 }}>Preview</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell sx={{ width: 100 }}>Status</TableCell>
                  <TableCell sx={{ width: 120 }}>Dimensions</TableCell>
                  <TableCell sx={{ width: 80 }}>Segments</TableCell>
                  <TableCell sx={{ width: 120 }}>Duration</TableCell>
                  <TableCell sx={{ width: 140 }}>Finalized</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {finalizedJobs.map((job) => {
                  const videoPath = getVideoPath(job.id);
                  const lastFrame = getLastFrame(job.id);
                  const detail = jobDetails[job.id];
                  return (
                    <TableRow key={job.id} hover sx={{ cursor: "pointer" }}>
                      <TableCell
                        onClick={() => {
                          if (videoPath) {
                            setVideoModal(videoPath);
                          } else {
                            navigate(`/jobs/${job.id}`);
                          }
                        }}
                      >
                        {lastFrame ? (
                          <Box sx={{ position: "relative" }}>
                            <Box
                              component="img"
                              src={getFileUrl(lastFrame)}
                              alt=""
                              sx={{
                                width: 64,
                                height: 64,
                                objectFit: "cover",
                                borderRadius: 1,
                                bgcolor: "#f5f5f5",
                                display: "block",
                              }}
                            />
                            {videoPath && (
                              <PlayCircleOutline
                                sx={{
                                  position: "absolute",
                                  top: "50%",
                                  left: "50%",
                                  transform: "translate(-50%, -50%)",
                                  fontSize: 28,
                                  color: "white",
                                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
                                }}
                              />
                            )}
                          </Box>
                        ) : job.starting_image ? (
                          <Box
                            component="img"
                            src={getFileUrl(job.starting_image)}
                            alt=""
                            sx={{
                              width: 64,
                              height: 64,
                              objectFit: "cover",
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                              display: "block",
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              width: 64,
                              height: 64,
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell onClick={() => navigate(`/jobs/${job.id}`)}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {job.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={job.status} />
                      </TableCell>
                      <TableCell>
                        {job.width}x{job.height}
                      </TableCell>
                      <TableCell>
                        {detail ? detail.completed_segment_count : "-"}
                      </TableCell>
                      <TableCell>
                        {detail ? formatDuration(detail.total_video_time) : "-"}
                      </TableCell>
                      <TableCell>{formatDate(job.updated_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
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
          <IconButton
            onClick={() => setVideoModal(null)}
            sx={{ position: "absolute", top: 8, right: 8, color: "white", zIndex: 1 }}
          >
            <Close />
          </IconButton>
          {videoModal && (
            <Box
              component="video"
              controls
              autoPlay
              src={getFileUrl(videoModal)}
              sx={{ width: "100%", display: "block" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
