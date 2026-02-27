import { useEffect, useState, useCallback } from "react";
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
} from "@mui/material";
import {
  ArrowBack,
  Delete,
  NavigateNext,
} from "@mui/icons-material";
import {
  getImageFolders,
  getImageFolder,
  getFileUrl,
  deleteImage,
} from "../api/client";
import type { ImageFolder, ImageFile } from "../api/types";
import CreateJobDialog from "../components/CreateJobDialog";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageRepo() {
  const [folders, setFolders] = useState<ImageFolder[]>([]);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<ImageFile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageFile | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [jobDialogImage, setJobDialogImage] = useState<File | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getImageFolders();
      setFolders(data);
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

  const handleUseAsStartingImage = async (image: ImageFile) => {
    try {
      const url = getFileUrl(image.path);
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], image.filename, { type: "image/png" });
      setJobDialogImage(file);
      setLightboxImage(null);
      setJobDialogOpen(true);
    } catch {
      // ignore
    }
  };

  if (loading && folders.length === 0 && images.length === 0) {
    return (
      <Box>
        <Typography variant="h4" sx={{ mb: 3 }}>
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
        <Typography variant="h4" sx={{ mb: 3 }}>
          Image Repo
        </Typography>

        {folders.length === 0 && !loading && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="text.secondary">
              No image folders found.
            </Typography>
          </Box>
        )}

        <Grid container spacing={2}>
          {folders.map((folder) => (
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
      </Box>
    );
  }

  // View B: Image Grid
  return (
    <Box>
      {/* Header with breadcrumb */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={handleBack} size="small">
          <ArrowBack />
        </IconButton>
        <Typography
          variant="h4"
          component="span"
          sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
          onClick={handleBack}
        >
          Image Repo
        </Typography>
        <NavigateNext sx={{ color: "text.disabled" }} />
        <Typography variant="h4" component="span">
          {currentFolder}
        </Typography>
      </Box>

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

      <Grid container spacing={2}>
        {images.map((image) => (
          <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
            <Card
              sx={{ position: "relative" }}
              onMouseEnter={() => setHoveredCard(image.key)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <CardActionArea onClick={() => setLightboxImage(image)}>
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
              {hoveredCard === image.key && (
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

      {/* Lightbox Modal */}
      <Dialog
        open={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        maxWidth="lg"
        fullWidth
      >
        {lightboxImage && (
          <>
            <DialogTitle sx={{ pb: 0 }}>
              {lightboxImage.filename}
              <Typography variant="body2" color="text.secondary">
                {formatBytes(lightboxImage.size)}
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ textAlign: "center", pt: 2 }}>
              <Box
                component="img"
                src={getFileUrl(lightboxImage.path)}
                alt={lightboxImage.filename}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "80vh",
                  objectFit: "contain",
                }}
              />
            </DialogContent>
            <DialogActions>
              <Button
                color="error"
                onClick={() => setDeleteConfirm(lightboxImage)}
              >
                Delete
              </Button>
              <Button
                variant="contained"
                onClick={() => handleUseAsStartingImage(lightboxImage)}
              >
                Use as Starting Image
              </Button>
              <Button onClick={() => setLightboxImage(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
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

      {/* Create Job Dialog */}
      <CreateJobDialog
        open={jobDialogOpen}
        onClose={() => {
          setJobDialogOpen(false);
          setJobDialogImage(null);
        }}
        onCreated={() => {
          setJobDialogOpen(false);
          setJobDialogImage(null);
        }}
        initialStartingImage={jobDialogImage}
      />
    </Box>
  );
}
