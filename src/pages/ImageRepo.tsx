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
  TablePagination,
  TextField,
  Checkbox,
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
  CreateNewFolder,
  Delete,
  DriveFileMove,
  NavigateNext,
} from "@mui/icons-material";
import {
  getImageFolders,
  getImageFolder,
  getFileUrl,
  deleteImage,
  createImageFolder,
  uploadImage,
  moveImages,
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
  const [jobDialogImageUri, setJobDialogImageUri] = useState<string | null>(null);
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
  const [sortDesc, setSortDesc] = useState(true);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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

  const handleUseAsStartingImage = (image: ImageFile) => {
    setJobDialogImageUri(image.path);
    setLightboxImage(null);
    setJobDialogOpen(true);
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
        </Box>

        {folders.length === 0 && !loading && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="text.secondary">
              No image folders found.
            </Typography>
          </Box>
        )}

        <Grid container spacing={2}>
          {folders
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

        {/* New Folder Dialog */}
        <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)}>
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
        {selectMode && selectedKeys.size > 0 && (
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
        {[...images]
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
                  selectMode ? toggleSelect(image.key) : setLightboxImage(image)
                }
              >
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
          count={images.length}
          page={imagePage}
          onPageChange={(_, p) => setImagePage(p)}
          rowsPerPage={imagesPerPage}
          onRowsPerPageChange={(e) => {
            setImagesPerPage(parseInt(e.target.value, 10));
            setImagePage(0);
          }}
          rowsPerPageOptions={[24, 48, 96]}
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
                startIcon={<DriveFileMove />}
                onClick={() => handleOpenMoveDialog([lightboxImage.key])}
              >
                Move to
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

      {/* Move to Folder Dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
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

      {/* Create Job Dialog */}
      <CreateJobDialog
        open={jobDialogOpen}
        onClose={() => {
          setJobDialogOpen(false);
          setJobDialogImageUri(null);
        }}
        onCreated={() => {
          setJobDialogOpen(false);
          setJobDialogImageUri(null);
        }}
        initialStartingImageUri={jobDialogImageUri}
      />
    </Box>
  );
}
