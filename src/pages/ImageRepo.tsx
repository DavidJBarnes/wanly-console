import { useEffect, useState, useCallback, useRef } from "react";
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  CardMedia,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Grid,
  InputAdornment,
  TablePagination,
  TextField,
  Checkbox,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowBack,
  ArrowDownward,
  ArrowUpward,
  CheckBox as CheckBoxIcon,
  CloudUpload,
  ContentCut,
  CreateNewFolder,
  Delete,
  DriveFileMove,
  Close,
  Favorite,
  NavigateNext,
  PlayArrow,
  Refresh,
  Search,
} from "@mui/icons-material";
import { useNavigate } from "react-router";
import {
  getImageFolders,
  getImageFolder,
  getFileUrl,
  getImageJobs,
  deleteImage,
  createImageFolder,
  uploadImage,
  moveImages,
  getFavorites,
  toggleFavorite,
  getFavoriteImages,
  updateImageTags,
  searchImages,
} from "../api/client";
import type { ImageFolder, ImageFile, ImageJobInfo } from "../api/types";
import CreateJobDialog from "../components/CreateJobDialog";
import CropResizeDialog from "../components/CropResizeDialog";
import FavoriteHeart from "../components/FavoriteHeart";
import { useTagStore } from "../stores/tagStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function ImageRepo() {
  const [folders, setFolders] = useState<ImageFolder[]>([]);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<ImageFile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageFile | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [jobDialogImageUri, setJobDialogImageUri] = useState<string | null>(null);
  const [jobDialogImageTags, setJobDialogImageTags] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [folderPage, setFolderPage] = useState(0);
  const [foldersPerPage, setFoldersPerPage] = useState(12);
  const [imagePage, setImagePage] = useState(0);
  const [imagesPerPage, setImagesPerPage] = useState(24);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetKeys, setMoveTargetKeys] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteKeys, setBulkDeleteKeys] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const pendingImagePathRef = useRef<string | null>(null);
  const [cropResizeImage, setCropResizeImage] = useState<ImageFile | null>(null);
  const [lightboxJobs, setLightboxJobs] = useState<ImageJobInfo[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoritesView, setFavoritesView] = useState(false);
  const [favImages, setFavImages] = useState<ImageFile[]>([]);
  const [loadingFavImages, setLoadingFavImages] = useState(false);
  const [lightboxTags, setLightboxTags] = useState("");
  const tagSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ImageFile[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const [searchRowsPerPage, setSearchRowsPerPage] = useState(24);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [screensaverOpen, setScreensaverOpen] = useState(false);
  const [screensaverIndex, setScreensaverIndex] = useState(0);
  const screensaverPoolRef = useRef<ImageFile[]>([]);
  const { titleTags1, titleTags2, fetchTags } = useTagStore();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const btnSize = isMobile ? "small" : "medium";

  // Scroll to top when page changes
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [folderPage]);

  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [imagePage]);

  useEffect(() => {
    return () => {
      if (tagSaveTimer.current) clearTimeout(tagSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (tagSaveTimer.current) {
      clearTimeout(tagSaveTimer.current);
      tagSaveTimer.current = undefined;
    }
    setLightboxTags(lightboxImage?.tags ?? "");
  }, [lightboxImage]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setSearchPage(0);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Screensaver auto-advance timer
  useEffect(() => {
    if (!screensaverOpen) return;
    const timer = setInterval(() => {
      setScreensaverIndex((prev) => {
        const next = prev + 1;
        if (next >= screensaverPoolRef.current.length) {
          screensaverPoolRef.current = shuffleArray(screensaverPoolRef.current);
          return 0;
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [screensaverOpen]);

  const fetchSearchResults = useCallback(async () => {
    if (!debouncedSearch) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await searchImages({
        q: debouncedSearch,
        limit: searchRowsPerPage,
        offset: searchPage * searchRowsPerPage,
      });
      setSearchResults(res.items);
      setSearchTotal(res.total);
    } catch {
      // ignore
    } finally {
      setSearchLoading(false);
    }
  }, [debouncedSearch, searchPage, searchRowsPerPage]);

  useEffect(() => {
    fetchSearchResults();
  }, [fetchSearchResults]);

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await getFavorites("image");
      setFavoritesSet(new Set(res.item_refs));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getImageFolders();
      setFolders(data);
      setFolderPage(0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchImages = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const data = await getImageFolder(date);
      setImages(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentFolder === null) {
      fetchFolders();
    } else {
      fetchImages(currentFolder);
    }
  }, [currentFolder, fetchFolders, fetchImages]);

  const handleFolderClick = (name: string) => {
    setCurrentFolder(name);
    setImagePage(0);
  };

  const handleBack = () => {
    setCurrentFolder(null);
    setImages([]);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteImage(deleteConfirm.path);
      setImages((prev) => prev.filter((img) => img.key !== deleteConfirm.key));
      if (lightboxImage?.key === deleteConfirm.key) {
        setLightboxImage(null);
      }
    } catch {
      // ignore
    }
    setDeleteConfirm(null);
  };

  const handleOpenLightbox = (image: ImageFile) => {
    setLightboxImage(image);
    setLoadingJobs(true);
    setLightboxJobs([]);
    getImageJobs(image.path)
      .then(setLightboxJobs)
      .catch(() => setLightboxJobs([]))
      .finally(() => setLoadingJobs(false));
  };

  const handleUseAsStartingImage = (image: ImageFile) => {
    pendingImagePathRef.current = image.path;
    setJobDialogImageUri(image.path);
    setJobDialogImageTags(image.tags ?? null);
    setLightboxImage(null);
    setJobDialogOpen(true);
  };

  const handleTagsChange = (newTags: string) => {
    setLightboxTags(newTags);
    if (tagSaveTimer.current) clearTimeout(tagSaveTimer.current);
    tagSaveTimer.current = setTimeout(() => {
      tagSaveTimer.current = undefined;
      if (lightboxImage) {
        const path = lightboxImage.path;
        updateImageTags(path, newTags || null)
          .then(() => {
            setImages((prev) =>
              prev.map((img) =>
                img.path === path ? { ...img, tags: newTags || null } : img
              )
            );
            setLightboxImage((prev) =>
              prev && prev.path === path ? { ...prev, tags: newTags || null } : prev
            );
          })
          .catch((err) => {
            console.error("Failed to save image tags:", err);
          });
      }
    }, 500);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      await createImageFolder(newFolderName.trim());
      setNewFolderOpen(false);
      setNewFolderName("");
      await fetchFolders();
    } catch {
      // ignore
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleUploadFiles = async (files: FileList) => {
    if (!currentFolder || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadImage(file, currentFolder);
      }
      await fetchImages(currentFolder);
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleOpenMoveDialog = async (keys: string[]) => {
    setMoveTargetKeys(keys);
    setMoveDialogOpen(true);
    // Ensure folder list is available (it may not be loaded when inside a folder)
    if (folders.length === 0) {
      try {
        const data = await getImageFolders();
        setFolders(data);
      } catch {
        // ignore
      }
    }
  };

  const handleOpenBulkDelete = (keys: string[]) => {
    setBulkDeleteKeys(keys);
    setBulkDeleteOpen(true);
  };

  const handleBulkDeleteConfirm = async () => {
    if (bulkDeleteKeys.length === 0) return;
    setBulkDeleting(true);
    try {
      for (const key of bulkDeleteKeys) {
        const img = images.find((i) => i.key === key);
        if (img) await deleteImage(img.path);
      }
      setImages((prev) => prev.filter((img) => !bulkDeleteKeys.includes(img.key)));
      if (lightboxImage && bulkDeleteKeys.includes(lightboxImage.key)) {
        setLightboxImage(null);
      }
      setSelectedKeys(new Set());
      setSelectMode(false);
      setBulkDeleteOpen(false);
      setBulkDeleteKeys([]);
    } catch {
      // ignore
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleMove = async (targetFolder: string) => {
    if (moveTargetKeys.length === 0) return;
    setMoving(true);
    try {
      await moveImages(moveTargetKeys, targetFolder);
      setMoveDialogOpen(false);
      setMoveTargetKeys([]);
      setSelectedKeys(new Set());
      setSelectMode(false);
      // Close lightbox if the moved image was being previewed
      if (lightboxImage && moveTargetKeys.includes(lightboxImage.key)) {
        setLightboxImage(null);
      }
      if (currentFolder) await fetchImages(currentFolder);
    } catch {
      // ignore
    } finally {
      setMoving(false);
    }
  };

  const handleOpenScreensaver = (pool: ImageFile[]) => {
    if (pool.length === 0) return;
    screensaverPoolRef.current = shuffleArray(pool);
    setScreensaverIndex(0);
    setScreensaverOpen(true);
  };

  const dialogs = (
    <>
      {/* Lightbox Modal */}
      <Dialog
        open={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        maxWidth="lg"
        fullWidth
        fullScreen={isMobile}
      >
        {lightboxImage && (
          <>
            <DialogTitle sx={{ pb: 0 }}>
              {lightboxImage.filename}
              <Typography variant="body2" color="text.secondary">
                {formatBytes(lightboxImage.size)}
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ pt: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: isMobile ? "column" : "row",
                  gap: 2,
                }}
              >
                {/* Left: Image */}
                <Box
                  sx={{
                    flex: isMobile ? "none" : "2 1 0",
                    minWidth: 0,
                    textAlign: "center",
                  }}
                >
                  <Box
                    component="img"
                    src={getFileUrl(lightboxImage.path)}
                    alt={lightboxImage.filename}
                    sx={{
                      maxWidth: "100%",
                      maxHeight: isMobile ? "50vh" : "70vh",
                      objectFit: "contain",
                    }}
                  />
                </Box>

                {/* Right: Jobs that used this image */}
                <Box
                  sx={{
                    flex: isMobile ? "none" : "1 1 0",
                    minWidth: 0,
                    borderLeft: isMobile ? "none" : "1px solid",
                    borderTop: isMobile ? "1px solid" : "none",
                    borderColor: "divider",
                    pl: isMobile ? 0 : 2,
                    pt: isMobile ? 2 : 0,
                    maxHeight: "70vh",
                    overflowY: "auto",
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    Jobs Using This Image
                  </Typography>
                  {loadingJobs ? (
                    <Box sx={{ textAlign: "center", py: 4 }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : lightboxJobs.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No Jobs have used this image
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {lightboxJobs.map((job) => (
                        <ListItemButton
                          key={job.id}
                          onClick={() => {
                            setLightboxImage(null);
                            navigate(`/jobs/${job.id}`);
                          }}
                          sx={{ borderRadius: 1 }}
                        >
                          <ListItemText
                            primary={job.name}
                            primaryTypographyProps={{
                              variant: "body2",
                              sx: { color: "primary.main", cursor: "pointer" },
                            }}
                            secondary={new Date(job.created_at).toLocaleString()}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                  <Box component="hr" sx={{ my: 2, borderColor: "divider" }} />
                  <Box>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Add tags (comma separated)"
                      value={lightboxTags}
                      onChange={(e) => handleTagsChange(e.target.value)}
                      aria-label="Image tags"
                    />
                    {lightboxTags && (
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
                        {lightboxTags.split(",").map((tag, i) => {
                          const trimmed = tag.trim();
                          if (!trimmed) return null;
                          return (
                            <Chip
                              key={i}
                              label={trimmed}
                              size="small"
                              onDelete={() => {
                                const tags = lightboxTags.split(",")
                                  .map((t) => t.trim())
                                  .filter((t) => t && t !== trimmed);
                                handleTagsChange(tags.join(", "));
                              }}
                            />
                          );
                        })}
                      </Box>
                    )}
                    {(titleTags1.length > 0 || titleTags2.length > 0) && (
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
                        {titleTags1.map((tag) => (
                          <Chip
                            key={tag.id}
                            label={tag.name}
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              const current = lightboxTags
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean);
                              if (!current.includes(tag.name)) {
                                handleTagsChange([...current, tag.name].join(", "));
                              }
                            }}
                          />
                        ))}
                        {titleTags2.map((tag) => (
                          <Chip
                            key={tag.id}
                            label={tag.name}
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              const current = lightboxTags
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean);
                              if (!current.includes(tag.name)) {
                                handleTagsChange([...current, tag.name].join(", "));
                              }
                            }}
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>
            </DialogContent>
            <DialogActions sx={{ flexWrap: "wrap", gap: isMobile ? 1.5 : 1 }}>
              <Button
                color="error"
                size={btnSize}
                onClick={() => setDeleteConfirm(lightboxImage)}
              >
                Delete
              </Button>
              <IconButton
                size={btnSize}
                aria-label={favoritesSet.has(lightboxImage.path) ? "Unfavorite" : "Favorite"}
                onClick={async () => {
                  if (!lightboxImage) return;
                  const prev = new Set(favoritesSet);
                  const nowFav = !prev.has(lightboxImage.path);
                  if (nowFav) prev.add(lightboxImage.path); else prev.delete(lightboxImage.path);
                  setFavoritesSet(prev);
                  try {
                    await toggleFavorite({ item_type: "image", item_ref: lightboxImage.path });
                  } catch {
                    setFavoritesSet(favoritesSet);
                  }
                }}
                sx={{ color: favoritesSet.has(lightboxImage.path) ? "#e91e63" : undefined }}
              >
                <Favorite />
              </IconButton>
              <Button
                startIcon={isMobile ? undefined : <DriveFileMove />}
                size={btnSize}
                onClick={() => handleOpenMoveDialog([lightboxImage.key])}
              >
                Move to
              </Button>
              <Button
                startIcon={isMobile ? undefined : <ContentCut />}
                size={btnSize}
                onClick={() => {
                  setCropResizeImage(lightboxImage);
                  setLightboxImage(null);
                }}
              >
                Crop & Resize
              </Button>
              <Button
                variant="contained"
                size={btnSize}
                onClick={() => handleUseAsStartingImage(lightboxImage)}
              >
                {isMobile ? "New Job" : "Use as Starting Image"}
              </Button>
              <Button size={btnSize} onClick={() => setLightboxImage(null)} sx={{ ml: "auto" }}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        fullScreen={isMobile}
      >
        <DialogTitle>Delete Image?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{" "}
            <strong>{deleteConfirm?.filename}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => !bulkDeleting && setBulkDeleteOpen(false)}
        fullScreen={isMobile}
      >
        <DialogTitle>Delete Images?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{" "}
            <strong>{bulkDeleteKeys.length} image{bulkDeleteKeys.length > 1 ? "s" : ""}</strong>?
            This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleBulkDeleteConfirm}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? <CircularProgress size={20} /> : `Delete ${bulkDeleteKeys.length} image${bulkDeleteKeys.length > 1 ? "s" : ""}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          Move {moveTargetKeys.length} image{moveTargetKeys.length > 1 ? "s" : ""} to...
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {moving ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <List>
              {folders
                .filter((f) => f.name !== currentFolder)
                .map((f) => (
                  <ListItemButton
                    key={f.name}
                    onClick={() => handleMove(f.name)}
                  >
                    <ListItemText primary={f.name} />
                  </ListItemButton>
                ))}
              {folders.filter((f) => f.name !== currentFolder).length === 0 && (
                <Box sx={{ textAlign: "center", py: 3 }}>
                  <Typography color="text.secondary">
                    No other folders available
                  </Typography>
                </Box>
              )}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)} disabled={moving}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      <CropResizeDialog
        open={!!cropResizeImage}
        image={cropResizeImage}
        onClose={() => setCropResizeImage(null)}
        onSaved={() => { if (currentFolder) fetchImages(currentFolder); }}
      />

      {/* Create Job Dialog */}
      <CreateJobDialog
        open={jobDialogOpen}
        onClose={() => {
          setJobDialogOpen(false);
          setJobDialogImageUri(null);
          setJobDialogImageTags(null);
          pendingImagePathRef.current = null;
        }}
        onCreated={() => {
          const path = pendingImagePathRef.current;
          setJobDialogOpen(false);
          setJobDialogImageUri(null);
          setJobDialogImageTags(null);
          pendingImagePathRef.current = null;
          if (path) {
            setImages((prev) =>
              prev.map((img) =>
                img.path === path ? { ...img, in_use: true } : img,
              ),
            );
            setFavImages((prev) =>
              prev.map((img) =>
                img.path === path ? { ...img, in_use: true } : img,
              ),
            );
          }
        }}
        initialStartingImageUri={jobDialogImageUri}
        initialImageTags={jobDialogImageTags}
      />

      {/* Screensaver */}
      <Dialog
        open={screensaverOpen}
        onClose={() => setScreensaverOpen(false)}
        fullScreen
        PaperProps={{
          sx: {
            bgcolor: "#000",
            backgroundImage: "none",
            borderRadius: 0,
          },
        }}
      >
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => {
            setScreensaverIndex((prev) => {
              const next = prev + 1;
              if (next >= screensaverPoolRef.current.length) {
                screensaverPoolRef.current = shuffleArray(screensaverPoolRef.current);
                return 0;
              }
              return next;
            });
          }}
        >
          {screensaverPoolRef.current.length > 0 && (
            <Box
              component="img"
              src={getFileUrl(screensaverPoolRef.current[screensaverIndex]?.path ?? "")}
              alt={screensaverPoolRef.current[screensaverIndex]?.filename ?? ""}
              sx={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Close button */}
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              setScreensaverOpen(false);
            }}
            sx={{
              position: "absolute",
              top: 16,
              right: 16,
              color: "white",
              bgcolor: "rgba(0,0,0,0.4)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <Close />
          </IconButton>

          {/* Info overlay at bottom */}
          {screensaverPoolRef.current.length > 0 && (
            <Box
              sx={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                p: 2,
                background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                color: "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                pointerEvents: "none",
              }}
            >
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {screensaverPoolRef.current[screensaverIndex]?.filename}
                </Typography>
                {screensaverPoolRef.current[screensaverIndex]?.tags && (
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>
                    {screensaverPoolRef.current[screensaverIndex]?.tags}
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" sx={{ opacity: 0.7, ml: 2, flexShrink: 0 }}>
                {screensaverIndex + 1} / {screensaverPoolRef.current.length}
              </Typography>
            </Box>
          )}

          {/* Pause indicator — appears briefly on pause via Space */}
          {screensaverPoolRef.current.length === 0 && (
            <Typography color="white" variant="h6">
              No images to display
            </Typography>
          )}
        </Box>
      </Dialog>
    </>
  );

  if (loading && folders.length === 0 && images.length === 0) {
    return (
      <Box>
        <Typography variant={isMobile ? "h5" : "h4"} sx={{ mb: 3 }}>
          Image Repo
        </Typography>
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  // View A: Folder Grid
  if (currentFolder === null) {
    return (
      <Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            mb: 3,
            flexWrap: "wrap",
          }}
        >
          <Typography variant={isMobile ? "h5" : "h4"}>Image Repo</Typography>
          <Button
            variant="outlined"
            startIcon={isMobile ? undefined : <CreateNewFolder />}
            size={isMobile ? "small" : "medium"}
            onClick={() => setNewFolderOpen(true)}
          >
            {isMobile ? "New" : "New Folder"}
          </Button>
          <Button
            variant={favoritesView ? "contained" : "outlined"}
            color={favoritesView ? "error" : "inherit"}
            startIcon={isMobile ? undefined : <Favorite />}
            size={isMobile ? "small" : "medium"}
            onClick={async () => {
              if (favoritesView) {
                setFavoritesView(false);
                return;
              }
              setFavoritesView(true);
              setLoadingFavImages(true);
              try {
                const imgs = await getFavoriteImages();
                setFavImages(imgs);
              } catch {
                // ignore
              } finally {
                setLoadingFavImages(false);
              }
            }}
          >
            {isMobile ? "Fav" : "Favorites"}
          </Button>
          {(favoritesView && favImages.length > 0) || (debouncedSearch && searchResults.length > 0) ? (
            <Button
              variant="outlined"
              startIcon={isMobile ? undefined : <PlayArrow />}
              size={isMobile ? "small" : "medium"}
              onClick={() => {
                const pool = debouncedSearch ? searchResults : favImages;
                handleOpenScreensaver(pool);
              }}
            >
              {isMobile ? "Play" : "Play"}
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            placeholder="Search images by tag…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchPage(0);
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
            sx={{ minWidth: 220 }}
          />
        </Box>

        {debouncedSearch && (
          <>
            {searchLoading && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <Box sx={{ textAlign: "center", py: 8 }}>
                <Typography color="text.secondary">
                  No images found matching "{debouncedSearch}".
                </Typography>
              </Box>
            )}
            {searchResults.length > 0 && (
              <>
                <Grid container spacing={2}>
                  {searchResults.map((image) => (
                    <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                      <Card sx={{ position: "relative" }}>
                        <CardActionArea onClick={() => handleOpenLightbox(image)}>
                          <CardMedia
                            component="img"
                            image={getFileUrl(image.path)}
                            alt={image.filename}
                            sx={{ height: 200, objectFit: "cover" }}
                          />
                          <Box sx={{ p: 1 }}>
                            <Typography variant="caption" noWrap>
                              {image.filename}
                            </Typography>
                            {image.tags && (
                              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                                {image.tags.split(",").slice(0, 3).map((tag, i) => {
                                  const trimmed = tag.trim();
                                  if (!trimmed) return null;
                                  return (
                                    <Chip key={i} label={trimmed} size="small" sx={{ height: 20, fontSize: 11 }} />
                                  );
                                })}
                              </Box>
                            )}
                          </Box>
                        </CardActionArea>
                        <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                          <FavoriteHeart
                            favorited={favoritesSet.has(image.path)}
                            onToggle={async () => {
                              const prev = new Set(favoritesSet);
                              const nowFav = !prev.has(image.path);
                              if (nowFav) prev.add(image.path); else prev.delete(image.path);
                              setFavoritesSet(prev);
                              try {
                                await toggleFavorite({ item_type: "image", item_ref: image.path });
                              } catch {
                                setFavoritesSet(favoritesSet);
                              }
                            }}
                          />
                        </Box>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
                <TablePagination
                  component="div"
                  count={searchTotal}
                  page={searchPage}
                  onPageChange={(_, p) => setSearchPage(p)}
                  rowsPerPage={searchRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setSearchRowsPerPage(parseInt(e.target.value, 10));
                    setSearchPage(0);
                  }}
                  rowsPerPageOptions={[24, 48, 96]}
                  showFirstButton
                  showLastButton
                  sx={{
                    "& .MuiTablePagination-toolbar": {
                      flexWrap: "wrap",
                      justifyContent: "center",
                      px: 0,
                    },
                    "& .MuiTablePagination-spacer": { display: "none" },
                  }}
                />
              </>
            )}
          </>
        )}

        {!debouncedSearch && (
          <>
        {favoritesView && (
          <>
            {loadingFavImages && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {!loadingFavImages && favImages.length === 0 && (
              <Box sx={{ textAlign: "center", py: 8 }}>
                <Typography color="text.secondary">
                  No favorited images yet.
                </Typography>
              </Box>
            )}
            {favImages.length > 0 && (
              <>
                <Grid container spacing={2}>
                  {favImages.map((image) => (
                    <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                      <Card sx={{ position: "relative" }}>
                        <CardActionArea onClick={() => handleOpenLightbox(image)}>
                          <CardMedia
                            component="img"
                            image={getFileUrl(image.path)}
                            alt={image.filename}
                            sx={{ height: 200, objectFit: "cover" }}
                          />
                          <Box sx={{ p: 1 }}>
                            <Typography variant="caption" noWrap>
                              {image.filename}
                            </Typography>
                          </Box>
                        </CardActionArea>
                        <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                          <FavoriteHeart
                            favorited={true}
                            onToggle={async () => {
                              setFavImages((prev) => prev.filter((img) => img.path !== image.path));
                              try {
                                await toggleFavorite({ item_type: "image", item_ref: image.path });
                                await fetchFavorites();
                              } catch {
                                setFavImages((prev) => [...prev, image]);
                              }
                            }}
                          />
                        </Box>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </>
        )}

        {!favoritesView && folders.length === 0 && !loading && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="text.secondary">
              No image folders found.
            </Typography>
          </Box>
        )}

        {!favoritesView && (
          <>
        <Grid container spacing={2}>
          {[...folders]
            .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
            .slice(folderPage * foldersPerPage, (folderPage + 1) * foldersPerPage)
            .map((folder) => (
            <Grid key={folder.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <Card>
                <CardActionArea onClick={() => handleFolderClick(folder.name)}>
                  {folder.thumbnail ? (
                    <CardMedia
                      component="img"
                      image={getFileUrl(folder.thumbnail)}
                      alt={folder.name}
                      sx={{ height: 200, objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        height: 200,
                        bgcolor: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Typography color="text.disabled">No images</Typography>
                    </Box>
                  )}
                  <Box sx={{ p: 1.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {folder.name}
                    </Typography>
                  </Box>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
        {folders.length > 0 && (
          <TablePagination
            component="div"
            count={folders.length}
            page={folderPage}
            onPageChange={(_, p) => setFolderPage(p)}
            rowsPerPage={foldersPerPage}
            onRowsPerPageChange={(e) => {
              setFoldersPerPage(parseInt(e.target.value, 10));
              setFolderPage(0);
            }}
            rowsPerPageOptions={[12, 24, 48]}
            showFirstButton
            showLastButton
            sx={{
              "& .MuiTablePagination-toolbar": {
                flexWrap: "wrap",
                justifyContent: "center",
                px: 0,
              },
              "& .MuiTablePagination-spacer": { display: "none" },
            }}
          />
        )}
          </>
        )}
          </>
        )}

        {/* New Folder Dialog */}
        <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} fullScreen={isMobile}>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              sx={{ mt: 1 }}
              inputProps={{ maxLength: 100 }}
              helperText="Letters, numbers, spaces, dashes, underscores"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {creatingFolder ? <CircularProgress size={20} /> : "Create"}
            </Button>
          </DialogActions>
        </Dialog>
        {dialogs}
      </Box>
    );
  }

  // View B: Image Grid
  return (
    <Box>
      {/* Header with breadcrumb */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 3,
          flexWrap: "wrap",
        }}
      >
        <IconButton onClick={handleBack} size="small">
          <ArrowBack />
        </IconButton>
        {!isMobile && (
          <>
            <Typography
              variant="h4"
              component="span"
              sx={{
                cursor: "pointer",
                "&:hover": { textDecoration: "underline" },
              }}
              onClick={handleBack}
            >
              Image Repo
            </Typography>
            <NavigateNext sx={{ color: "text.disabled" }} />
          </>
        )}
        <Typography
          variant={isMobile ? "h6" : "h4"}
          component="span"
          sx={{
            minWidth: 0,
            flexShrink: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentFolder}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="Search images by tag…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSearchPage(0);
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
          sx={{ minWidth: 220 }}
        />
        {selectMode && selectedKeys.size > 0 && (
          <>
          <Button
            variant="contained"
            startIcon={isMobile ? undefined : <DriveFileMove />}
            size={isMobile ? "small" : "medium"}
            onClick={() => handleOpenMoveDialog(Array.from(selectedKeys))}
          >
            {isMobile
              ? `Move (${selectedKeys.size})`
              : `Move ${selectedKeys.size} image${selectedKeys.size > 1 ? "s" : ""}`}
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={isMobile ? undefined : <Delete />}
            size={isMobile ? "small" : "medium"}
            onClick={() => handleOpenBulkDelete(Array.from(selectedKeys))}
          >
            {isMobile
              ? `Del (${selectedKeys.size})`
              : `Delete ${selectedKeys.size} image${selectedKeys.size > 1 ? "s" : ""}`}
          </Button>
          </>
        )}
        <Button
          variant="outlined"
          startIcon={
            isMobile ? undefined : sortDesc ? <ArrowDownward /> : <ArrowUpward />
          }
          size={isMobile ? "small" : "medium"}
          onClick={() => {
            setSortDesc((prev) => !prev);
            setImagePage(0);
          }}
          title={sortDesc ? "Newest first" : "Oldest first"}
        >
          {sortDesc ? "Newest" : "Oldest"}
        </Button>
        <Button
          variant={favoritesOnly ? "contained" : "outlined"}
          color={favoritesOnly ? "error" : "inherit"}
          startIcon={isMobile ? undefined : <Favorite />}
          size={isMobile ? "small" : "medium"}
          onClick={() => {
            setFavoritesOnly((v) => !v);
            setImagePage(0);
          }}
        >
          {isMobile ? (favoritesOnly ? "Fav" : "Fav") : "Favorites"}
        </Button>
        <Button
          variant="outlined"
          startIcon={isMobile ? undefined : <PlayArrow />}
          size={isMobile ? "small" : "medium"}
          disabled={
            !debouncedSearch && images.length === 0 ||
            debouncedSearch && searchResults.length === 0 ||
            favoritesOnly && !images.some((img) => favoritesSet.has(img.path))
          }
          onClick={() => {
            let pool: ImageFile[];
            if (debouncedSearch) {
              pool = searchResults;
            } else if (favoritesOnly) {
              pool = images.filter((img) => favoritesSet.has(img.path));
            } else {
              pool = images;
            }
            handleOpenScreensaver(pool);
          }}
        >
          {isMobile ? "Play" : "Play"}
        </Button>
        <Button
          variant={selectMode ? "contained" : "outlined"}
          startIcon={isMobile ? undefined : <CheckBoxIcon />}
          size={isMobile ? "small" : "medium"}
          onClick={() => {
            setSelectMode((prev) => !prev);
            setSelectedKeys(new Set());
          }}
        >
          {selectMode ? "Cancel" : "Select"}
        </Button>
        <Button
          variant="outlined"
          startIcon={
            isMobile
              ? undefined
              : refreshing
                ? <CircularProgress size={16} />
                : <Refresh />
          }
          size={isMobile ? "small" : "medium"}
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              await fetchImages(currentFolder!);
            } finally {
              setRefreshing(false);
            }
          }}
        >
          {refreshing ? (isMobile ? "..." : "Refreshing...") : "Refresh"}
        </Button>
        <Button
          variant="outlined"
          startIcon={
            isMobile
              ? undefined
              : uploading
                ? <CircularProgress size={16} />
                : <CloudUpload />
          }
          size={isMobile ? "small" : "medium"}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (isMobile ? "..." : "Uploading...") : "Upload"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => {
            if (e.target.files) handleUploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </Box>

      {debouncedSearch && (
        <>
          {searchLoading && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <Typography color="text.secondary">
                No images found matching "{debouncedSearch}".
              </Typography>
            </Box>
          )}
          {searchResults.length > 0 && (
            <>
              <Grid container spacing={2}>
                {searchResults.map((image) => (
                  <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                    <Card
                      sx={{ position: "relative" }}
                      onMouseEnter={() => setHoveredCard(image.key)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <CardActionArea
                        onClick={() =>
                          selectMode ? toggleSelect(image.key) : handleOpenLightbox(image)
                        }
                      >
                        <CardMedia
                          component="img"
                          image={getFileUrl(image.path)}
                          alt={image.filename}
                          sx={{ height: 200, objectFit: "cover" }}
                        />
                        <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Box
                            component="span"
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              flexShrink: 0,
                              bgcolor: "grey.500",
                            }}
                          />
                          <Typography variant="caption" noWrap>
                            {image.filename}
                          </Typography>
                        </Box>
                        {image.tags && (
                          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", px: 1, pb: 1 }}>
                            {image.tags.split(",").slice(0, 3).map((tag, i) => {
                              const trimmed = tag.trim();
                              if (!trimmed) return null;
                              return (
                                <Chip key={i} label={trimmed} size="small" sx={{ height: 20, fontSize: 11 }} />
                              );
                            })}
                          </Box>
                        )}
                      </CardActionArea>
                      {selectMode && (
                        <Checkbox
                          checked={selectedKeys.has(image.key)}
                          onChange={() => toggleSelect(image.key)}
                          sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            bgcolor: "rgba(255,255,255,0.8)",
                            borderRadius: "0 0 4px 0",
                            p: 0.5,
                          }}
                        />
                      )}
                      {!selectMode && (
                        <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                          <FavoriteHeart
                            favorited={favoritesSet.has(image.path)}
                            onToggle={async () => {
                              const prev = new Set(favoritesSet);
                              const nowFav = !prev.has(image.path);
                              if (nowFav) prev.add(image.path); else prev.delete(image.path);
                              setFavoritesSet(prev);
                              try {
                                await toggleFavorite({ item_type: "image", item_ref: image.path });
                              } catch {
                                setFavoritesSet(favoritesSet);
                              }
                            }}
                          />
                        </Box>
                      )}
                      {!selectMode && hoveredCard === image.key && (
                        <IconButton
                          size="small"
                          sx={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            bgcolor: "rgba(0,0,0,0.5)",
                            color: "white",
                            "&:hover": { bgcolor: "rgba(211,47,47,0.8)" },
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(image);
                          }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      )}
                    </Card>
                  </Grid>
                ))}
              </Grid>
              <TablePagination
                component="div"
                count={searchTotal}
                page={searchPage}
                onPageChange={(_, p) => setSearchPage(p)}
                rowsPerPage={searchRowsPerPage}
                onRowsPerPageChange={(e) => {
                  setSearchRowsPerPage(parseInt(e.target.value, 10));
                  setSearchPage(0);
                }}
                rowsPerPageOptions={[24, 48, 96]}
                showFirstButton
                showLastButton
                sx={{
                  "& .MuiTablePagination-toolbar": {
                    flexWrap: "wrap",
                    justifyContent: "center",
                    px: 0,
                  },
                  "& .MuiTablePagination-spacer": { display: "none" },
                }}
              />
            </>
          )}
        </>
      )}

      {!debouncedSearch && (
        <>
      {loading && images.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {images.length === 0 && !loading && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography color="text.secondary">
            No images in this folder.
          </Typography>
        </Box>
      )}

      {images.length > 0 && favoritesOnly && !images.some((img) => favoritesSet.has(img.path)) && !loading && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography color="text.secondary">
            No favorited images in this folder.
          </Typography>
        </Box>
      )}

      <Grid container spacing={2}>
        {[...(favoritesOnly ? images.filter((img) => favoritesSet.has(img.path)) : images)]
          .sort((a, b) => {
            const cmp = a.last_modified.localeCompare(b.last_modified);
            return sortDesc ? -cmp : cmp;
          })
          .slice(imagePage * imagesPerPage, (imagePage + 1) * imagesPerPage)
          .map((image) => (
          <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
            <Card
              sx={{ position: "relative" }}
              onMouseEnter={() => setHoveredCard(image.key)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <CardActionArea
                onClick={() =>
                  selectMode ? toggleSelect(image.key) : handleOpenLightbox(image)
                }
              >
                <CardMedia
                  component="img"
                  image={getFileUrl(image.path)}
                  alt={image.filename}
                  sx={{ height: 200, objectFit: "cover" }}
                />
                <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      bgcolor: image.in_use ? "#22c55e" : "grey.500",
                      boxShadow: image.in_use ? "0 0 6px rgba(34, 197, 94, 0.45)" : undefined,
                    }}
                    aria-label={image.in_use ? "Used in a job" : "Not used in any job"}
                    title={image.in_use ? "Used in a job" : "Not used in any job"}
                  />
                  <Typography variant="caption" noWrap>
                    {image.filename}
                  </Typography>
                </Box>
                {image.tags && (
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", px: 1, pb: 1 }}>
                    {image.tags.split(",").slice(0, 3).map((tag, i) => {
                      const trimmed = tag.trim();
                      if (!trimmed) return null;
                      return (
                        <Chip key={i} label={trimmed} size="small" sx={{ height: 20, fontSize: 11 }} />
                      );
                    })}
                  </Box>
                )}
              </CardActionArea>
              {selectMode && (
                <Checkbox
                  checked={selectedKeys.has(image.key)}
                  onChange={() => toggleSelect(image.key)}
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    bgcolor: "rgba(255,255,255,0.8)",
                    borderRadius: "0 0 4px 0",
                    p: 0.5,
                  }}
                />
              )}
              {!selectMode && (
                <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                  <FavoriteHeart
                    favorited={favoritesSet.has(image.path)}
                    onToggle={async () => {
                      const prev = new Set(favoritesSet);
                      const nowFav = !prev.has(image.path);
                      if (nowFav) prev.add(image.path); else prev.delete(image.path);
                      setFavoritesSet(prev);
                      try {
                        await toggleFavorite({ item_type: "image", item_ref: image.path });
                      } catch {
                        setFavoritesSet(favoritesSet);
                      }
                    }}
                  />
                </Box>
              )}
              {!selectMode && hoveredCard === image.key && (
                <IconButton
                  size="small"
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    bgcolor: "rgba(0,0,0,0.5)",
                    color: "white",
                    "&:hover": { bgcolor: "rgba(211,47,47,0.8)" },
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(image);
                  }}
                >
                  <Delete fontSize="small" />
                </IconButton>
              )}
            </Card>
          </Grid>
        ))}
      </Grid>
      {images.length > 0 && (
        <TablePagination
          component="div"
          count={favoritesOnly ? images.filter((img) => favoritesSet.has(img.path)).length : images.length}
          page={imagePage}
          onPageChange={(_, p) => setImagePage(p)}
          rowsPerPage={imagesPerPage}
          onRowsPerPageChange={(e) => {
            setImagesPerPage(parseInt(e.target.value, 10));
            setImagePage(0);
          }}
          rowsPerPageOptions={[24, 48, 96]}
          showFirstButton
          showLastButton
          sx={{
            "& .MuiTablePagination-toolbar": {
              flexWrap: "wrap",
              justifyContent: "center",
              px: 0,
            },
            "& .MuiTablePagination-spacer": { display: "none" },
          }}
        />
      )}
          </>
        )}

      {dialogs}
    </Box>
  );
}
