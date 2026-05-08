import { useEffect, useState, useCallback, useRef } from "react";
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
  TablePagination,
  InputAdornment,
  TextField,
} from "@mui/material";
import { useIsMobile } from "../hooks/useIsMobile";
import { Close, Error as ErrorIcon, Favorite, NavigateBefore, NavigateNext, PlayCircleOutline, Repeat, Search, Shuffle, VideoLibrary } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { getJobs, getJob, getFileUrl, getFavorites, toggleFavorite } from "../api/client";
import type { JobDetailResponse, JobResponse } from "../api/types";
import { DEFAULT_JOB_FETCH_LIMIT, POLL_INTERVAL_FAST } from "../constants";
import FavoriteHeart from "../components/FavoriteHeart";

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
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [videoModal, setVideoModal] = useState<{ jobId: string } | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetailResponse>>({});
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(12);
  const [playlist, setPlaylist] = useState<{ jobId: string; videoPath: string; jobName: string }[]>([]);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [loopVideo, setLoopVideo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // Scroll to top when page changes
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  // Debounce search input to avoid hammering the API on every keystroke
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const fetchVideos = useCallback(async () => {
    try {
      const res = await getJobs({
        status: "finalized,finalizing",
        limit: rowsPerPage,
        offset: page * rowsPerPage,
        sort: "updated_at_desc",
        q: debouncedQuery || undefined,
      });
      setJobs(res.items);
      setTotal(res.total);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, debouncedQuery]);

  useEffect(() => {
    fetchVideos();
    const interval = setInterval(fetchVideos, POLL_INTERVAL_FAST);
    return () => clearInterval(interval);
  }, [fetchVideos]);

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await getFavorites("video");
      setFavoritesSet(new Set(res.item_refs));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const filteredJobs = favoritesOnly
    ? jobs.filter((j) => favoritesSet.has(j.id))
    : jobs;

  const finalizedJobs = filteredJobs;

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

  const handlePlayRandom = async () => {
    setLoadingRandom(true);
    try {
      // Fetch all finalized jobs (respecting the active search filter)
      const res = await getJobs({
        status: "finalized",
        limit: DEFAULT_JOB_FETCH_LIMIT,
        offset: 0,
        q: debouncedQuery || undefined,
      });
      const allJobs = favoritesOnly
        ? res.items.filter((j) => favoritesSet.has(j.id))
        : res.items;

      // Fetch details for any we don't already have
      const details = await Promise.all(
        allJobs.map(async (job) => {
          if (jobDetails[job.id]) return { job, detail: jobDetails[job.id] };
          try {
            const detail = await getJob(job.id);
            setJobDetails((prev) => ({ ...prev, [job.id]: detail }));
            return { job, detail };
          } catch {
            return null;
          }
        }),
      );

      // Build playlist from completed videos
      const items: { jobId: string; videoPath: string; jobName: string }[] = [];
      for (const entry of details) {
        if (!entry) continue;
        const video = entry.detail.videos?.[0];
        if (video?.status === "completed" && video.output_path) {
          items.push({ jobId: entry.job.id, videoPath: video.output_path, jobName: entry.job.name });
        }
      }

      if (items.length === 0) return;

      // Shuffle (Fisher-Yates)
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }

      setPlaylist(items);
      setPlaylistIndex(0);
    } catch {
      // ignore
    } finally {
      setLoadingRandom(false);
    }
  };

  const isPlaylistMode = playlist.length > 0;
  const currentPlaylistItem = isPlaylistMode ? playlist[playlistIndex] : null;

  const modalDetail = videoModal ? jobDetails[videoModal.jobId] : null;
  const modalVideo = modalDetail?.videos?.[0] ?? null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Typography variant="h4">Videos</Typography>
        {jobs.length > 0 && (
          <Button
            variant="contained"
            startIcon={loadingRandom ? <CircularProgress size={18} color="inherit" /> : <Shuffle />}
            onClick={handlePlayRandom}
            disabled={loadingRandom}
            sx={{ textTransform: "none" }}
          >
            Play Random
          </Button>
        )}
        <Button
          variant={favoritesOnly ? "contained" : "outlined"}
          color={favoritesOnly ? "error" : "inherit"}
          startIcon={<Favorite />}
          size="small"
          onClick={() => setFavoritesOnly((v) => !v)}
          sx={{ textTransform: "none" }}
        >
          Favorites
        </Button>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="Search videos…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(0);
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />
      </Box>

      {loading && finalizedJobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {finalizedJobs.length > 0 ? (
        <>
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
                      <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                        <FavoriteHeart
                          favorited={favoritesSet.has(job.id)}
                          onToggle={async () => {
                            const prev = new Set(favoritesSet);
                            const nowFav = !prev.has(job.id);
                            if (nowFav) prev.add(job.id); else prev.delete(job.id);
                            setFavoritesSet(prev);
                            try {
                              await toggleFavorite({ item_type: "video", item_ref: job.id });
                            } catch {
                              setFavoritesSet(favoritesSet);
                            }
                          }}
                        />
                      </Box>
                    </Box>
                  </CardActionArea>
                  <CardContent sx={{ pb: "12px !important" }}>
                    <Typography variant="subtitle2" noWrap sx={{ mb: 0.5 }}>
                      {job.name}
                    </Typography>
                    {job.tags && (
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 0.5 }}>
                        {job.tags.split(",").map((tag, i) => {
                          const trimmed = tag.trim();
                          if (!trimmed) return null;
                          return (
                            <Chip key={i} label={trimmed} size="small" sx={{ height: 20, fontSize: 11 }} />
                          );
                        })}
                      </Box>
                    )}
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
        {total > 0 && (
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
            rowsPerPageOptions={[12, 24, 48]}
          />
        )}
        </>
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

      {/* Video modal — single video */}
      <Dialog
        open={!!videoModal}
        onClose={() => setVideoModal(null)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
          <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
            <IconButton
              onClick={() => setVideoModal(null)}
              sx={{ color: "white" }}
              aria-label="Close video"
            >
              <Close />
            </IconButton>
          </Box>
          {modalVideo?.status === "completed" && modalVideo.output_path ? (
            <Box
              component="video"
              controls
              autoPlay
              loop={loopVideo}
              src={getFileUrl(modalVideo.output_path)}
              sx={{ width: "100%", maxHeight: "80vh", objectFit: "contain", display: "block" }}
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
            <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", bgcolor: "rgba(0,0,0,0.8)" }}>
              <IconButton
                size="small"
                onClick={() => setLoopVideo((v) => !v)}
                sx={{ color: loopVideo ? "primary.main" : "rgba(255,255,255,0.5)" }}
                title={loopVideo ? "Loop on" : "Loop off"}
              >
                <Repeat fontSize="small" />
              </IconButton>
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

      {/* Playlist modal — Play Random */}
      <Dialog
        open={isPlaylistMode}
        onClose={() => setPlaylist([])}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
          <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
            <IconButton
              onClick={() => setPlaylist([])}
              sx={{ color: "white" }}
              aria-label="Close playlist"
            >
              <Close />
            </IconButton>
          </Box>
          {currentPlaylistItem && (
            <Box
              component="video"
              key={playlistIndex}
              controls
              autoPlay
              loop={loopVideo}
              src={getFileUrl(currentPlaylistItem.videoPath)}
              onEnded={() => {
                if (playlistIndex < playlist.length - 1) {
                  setPlaylistIndex((i) => i + 1);
                }
              }}
              sx={{ width: "100%", maxHeight: "80vh", objectFit: "contain", display: "block" }}
            />
          )}
          {currentPlaylistItem && (
            <Box sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1, bgcolor: "rgba(0,0,0,0.8)" }}>
              <IconButton
                size="small"
                disabled={playlistIndex === 0}
                onClick={() => setPlaylistIndex((i) => i - 1)}
                sx={{ color: "white" }}
              >
                <NavigateBefore />
              </IconButton>
              <Typography variant="body2" sx={{ color: "white", minWidth: 50, textAlign: "center" }}>
                {playlistIndex + 1} / {playlist.length}
              </Typography>
              <IconButton
                size="small"
                disabled={playlistIndex === playlist.length - 1}
                onClick={() => setPlaylistIndex((i) => i + 1)}
                sx={{ color: "white" }}
              >
                <NavigateNext />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setLoopVideo((v) => !v)}
                sx={{ color: loopVideo ? "primary.main" : "rgba(255,255,255,0.5)" }}
                title={loopVideo ? "Loop on" : "Loop off"}
              >
                <Repeat fontSize="small" />
              </IconButton>
              <Typography variant="body2" noWrap sx={{ color: "rgba(255,255,255,0.7)", flex: 1, ml: 1 }}>
                {currentPlaylistItem.jobName}
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  navigate(`/jobs/${currentPlaylistItem.jobId}`);
                  setPlaylist([]);
                }}
                sx={{ textTransform: "none", ml: "auto" }}
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
