import { ltxError } from "../api/ltx";
import { apiError } from "../lib/apiError";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  Snackbar,
  Stack,
  Alert,
  FormControlLabel,
  Link,
} from "@mui/material";
import {
  ArrowBack,
  ArrowDownward,
  ArrowUpward,
  CheckBox as CheckBoxIcon,
  ChevronLeft,
  ChevronRight,
  Close,
  CloudUpload,
  ContentCut,
  CreateNewFolder,
  Delete,
  DeleteOutline,
  DriveFileMove,
  Face,
  Favorite,
  LabelOff,
  LocalOffer,
  NavigateNext,
  PhotoLibrary,
  PlayArrow,
  Refresh,
  Search,
} from "@mui/icons-material";
import { useNavigate } from "react-router";
import {
  parseImageInUse,
  describeHolders,
  type ImageInUse,
} from "../lib/imageDeleteConflict";
import {
  getImageFolders,
  getImageFolder,
  getFileUrl,
  getImageJobs,
  deleteImage,
  checkImagesInUse,
  createImageFolder,
  deleteImageFolder,
  uploadImage,
  moveImages,
  getFavorites,
  toggleFavorite,
  getFavoriteImages,
  getUntaggedImages,
  updateImageTags,
  getImageScene,
  requestImageDescribe,
  searchImages,
  getImageTagCounts,
} from "../api/client";
import type { FolderInUse, ImageFolder, ImageFile, ImageJobInfo, TagCount } from "../api/types";
import type { BulkTagResult } from "../api/client";
import { shouldAutoDescribe } from "../lib/autoDescribe";
import {
  isTypingTarget,
  lightboxKeyAction,
  lightboxNav,
  lightboxSteps,
  orderForBrowse,
  poolForView,
  successorAfterDelete,
} from "../lib/lightboxNav";
import { createDeferredWrite, type DeferredWrite } from "../lib/deferredWrite";
import CaptionStatusChip from "../components/CaptionStatusChip";
import {
  type CaptionHalfName, captionPending, halfActions, motionNeedsRegrounding, REGROUND_HINT,
  requestedByNote,
} from "../lib/captionStatus";
import {
  captionStatusNow, noteCaptionTicket, refreshCaptionStatus, useCaptionDone, useCaptionStatus,
} from "../stores/captionStore";
import CaptionQueueChip from "../components/CaptionQueueChip";
import CreateLtxJobDialog from "../components/CreateLtxJobDialog";
import CropResizeDialog from "../components/CropResizeDialog";
import ImageEditDialog from "../components/ImageEditDialog";
import FavoriteHeart from "../components/FavoriteHeart";
import { useTagStore } from "../stores/tagStore";
import AddToDatasetDialog from "../components/AddToDatasetDialog";
import BulkTagDialog from "../components/BulkTagDialog";
import TagFilterBar from "../components/TagFilterBar";
import {
  describeFilter,
  hasFilter,
  parseTagParam,
  serializeTagParam,
  toggleTag,
} from "../lib/tagFilter";
import { useQueryState, getPage, pageValue, getPerPage, perPageValue } from "../hooks/useQueryState";
import { parseFolderInUse } from "../lib/folderDeleteConflict";
import {
  deleteFailureReason,
  describeImageHolders,
  neededHolders,
  newlyNeeded,
  splitSelection,
  summarizeBulkDelete,
  type DeleteOutcome,
  type InUseMap,
} from "../lib/bulkDelete";

/** Where the bulk-delete dialog is (console#594): asking the API what is in use, showing the
 *  answer, or showing what failed after a run. */
type BulkCheck =
  | { phase: "checking" }
  | { phase: "error"; message: string }
  | { phase: "ready"; inUse: InUseMap }
  | { phase: "done"; failures: DeleteOutcome[]; message: string };

const FOLDER_ROWS_OPTIONS = [12, 24, 48];
const DEFAULT_FOLDER_ROWS = 12;
const IMAGE_ROWS_OPTIONS = [24, 48, 96];
const DEFAULT_IMAGE_ROWS = 24;

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
  const [loading, setLoading] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<ImageFile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ImageFile | null>(null);
  // In flight: the confirm buttons show it and cannot be pressed twice.
  const [deleting, setDeleting] = useState(false);
  const [folderDelete, setFolderDelete] = useState<{ name: string; conflict: FolderInUse | null } | null>(null);
  const [inUse, setInUse] = useState<{ image: ImageFile; conflict: ImageInUse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [jobDialogImageUri, setJobDialogImageUri] = useState<string | null>(null);
  const [jobDialogImageTags, setJobDialogImageTags] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [addToDatasetOpen, setAddToDatasetOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetKeys, setMoveTargetKeys] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteKeys, setBulkDeleteKeys] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkCheck, setBulkCheck] = useState<BulkCheck | null>(null);
  // Force with queued or held jobs in the way needs an explicit "I understand" (console#594).
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  // A check answered after the dialog was closed or reopened must not land on the new one.
  const bulkCheckSeq = useRef(0);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagUris, setBulkTagUris] = useState<string[]>([]);
  const [sortDesc, setSortDesc] = useState(true);
  const pendingImagePathRef = useRef<string | null>(null);
  const [cropResizeImage, setCropResizeImage] = useState<ImageFile | null>(null);
  // The Image Edit tool (#547). Opened from the lightbox, which closes -- as Crop does -- so
  // the lightbox's arrow keys cannot step the image out from under the editor.
  const [editImage, setEditImage] = useState<ImageFile | null>(null);
  const [lightboxJobs, setLightboxJobs] = useState<ImageJobInfo[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  // Scene description (console#414). A describe is a caption TICKET since console#564: the
  // API answers at once and captions in the background, and where every image's caption has
  // got to comes from the shared caption store (one poll for the page) -- so leaving the
  // page and coming back still shows "In caption queue (#4)" instead of an idle image.
  //
  // `requestingPaths` covers only the moment between the click and the API's answer, so a
  // double click (or a tag save landing at the same time) cannot ask twice. A ref, because
  // it guards a debounced callback rather than drives a render.
  const requestingPaths = useRef<Set<string>>(new Set());
  // Carries its own path: descriptions run in the background, so by the time one fails the
  // modal may be showing a different image, and an error pinned to the wrong picture reads
  // as that picture having failed.
  const [sceneError, setSceneError] = useState<{ path: string; message: string } | null>(null);
  // Each half on its own (console#590): the scene and the motion paragraph have their own
  // tickets, chips, buttons and retry.
  const lightboxScene = useCaptionStatus(lightboxImage?.path, "scene");
  const lightboxMotion = useCaptionStatus(lightboxImage?.path, "motion");
  const [refreshing, setRefreshing] = useState(false);
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());
  const [favoritesView, setFavoritesView] = useState(false);
  const [favImages, setFavImages] = useState<ImageFile[]>([]);
  const [loadingFavImages, setLoadingFavImages] = useState(false);
  const [untaggedView, setUntaggedView] = useState(false);
  const [untaggedImages, setUntaggedImages] = useState<ImageFile[]>([]);
  const [loadingUntagged, setLoadingUntagged] = useState(false);
  const [lightboxTags, setLightboxTags] = useState("");
  /** A tag edit waiting to be written, and which image it belongs to. */
  type TagEdit = { path: string; tags: string; existingScene: string | null };
  const [searchResults, setSearchResults] = useState<ImageFile[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [screensaverOpen, setScreensaverOpen] = useState(false);
  const [screensaverIndex, setScreensaverIndex] = useState(0);
  const screensaverPoolRef = useRef<ImageFile[]>([]);
  const { titleTags1, titleTags2, fetchTags } = useTagStore();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const btnSize = isMobile ? "small" : "medium";

  // Browsing state lives in the URL (?folder=…&fpage=2&ipage=3&spage=1&q=…&fav=1)
  // so it survives the unmount caused by clicking through to /jobs/:id, plus
  // browser back/forward and refresh. Page params are 1-based and omitted when
  // on the first page; MUI's TablePagination is 0-based, converted here.
  const { params, setQuery } = useQueryState();
  // `|| null` so an empty ?folder= is treated as "no folder open".
  const currentFolder = params.get("folder") || null;
  const folderPage = getPage(params, "fpage");
  const foldersPerPage = getPerPage(params, "fper", FOLDER_ROWS_OPTIONS, DEFAULT_FOLDER_ROWS);
  const imagePage = getPage(params, "ipage");
  const imagesPerPage = getPerPage(params, "iper", IMAGE_ROWS_OPTIONS, DEFAULT_IMAGE_ROWS);
  const searchPage = getPage(params, "spage");
  const searchRowsPerPage = getPerPage(params, "sper", IMAGE_ROWS_OPTIONS, DEFAULT_IMAGE_ROWS);
  const favoritesOnly = params.get("fav") === "1";
  // The committed (debounced) search term *is* the URL param; the text field
  // keeps local state so typing stays instant and does not rewrite the URL on
  // every keystroke.
  const debouncedSearch = params.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(debouncedSearch);
  // Tag selection is URL state too (?tags=Kelly,Missionary), so a filtered view survives
  // navigation, back/forward and a refresh exactly like the folder and page params do.
  const tagsParam = params.get("tags");
  const selectedTags = useMemo(() => parseTagParam(tagsParam), [tagsParam]);
  // "Is anything filtering?" — the page shows results when it is true and the folder listing
  // when it is not. Previously this was just "is the search box non-empty".
  const filterActive = hasFilter(debouncedSearch, selectedTags);
  const filterLabel = describeFilter(debouncedSearch, selectedTags);
  const setSelectedTags = useCallback(
    (next: string[]) => setQuery({ tags: serializeTagParam(next), spage: null }),
    [setQuery],
  );

  // Scroll the main scroll container to the top on any pagination change
  // (folders, in-folder images, AND search results).
  // Instant (not smooth) + rAF so the async grid re-render can't interrupt/stall it
  // — smooth-scrolling from the bottom of a tall page left it stuck at the bottom.
  useEffect(() => {
    requestAnimationFrame(() => {
      document.querySelector("main")?.scrollTo({ top: 0 });
    });
  }, [folderPage, imagePage, searchPage]);

  useEffect(() => {
    // Flush, never cancel. This fires when the lightbox opens another image AND when it
    // closes — and cancelling here is what quietly dropped a tag made a moment before
    // (console#435). The pending edit carries its own path, so committing it here lands it
    // on the image it was made for, not on whatever is on screen now.
    tagSaveRef.current?.flush();
    setLightboxTags(lightboxImage?.tags ?? "");
  }, [lightboxImage]);

  // Lightbox prev/next (console#522). The pool is DERIVED from whichever grid is on
  // screen rather than captured at click time: a tag save or describe replaces the
  // image object inside its source array, and a captured copy would navigate inside
  // stale data. The folder pool is the full sorted array, not the current page slice,
  // so stepping walks past the page edge into the images the pagination is hiding.
  const lightboxPool = useMemo(
    () =>
      poolForView({
        filterActive,
        favoritesView,
        untaggedView,
        search: searchResults,
        favorites: favImages,
        untagged: untaggedImages,
        folder: orderForBrowse(
          favoritesOnly ? images.filter((img) => favoritesSet.has(img.path)) : images,
          sortDesc,
        ),
      }),
    [
      filterActive,
      favoritesView,
      untaggedView,
      searchResults,
      favImages,
      untaggedImages,
      images,
      favoritesOnly,
      favoritesSet,
      sortDesc,
    ],
  );
  // Where the image on screen was last seen in its pool (console#560). The pool is live, so
  // an image can leave it while it is on screen — tagging it in the Untagged view does
  // exactly that, and the arrows used to vanish with it. Remembering its last index lets
  // ←/→ (and delete-and-advance) carry on from where it was. Recorded during render, the
  // "adjust state when a value changes" pattern, and guarded so it settles in one pass.
  const [lightboxAnchor, setLightboxAnchor] = useState<{ path: string; index: number } | null>(
    null,
  );
  const livePosition = lightboxNav(lightboxImage, lightboxPool);
  if (
    lightboxImage && livePosition &&
    (lightboxAnchor?.path !== lightboxImage.path || lightboxAnchor.index !== livePosition.index)
  ) {
    setLightboxAnchor({ path: lightboxImage.path, index: livePosition.index });
  }
  const lightboxLastIndex =
    lightboxImage && lightboxAnchor?.path === lightboxImage.path ? lightboxAnchor.index : null;
  const lightboxPosition = lightboxSteps(lightboxImage, lightboxPool, lightboxLastIndex);

  // Stepping re-enters through handleOpenLightbox, not a bare setImage: each image must
  // refetch its job list, and the tag field resets via the flush effect above.
  const stepLightbox = (dir: -1 | 1) => {
    if (!lightboxPosition) return;
    const to = dir < 0 ? lightboxPosition.prev : lightboxPosition.next;
    if (to !== null) handleOpenLightbox(lightboxPool[to]);
  };

  useEffect(() => {
    // The lightbox must be the topmost dialog for arrows to belong to it; Delete and
    // Move-to keep the lightbox mounted underneath, so gate on those too.
    if (!lightboxImage || deleteConfirm || inUse || moveDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = lightboxKeyAction(e.key);
      if (!action) return;
      // The tag editor lives inside this modal: Left/Right must move the caret, and Del
      // must delete a character, not the image.
      if (isTypingTarget(e.target)) return;
      if (action === "delete") {
        // The confirmation, not the delete (console#567): same dialog as the button.
        e.preventDefault();
        setDeleteConfirm(lightboxImage);
        return;
      }
      if (!lightboxPosition) return;
      e.preventDefault();
      stepLightbox(action === "prev" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxImage, lightboxPool, lightboxLastIndex, deleteConfirm, inUse, moveDialogOpen]);

  // Commit the search box to the URL after a pause. The equality guard means a
  // remount (restored ?q=…) does not re-commit the same term — which would wipe
  // the restored page params along with it.
  useEffect(() => {
    if (searchQuery === debouncedSearch) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setQuery({ q: searchQuery || null, spage: null });
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, debouncedSearch, setQuery]);

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

  // Same "clamp back into range" guard as the folder list, for search results
  // (whose pagination control only renders when the page has results).
  useEffect(() => {
    if (!filterActive || searchTotal === 0) return;
    const maxPage = Math.max(0, Math.ceil(searchTotal / searchRowsPerPage) - 1);
    if (searchPage > maxPage) setQuery({ spage: pageValue(maxPage) });
  }, [filterActive, searchTotal, searchRowsPerPage, searchPage, setQuery]);

  const fetchSearchResults = useCallback(async () => {
    if (!filterActive) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await searchImages({
        q: debouncedSearch || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
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
  }, [filterActive, debouncedSearch, selectedTags, searchPage, searchRowsPerPage]);

  // Counts are re-fetched with the filter, not once on mount: they are scoped to the current
  // result set, which is the whole point — after clicking Kelly the remaining pills show what
  // co-occurs with Kelly, so a dead end is visible before it is clicked.
  const fetchTagCounts = useCallback(async () => {
    try {
      setTagCounts(
        await getImageTagCounts({
          q: debouncedSearch || undefined,
          tags: selectedTags.length ? selectedTags : undefined,
        }),
      );
    } catch {
      // A failed census leaves the previous pills up rather than emptying the bar.
    }
  }, [debouncedSearch, selectedTags]);

  useEffect(() => {
    fetchSearchResults();
  }, [fetchSearchResults]);

  useEffect(() => {
    fetchTagCounts();
  }, [fetchTagCounts]);

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

  // Keep folderPage in range if the list shrinks (e.g. after a delete), but never
  // reset it on navigation — resetting was what snapped "page 2 -> folder -> back" to page 1.
  // The guards matter: `folders` is empty before the first fetch resolves and
  // while a folder is open, and clamping against an empty list would throw away
  // a page restored from the URL.
  useEffect(() => {
    if (currentFolder !== null || folders.length === 0) return;
    const maxPage = Math.max(0, Math.ceil(folders.length / foldersPerPage) - 1);
    if (folderPage > maxPage) setQuery({ fpage: pageValue(maxPage) });
  }, [currentFolder, folders.length, foldersPerPage, folderPage, setQuery]);

  // Same idea for the in-folder image page. `images` is empty while loading and
  // while the folder list is showing, so both are guarded out.
  useEffect(() => {
    if (currentFolder === null || images.length === 0) return;
    const count = favoritesOnly
      ? images.filter((img) => favoritesSet.has(img.path)).length
      : images.length;
    const maxPage = Math.max(0, Math.ceil(count / imagesPerPage) - 1);
    if (imagePage > maxPage) setQuery({ ipage: pageValue(maxPage) });
  }, [currentFolder, images, favoritesOnly, favoritesSet, imagesPerPage, imagePage, setQuery]);

  const handleFolderClick = (name: string) => {
    setQuery({ folder: name, ipage: null });
  };

  const handleBack = () => {
    setQuery({ folder: null, ipage: null });
    setImages([]);
  };

  const removeFromView = (key: string) => {
    // A deleted image must vanish from EVERY cached list, not just `images`. The folder,
    // untagged, favorites and search views each render their own array, so filtering only
    // `images` left the deleted image on screen until a refetch — the reported bug (#315),
    // which reproduced on the untagged and folder views.
    setImages((prev) => prev.filter((img) => img.key !== key));
    setUntaggedImages((prev) => prev.filter((img) => img.key !== key));
    setFavImages((prev) => prev.filter((img) => img.key !== key));
    setSearchResults((prev) => {
      const next = prev.filter((img) => img.key !== key);
      if (next.length !== prev.length) setSearchTotal((t) => Math.max(0, t - 1));
      return next;
    });
    if (lightboxImage?.key === key) setLightboxImage(null);
  };

  const handleDeleteConfirm = async (force = false) => {
    const target = deleteConfirm ?? inUse?.image ?? null;
    if (!target || deleting) return;
    // Deleting from the lightbox keeps it open (console#560): the person is stepping
    // through images, and closing threw away their place. The successor is chosen from the
    // pool as it is NOW, before the delete, so it is the image → would have reached.
    const fromLightbox = lightboxImage?.key === target.key;
    const successor = fromLightbox
      ? successorAfterDelete(lightboxPool, target.path, lightboxLastIndex)
      : null;
    setDeleting(true);
    try {
      await deleteImage(target.path, force);
      removeFromView(target.key);
      if (fromLightbox) {
        // None left: close. Otherwise show the next (or, at the end, the previous) image.
        if (successor) handleOpenLightbox(successor);
        else setLightboxImage(null);
      }
      setInUse(null);
    } catch (e) {
      // A refusal is not a failure — the API declined because something still points at this
      // image. Say what, instead of the previous silent swallow, which taught people to
      // distrust the button rather than go look at the job.
      const conflict = parseImageInUse(e);
      if (conflict) {
        setInUse({ image: target, conflict });
      } else {
        // The API's reason (a 503 names what is busy), or that we gave up waiting — never
        // a bare "could not", and never a dialog left spinning (console#559).
        setInUse(null);
        setError(apiError(e, "Could not delete image"));
      }
    } finally {
      setDeleting(false);
    }
    setDeleteConfirm(null);
  };

  const handleFolderDeleteConfirm = async (force = false) => {
    if (!folderDelete) return;
    try {
      await deleteImageFolder(folderDelete.name, force);
      // The folder and its images are gone: drop the folder card, and the in-folder view
      // if this one was open.
      setFolders((prev) => prev.filter((f) => f.name !== folderDelete.name));
      if (currentFolder === folderDelete.name) {
        setQuery({ folder: null });
        setImages([]);
      }
      setFolderDelete(null);
    } catch (e: unknown) {
      const conflict = parseFolderInUse(e);
      if (conflict) {
        setFolderDelete({ ...folderDelete, conflict });
      } else {
        setError(apiError(e, "Could not delete folder"));
        setFolderDelete(null);
      }
    }
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

  /**
   * Caption ONE HALF of an image and save it on its record (console#590).
   *
   * One function for every caller -- the tag's automatic first description (scene), the
   * Describe / Redo scene / Describe motion / Redo motion buttons -- because they are the
   * same act on a half. The endpoint always regenerates that half and never touches the
   * other; which act this is was decided by whoever called.
   *
   * Every view holding this image is updated, not just the modal: the grid, the favourites
   * list and the untagged list all carry their own copy of the row, and a description that
   * only landed in one of them would come back as null the next time the modal opened.
   */
  const runDescribe = async (path: string, half: CaptionHalfName) => {
    const key = `${half}:${path}`;
    if (requestingPaths.current.has(key)) return;
    if (captionPending(captionStatusNow(path, half))) return;
    requestingPaths.current.add(key);
    setSceneError(null);
    try {
      // Answers at once with the caption's ticket; the words arrive through the caption
      // store's "done" event below, on this page or any other.
      noteCaptionTicket(await requestImageDescribe(path, { halves: [half] }));
      refreshCaptionStatus();
    } catch (err) {
      // THE API'S REASON, not axios's "Request failed with status code 400".
      console.error("Failed to describe image:", err);
      setSceneError({ path, message: ltxError(err) });
    } finally {
      requestingPaths.current.delete(key);
    }
  };

  /**
   * A caption finished (console#564): fetch its words and put them on every copy of the row.
   *
   * Every view holding this image is updated, not just the modal: the grid, the favourites
   * list and the untagged list all carry their own copy of the row, and a description that
   * only landed in one of them would come back as null the next time the modal opened. Fires
   * for any image whose caption finished while this page was open -- including one asked for
   * from another page, or by a held job.
   */
  const onCaptionDone = useCallback((paths: string[]) => {
    for (const path of paths) {
      getImageScene(path)
        .then((scene) => {
          const patch = (img: ImageFile) =>
            img.path === path
              ? {
                  ...img,
                  scene_description: scene.scene_description,
                  scene_described_at: scene.scene_described_at,
                  // Whichever half finished, both are read back: each is saved on its own
                  // and neither ever clears the other (console#590), so the row is the
                  // truth for both.
                  motion_description: scene.motion_description,
                  motion_described_at: scene.motion_described_at,
                }
              : img;
          setImages((prev) => prev.map(patch));
          setFavImages((prev) => prev.map(patch));
          setUntaggedImages((prev) => prev.map(patch));
          setSearchResults((prev) => prev.map(patch));
          setLightboxImage((prev) => (prev && prev.path === path ? patch(prev) : prev));
        })
        .catch((err) => console.error("Failed to read the new description:", err));
    }
  }, []);
  useCaptionDone(onCaptionDone);

  /**
   * Write the pending tag edit now, whatever it was and whichever image it belongs to.
   *
   * The edit is held in a ref, captured at the moment it was made, so this can run after the
   * lightbox has already moved on — the write targets `pending.path`, not whatever is on
   * screen. That is the whole fix for console#435: switching images used to CANCEL the
   * debounced save, so tagging an image and closing the modal inside 500ms silently lost the
   * tags, and with them the description that hangs off the save succeeding.
   */
  const writeTags = ({ path, tags, existingScene }: TagEdit) => {
    updateImageTags(path, tags || null)
      .then(() => {
        const patch = (img: ImageFile) =>
          img.path === path ? { ...img, tags: tags || null } : img;
        setImages((prev) => prev.map(patch));
        setFavImages((prev) => prev.map(patch));
        if (tags.trim()) {
          setUntaggedImages((prev) => prev.filter((img) => img.path !== path));
        } else {
          setUntaggedImages((prev) => prev.map(patch));
        }
        setLightboxImage((prev) => (prev && prev.path === path ? patch(prev) : prev));
        // Tagging an image is the moment someone decided it was worth keeping, so it is the
        // moment to describe it (console#414) -- its SCENE only (console#590): the motion
        // paragraph is minutes of another GPU and waits for an explicit Describe motion or a
        // job that needs it. `existingScene` was captured with the edit
        // rather than read now: by the time this runs the modal may be showing something
        // else entirely, and the question is about the image that was tagged.
        if (
          shouldAutoDescribe({
            tags,
            existing: existingScene,
            inFlight: requestingPaths.current.has(`scene:${path}`)
              || captionPending(captionStatusNow(path, "scene")),
          })
        ) {
          void runDescribe(path, "scene");
        }
      })
      .catch((err) => {
        console.error("Failed to save image tags:", err);
      });
  };

  // The writer is created once; `writeTags` is re-made every render, so it is reached
  // through a ref rather than captured. Otherwise the tag box would be saving through
  // whichever closure happened to exist when the component first mounted.
  const writeTagsRef = useRef(writeTags);
  writeTagsRef.current = writeTags;
  const tagSaveRef = useRef<DeferredWrite<TagEdit> | null>(null);
  if (tagSaveRef.current === null) {
    tagSaveRef.current = createDeferredWrite<TagEdit>(500, (edit) =>
      writeTagsRef.current(edit),
    );
  }
  const tagSave = tagSaveRef.current;

  // Leaving the page mid-edit is the same case as closing the modal mid-edit.
  useEffect(() => () => tagSaveRef.current?.flush(), []);

  const handleTagsChange = (newTags: string) => {
    setLightboxTags(newTags);
    if (!lightboxImage) return;
    // Captured now, not read when the write happens. What is being saved is a decision about
    // THIS image, and the modal may have moved on by then.
    tagSave.schedule({
      path: lightboxImage.path,
      tags: newTags,
      existingScene: lightboxImage.scene_description,
    });
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

  /**
   * The s3:// URIs behind the selected keys.
   *
   * selectedKeys holds bare S3 keys, but everything that leaves this page wants the full URI —
   * `image.path` — and there is no way to build one from a key without knowing the bucket,
   * which the console deliberately does not. So it is looked up across every list that could
   * have produced a selection: select mode survives navigation between views, and a selection
   * made in search and completed in a folder must not silently lose half its images.
   */
  const selectedUris = (): string[] => {
    const byKey = new Map<string, string>();
    for (const list of [images, favImages, untaggedImages, searchResults]) {
      for (const img of list) byKey.set(img.key, img.path);
    }
    return Array.from(selectedKeys)
      .map((k) => byKey.get(k))
      .filter((p): p is string => Boolean(p));
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

  // Look an image up across every view's array, not just `images`. Selection is possible in
  // the untagged and favorites views too, whose items are NOT in `images` — so the old
  // `images.find` skipped them entirely, deleting nothing and updating nothing (#315).
  const findImage = (key: string) =>
    images.find((i) => i.key === key) ??
    untaggedImages.find((i) => i.key === key) ??
    favImages.find((i) => i.key === key) ??
    searchResults.find((i) => i.key === key);

  const bulkTargets = (keys: string[]) =>
    keys.map(findImage).filter((img): img is ImageFile => Boolean(img));

  /** Ask the API which of the selection is in use, before anything is deleted (console#594).
   *  One call for the whole selection; the dialog waits on it. */
  const runBulkCheck = async (keys: string[]) => {
    const seq = ++bulkCheckSeq.current;
    setBulkCheck({ phase: "checking" });
    setBulkAck(false);
    setBulkNotice(null);
    try {
      const inUse = await checkImagesInUse(bulkTargets(keys).map((img) => img.path));
      if (seq === bulkCheckSeq.current) setBulkCheck({ phase: "ready", inUse });
    } catch (e) {
      if (seq === bulkCheckSeq.current) {
        setBulkCheck({ phase: "error", message: apiError(e, "Could not check which images are in use") });
      }
    }
  };

  const handleOpenBulkDelete = (keys: string[]) => {
    setBulkDeleteKeys(keys);
    setBulkDeleteOpen(true);
    void runBulkCheck(keys);
  };

  const closeBulkDelete = () => {
    bulkCheckSeq.current += 1;
    setBulkDeleteOpen(false);
    setBulkCheck(null);
    setBulkNotice(null);
    setBulkAck(false);
  };

  const handleOpenBulkTag = () => {
    // Flush first (never cancel — console#435): a lightbox tag edit still debounced would
    // otherwise land AFTER the bulk write and overwrite this image's whole tag blob.
    tagSaveRef.current?.flush();
    const uris = selectedUris();
    if (uris.length === 0) return;
    setBulkTagUris(uris);
    setBulkTagOpen(true);
  };

  /** One bulk call, one pass over the caches. The result list carries every selected path
   *  with its new tag string, so an in-place patch beats refetching four views. */
  const handleBulkTagDone = (mode: "add" | "remove", results: BulkTagResult[],
                             describing: number) => {
    const byPath = new Map(results.map((r) => [r.path, r.tags]));
    const patch = (img: ImageFile) =>
      byPath.has(img.path) ? { ...img, tags: byPath.get(img.path) ?? null } : img;
    setImages((prev) => prev.map(patch));
    setFavImages((prev) => prev.map(patch));
    setSearchResults((prev) => prev.map(patch));
    if (mode === "add") {
      // The untagged view lists images with no row; anything the add touched has one now.
      setUntaggedImages((prev) => prev.filter((img) => !byPath.has(img.path)));
    } else {
      setUntaggedImages((prev) => prev.map(patch));
      // A remove that emptied the tags also dropped the row (is_empty), UNLESS a scene
      // description kept it. Those emptied-and-descriptionless images belong in the
      // untagged view now; they came from a folder/search/favorites list, not from it.
      const emptied = new Set(results.filter((r) => r.tags === null).map((r) => r.path));
      if (emptied.size > 0) {
        const pool = [...images, ...favImages, ...searchResults];
        const seen = new Set<string>();
        const added: ImageFile[] = [];
        for (const img of pool) {
          if (!emptied.has(img.path) || img.scene_description || seen.has(img.path)) continue;
          if (untaggedImages.some((u) => u.path === img.path)) continue;
          seen.add(img.path);
          added.push({ ...img, tags: null });
        }
        if (added.length > 0) setUntaggedImages((prev) => prev.concat(added));
      }
    }
    setLightboxImage((prev) => (prev && byPath.has(prev.path)
      ? { ...prev, tags: byPath.get(prev.path) ?? null }
      : prev));
    // The census counts images per tag; a bulk add/remove moves those counts now.
    void fetchTagCounts();
    setSelectedKeys(new Set());
    setSelectMode(false);
    setBulkTagOpen(false);
    setBulkTagUris([]);
    const touched = results.filter((r) => r.changed).length;
    const described = describing > 0
      // The server captions serially on a shared GPU, so these land over the next few
      // minutes, not now; the lightbox shows "Asking the captioner..." once they arrive.
      ? ` · describing ${describing} in the background`
      : "";
    setError(`${mode === "add" ? "Added" : "Removed"} tags on ${touched} image${touched === 1 ? "" : "s"}${described}`);
  };

  /**
   * Run the bulk delete the person chose (console#594).
   *
   * "free" deletes only what the pre-check found unheld, without force — so an image that
   * became held since is refused by the API and reported, not deleted. "all" also deletes the
   * held ones with force, exactly as single delete's "Delete anyway" does; before it does, it
   * asks again, and stops if a queued or held job appeared that the person was not shown.
   *
   * Each image is attempted independently. Previously one failure aborted the loop and was
   * swallowed, so images that HAD been deleted stayed on screen, the rest were never tried,
   * and nothing was reported — the view and the bucket silently disagreed.
   */
  const handleBulkDeleteConfirm = async (mode: "free" | "all") => {
    if (bulkDeleteKeys.length === 0 || bulkDeleting) return;
    // After a failed check nothing is known to be held; every delete is unforced, so the API
    // still refuses anything in use and the summary says which.
    let inUse: InUseMap = bulkCheck?.phase === "ready" ? bulkCheck.inUse : {};
    const targets = bulkTargets(bulkDeleteKeys);
    const { held } = splitSelection(targets.map((t) => t.path), inUse);
    setBulkDeleting(true);
    setBulkNotice(null);
    try {
      if (mode === "all" && held.length > 0) {
        let fresh: InUseMap;
        try {
          fresh = await checkImagesInUse(held);
        } catch (e) {
          setBulkNotice(apiError(e, "Could not re-check before deleting; nothing was deleted"));
          return;
        }
        const added = newlyNeeded(inUse, fresh, held);
        inUse = { ...inUse, ...fresh };
        if (added.length > 0) {
          // The acknowledgement covered what was on screen. Show the new list and ask again
          // rather than break a job nobody saw.
          setBulkCheck({ phase: "ready", inUse });
          setBulkAck(false);
          setBulkNotice(
            `Since this opened, ${added.map((h) => h.label).join(", ")} started needing ` +
              `${added.length === 1 ? "one of these images" : "these images"}. Nothing was ` +
              "deleted — review and confirm again.",
          );
          return;
        }
      }

      const outcomes: DeleteOutcome[] = [];
      let skipped = 0;
      for (const img of targets) {
        const isHeld = !!inUse[img.path];
        if (isHeld && mode === "free") {
          skipped += 1;
          continue;
        }
        try {
          await deleteImage(img.path, isHeld && mode === "all");
          outcomes.push({ path: img.path, filename: img.filename, error: null });
        } catch (e) {
          outcomes.push({ path: img.path, filename: img.filename, error: deleteFailureReason(e) });
        }
      }

      const deleted = new Set(
        outcomes.filter((o) => o.error === null).map((o) => o.path),
      );
      const wasDeleted = (img: ImageFile) => deleted.has(img.path);
      setImages((prev) => prev.filter((img) => !wasDeleted(img)));
      setUntaggedImages((prev) => prev.filter((img) => !wasDeleted(img)));
      setFavImages((prev) => prev.filter((img) => !wasDeleted(img)));
      setSearchResults((prev) => {
        const next = prev.filter((img) => !wasDeleted(img));
        setSearchTotal((t) => Math.max(0, t - (prev.length - next.length)));
        return next;
      });
      if (lightboxImage && deleted.has(lightboxImage.path)) {
        setLightboxImage(null);
      }
      setSelectedKeys(new Set());
      setSelectMode(false);
      setBulkDeleteKeys([]);

      const summary = summarizeBulkDelete(outcomes, skipped);
      if (summary.failures.length > 0) {
        // Leave the dialog up with every failure and its reason; a snackbar would truncate.
        setBulkCheck({ phase: "done", failures: summary.failures, message: summary.message });
      } else {
        closeBulkDelete();
        setError(summary.message);
      }
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
      {bulkTagOpen && (
        <BulkTagDialog
          imageUris={bulkTagUris}
          tagCounts={tagCounts}
          onClose={() => setBulkTagOpen(false)}
          onDone={handleBulkTagDone}
        />
      )}
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
                {lightboxPosition && lightboxPosition.index !== null && lightboxPosition.total > 1
                  ? ` — ${lightboxPosition.index + 1} of ${lightboxPosition.total}`
                  : ""}
                {/* Left the list while on screen (tagged out of Untagged): say what is left. */}
                {lightboxPosition && lightboxPosition.index === null
                  ? ` — ${lightboxPosition.total} more in this view`
                  : ""}
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
                    position: "relative",
                  }}
                >
                  {/* Edge arrows (console#522) flank the photo itself — inside the
                      image pane, never over the tag/jobs panel — and only appear
                      while there is an image to step to in that direction. */}
                  {lightboxPosition && (
                    <>
                      {lightboxPosition.prev !== null && (
                        <IconButton
                          aria-label="Previous image"
                          onClick={() => stepLightbox(-1)}
                          sx={{
                            position: "absolute",
                            top: "50%",
                            left: 4,
                            color: "white",
                            bgcolor: "rgba(0,0,0,0.45)",
                            "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
                          }}
                        >
                          <ChevronLeft />
                        </IconButton>
                      )}
                      {lightboxPosition.next !== null && (
                        <IconButton
                          aria-label="Next image"
                          onClick={() => stepLightbox(1)}
                          sx={{
                            position: "absolute",
                            top: "50%",
                            right: 4,
                            color: "white",
                            bgcolor: "rgba(0,0,0,0.45)",
                            "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
                          }}
                        >
                          <ChevronRight />
                        </IconButton>
                      )}
                    </>
                  )}
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
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      Tags
                    </Typography>
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

                  {/* Scene description (console#414, moved below the tags in #443).
                      Shown for every image, tagged or not: this block is where a
                      description lives, and gating the re-roll behind "must be tagged
                      first" would be an arbitrary rule about a button. */}
                  <Box component="hr" sx={{ my: 2, borderColor: "divider" }} />
                  <Box>
                    {(() => {
                      // One status pill per half is the only "in progress" indicator
                      // (console#590): the buttons disable while their half is in flight,
                      // and nothing else spins or relabels.
                      const [sceneAct, motionAct] = halfActions({
                        scene: lightboxImage.scene_description,
                        motion: lightboxImage.motion_description,
                        sceneStatus: lightboxScene,
                        motionStatus: lightboxMotion,
                      });
                      const halfButton = (act: typeof sceneAct) => (
                        <span title={act.why ?? undefined}>
                          <Button
                            size="small"
                            onClick={() => runDescribe(lightboxImage.path, act.half)}
                            disabled={act.disabled}
                          >
                            {act.label}
                          </Button>
                        </span>
                      );
                      const failed = (s: typeof lightboxScene) => s?.state === "failed" && (
                        <Alert
                          severity="warning"
                          sx={{ mt: 1 }}
                          action={
                            <Button color="inherit" size="small"
                                    onClick={() => runDescribe(lightboxImage.path, s.half)}>
                              Retry
                            </Button>
                          }
                        >
                          The last {s.half} caption failed: {s.error ?? "no reason given"}
                        </Alert>
                      );
                      const motionAsker = requestedByNote(lightboxMotion);
                      return (
                        <>
                          <Stack direction="row" alignItems="center" spacing={1}
                                 useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                              Scene description
                            </Typography>
                            <CaptionStatusChip path={lightboxImage.path} half="scene" />
                            {halfButton(sceneAct)}
                          </Stack>
                          {lightboxImage.scene_description ? (
                            <>
                              <Typography variant="body2">
                                {lightboxImage.scene_description}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {lightboxImage.scene_description.trim().split(/\s+/).length} words
                                {lightboxImage.scene_described_at
                                  ? ` \u2014 ${new Date(lightboxImage.scene_described_at).toLocaleString()}`
                                  : ""}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Not described yet. Tagging this image describes its scene
                              automatically.
                            </Typography>
                          )}
                          {failed(lightboxScene)}

                          {/* The motion half (#326): the frame read as a 10-second clip,
                              grounded on the SAVED scene. Its own caption since console#590 --
                              made only on an explicit click or a held job's need. */}
                          <Stack direction="row" alignItems="center" spacing={1}
                                 useFlexGap flexWrap="wrap" sx={{ mt: 2, mb: 0.5 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                              Motion
                            </Typography>
                            <CaptionStatusChip path={lightboxImage.path} half="motion" />
                            {halfButton(motionAct)}
                          </Stack>
                          {lightboxImage.motion_description ? (
                            <>
                              <Typography variant="body2" fontStyle="italic">
                                {lightboxImage.motion_description}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {lightboxImage.motion_description.trim().split(/\s+/).length} words
                                {lightboxImage.motion_described_at
                                  ? ` \u2014 ${new Date(lightboxImage.motion_described_at).toLocaleString()}`
                                  : ""}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No motion caption. Describe motion makes one from the scene.
                            </Typography>
                          )}
                          {motionAsker && (
                            <Typography variant="caption" color="text.secondary" component="div">
                              {motionAsker}
                            </Typography>
                          )}
                          {motionNeedsRegrounding(lightboxImage) && !captionPending(lightboxMotion) && (
                            <Alert severity="info" sx={{ mt: 1 }}>
                              {REGROUND_HINT}.
                            </Alert>
                          )}
                          {failed(lightboxMotion)}
                        </>
                      );
                    })()}
                    {sceneError?.path === lightboxImage.path && (
                      <Alert
                        severity="warning"
                        sx={{ mt: 1 }}
                        onClose={() => setSceneError(null)}
                      >
                        {sceneError.message}
                      </Alert>
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
                startIcon={isMobile ? undefined : <Face />}
                size={btnSize}
                onClick={() => {
                  setEditImage(lightboxImage);
                  setLightboxImage(null);
                }}
              >
                Edit
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
        onClose={() => !deleting && setDeleteConfirm(null)}
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
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => handleDeleteConfirm()}
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Folder delete: everything in the directory is deleted and unrecoverable (wanly-api#311). */}
      <Dialog
        open={!!folderDelete}
        onClose={() => setFolderDelete(null)}
        fullScreen={isMobile}
      >
        <DialogTitle>Delete Folder?</DialogTitle>
        <DialogContent>
          {folderDelete?.conflict ? (
            <>
              <Typography variant="body2" gutterBottom>
                <strong>{folderDelete.conflict.referencedCount}</strong> of{" "}
                <strong>{folderDelete.conflict.imageCount}</strong> images in{" "}
                <strong>{folderDelete.name}</strong> are still referenced. Deleting anyway
                leaves those pointing at files that no longer exist.
              </Typography>
              {Object.entries(folderDelete.conflict.paths).slice(0, 5).map(([path, holders]) => (
                <Typography key={path} variant="caption" sx={{ display: "block", wordBreak: "break-all" }}>
                  {path.split("/").pop()} — {holders.jobIds.length} job(s), {holders.segmentIds.length} segment(s), {holders.datasetIds.length} dataset(s)
                </Typography>
              ))}
              {Object.keys(folderDelete.conflict.paths).length > 5 && (
                <Typography variant="caption" color="text.secondary">
                  …and {Object.keys(folderDelete.conflict.paths).length - 5} more
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 2 }}>
                Are you sure? This cannot be undone.
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" gutterBottom>
                All items in <strong>{folderDelete?.name}</strong> will be deleted. This
                cannot be undone — anything still referencing these images will 404 when a
                worker picks it up.
              </Typography>
              <Typography variant="body2">Are you sure?</Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => handleFolderDeleteConfirm(!!folderDelete?.conflict)}
          >
            {folderDelete?.conflict ? "Delete Anyway" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Refused: something still points at this image (wanly-api#156). */}
      <Dialog open={!!inUse} onClose={() => !deleting && setInUse(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Image is still in use</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            <strong>{inUse?.image.filename}</strong> is referenced by{" "}
            <strong>{inUse ? describeHolders(inUse.conflict) : ""}</strong>.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Deleting it anyway leaves those pointing at a file that no longer exists. They will
            fail when a worker picks them up, which is how images went missing before — and a
            dataset keeps a dead entry in its list, so its count lies and training fetches a 404
            (wanly-api#305).
          </Typography>
          {!!inUse?.conflict.jobIds.length && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Jobs
              </Typography>
              {inUse.conflict.jobIds.slice(0, 5).map((id) => (
                <Typography
                  key={id}
                  variant="body2"
                  sx={{ cursor: "pointer", color: "primary.main", wordBreak: "break-all" }}
                  onClick={() => navigate(`/jobs/${id}`)}
                >
                  {id}
                </Typography>
              ))}
              {inUse.conflict.jobIds.length > 5 && (
                <Typography variant="caption" color="text.secondary">
                  …and {inUse.conflict.jobIds.length - 5} more
                </Typography>
              )}
            </Box>
          )}
          {!!inUse?.conflict.datasetIds.length && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Datasets
              </Typography>
              {inUse.conflict.datasetIds.slice(0, 5).map((id) => (
                <Typography
                  key={id}
                  variant="body2"
                  sx={{ cursor: "pointer", color: "primary.main", wordBreak: "break-all" }}
                  onClick={() => navigate("/datasets")}
                >
                  {id}
                </Typography>
              ))}
              {inUse.conflict.datasetIds.length > 5 && (
                <Typography variant="caption" color="text.secondary">
                  …and {inUse.conflict.datasetIds.length - 5} more
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInUse(null)} disabled={deleting}>Keep it</Button>
          <Button color="error" onClick={() => handleDeleteConfirm(true)} disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : "Delete anyway"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        message={error ?? ""}
      />

      {/* Bulk delete: pre-checked, so in-use images are named before anything goes (console#594). */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => !bulkDeleting && closeBulkDelete()}
        fullScreen={isMobile}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {bulkCheck?.phase === "done" ? "Some images were not deleted" : "Delete Images?"}
        </DialogTitle>
        <DialogContent>
          {bulkNotice && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {bulkNotice}
            </Alert>
          )}
          {(!bulkCheck || bulkCheck.phase === "checking") && (
            <Stack direction="row" spacing={2} alignItems="center">
              <CircularProgress size={20} />
              <Typography variant="body2">
                Checking which of the {bulkDeleteKeys.length} selected image
                {bulkDeleteKeys.length === 1 ? " is" : "s are"} in use…
              </Typography>
            </Stack>
          )}
          {bulkCheck?.phase === "error" && (
            <>
              <Alert severity="error" sx={{ mb: 2 }}>
                {bulkCheck.message}
              </Alert>
              <Typography variant="body2">
                You can still delete the selection without force: the API refuses any image that
                is in use, and the result lists each one it kept.
              </Typography>
            </>
          )}
          {bulkCheck?.phase === "done" && (
            <>
              <Typography variant="body2" gutterBottom>
                {bulkCheck.message}.
              </Typography>
              {bulkCheck.failures.map((f) => (
                <Stack key={f.path} direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.75 }}>
                  <Box
                    component="img"
                    src={getFileUrl(f.path)}
                    alt={f.filename}
                    sx={{ width: 48, height: 48, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{f.filename}</Typography>
                    <Typography variant="caption" color="error">{f.error}</Typography>
                  </Box>
                </Stack>
              ))}
            </>
          )}
          {bulkCheck?.phase === "ready" && (() => {
            const targets = bulkTargets(bulkDeleteKeys);
            const { free, held } = splitSelection(targets.map((t) => t.path), bulkCheck.inUse);
            if (held.length === 0) {
              return (
                <Typography>
                  None of the selected images are in use. Delete{" "}
                  <strong>{free.length} image{free.length === 1 ? "" : "s"}</strong>? This cannot be
                  undone.
                </Typography>
              );
            }
            const needed = neededHolders(bulkCheck.inUse, held);
            const byPath = new Map(targets.map((t) => [t.path, t]));
            return (
              <>
                <Typography variant="body2" gutterBottom>
                  <strong>{held.length}</strong> of <strong>{targets.length}</strong> selected
                  image{targets.length === 1 ? " is" : "s are"} in use.
                </Typography>
                <Box sx={{ maxHeight: 320, overflowY: "auto", my: 1 }}>
                  {held.map((path) => {
                    const h = bulkCheck.inUse[path];
                    const img = byPath.get(path);
                    return (
                      <Stack key={path} direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 0.75 }}>
                        <Box
                          component="img"
                          src={getFileUrl(path)}
                          alt={img?.filename ?? ""}
                          sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                            {img?.filename ?? path.split("/").pop()}{" "}
                            <Typography component="span" variant="caption" color="text.secondary">
                              — {describeImageHolders(h)}
                            </Typography>
                          </Typography>
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                            {h.datasets.map((d) => (
                              <Chip
                                key={`d-${d.id}`}
                                size="small"
                                variant="outlined"
                                label={`dataset: ${d.name}`}
                                onClick={() => navigate(`/datasets?dataset=${d.id}`)}
                              />
                            ))}
                            {h.jobs.map((j) => (
                              <Chip
                                key={`j-${j.id}`}
                                size="small"
                                variant="outlined"
                                color={j.state === "idle" ? "default" : "warning"}
                                label={`job: ${j.name || j.id.slice(0, 8)} (${j.status})`}
                                onClick={() => navigate(`/jobs/${j.id}`)}
                              />
                            ))}
                            {h.segments.map((sg) => (
                              <Chip
                                key={`s-${sg.id}`}
                                size="small"
                                variant="outlined"
                                color={sg.state === "idle" ? "default" : "warning"}
                                label={`segment ${sg.index + 1} of ${sg.jobName || sg.jobId.slice(0, 8)} (${sg.status.replace(/_/g, " ")})`}
                                onClick={() => navigate(`/jobs/${sg.jobId}`)}
                              />
                            ))}
                            {h.trainings.map((t) => (
                              <Chip
                                key={`t-${t.id}`}
                                size="small"
                                variant="outlined"
                                color={t.state === "idle" ? "default" : "warning"}
                                label={`training: ${t.character}${t.version != null ? ` v${t.version}` : ""} (${t.status})`}
                                onClick={() => navigate("/training")}
                              />
                            ))}
                          </Stack>
                          {h.needed && (
                            <Typography variant="caption" color="warning.main">
                              A queued or held job still needs this image.
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    );
                  })}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  <strong>Delete the free ones</strong> deletes the other {free.length} and keeps
                  every image above. <strong>Delete all</strong> forces the in-use ones too, as
                  single delete&apos;s &ldquo;Delete anyway&rdquo; does: the image&apos;s dataset
                  captions and scores go, each dataset keeps a dead entry in its list (its count
                  lies and training fetches a 404), and any job pointing at the file fails when a
                  worker picks it up. This cannot be undone.
                </Typography>
                {needed.length > 0 && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    <Typography variant="body2" gutterBottom>
                      Delete all will break {needed.length} queued or held
                      {needed.length === 1 ? " job" : " jobs"}:
                    </Typography>
                    {needed.map((n) => (
                      <Box key={`${n.kind}-${n.id}`}>
                        <Link
                          component="button"
                          variant="body2"
                          onClick={() => navigate(n.jobId ? `/jobs/${n.jobId}` : "/training")}
                          sx={{ textAlign: "left", wordBreak: "break-all" }}
                        >
                          {n.label}
                        </Link>
                      </Box>
                    ))}
                    <FormControlLabel
                      sx={{ mt: 1 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={bulkAck}
                          onChange={(e) => setBulkAck(e.target.checked)}
                        />
                      }
                      label={`I understand ${needed.length === 1 ? "this" : "these"} will fail`}
                    />
                  </Alert>
                )}
              </>
            );
          })()}
        </DialogContent>
        <DialogActions>
          {bulkCheck?.phase === "done" ? (
            <Button onClick={closeBulkDelete}>Close</Button>
          ) : (
            <>
              <Button onClick={closeBulkDelete} disabled={bulkDeleting}>
                Cancel
              </Button>
              {bulkCheck?.phase === "error" && (
                <>
                  <Button onClick={() => void runBulkCheck(bulkDeleteKeys)} disabled={bulkDeleting}>
                    Check again
                  </Button>
                  <Button
                    color="error"
                    variant="contained"
                    onClick={() => handleBulkDeleteConfirm("free")}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? <CircularProgress size={20} /> : "Delete, skipping any in use"}
                  </Button>
                </>
              )}
              {bulkCheck?.phase === "ready" && (() => {
                const targets = bulkTargets(bulkDeleteKeys);
                const { free, held } = splitSelection(targets.map((t) => t.path), bulkCheck.inUse);
                const needsAck = neededHolders(bulkCheck.inUse, held).length > 0;
                if (held.length === 0) {
                  return (
                    <Button
                      color="error"
                      variant="contained"
                      onClick={() => handleBulkDeleteConfirm("free")}
                      disabled={bulkDeleting || free.length === 0}
                    >
                      {bulkDeleting ? <CircularProgress size={20} /> : `Delete ${free.length} image${free.length === 1 ? "" : "s"}`}
                    </Button>
                  );
                }
                return (
                  <>
                    <Button
                      color="error"
                      onClick={() => handleBulkDeleteConfirm("all")}
                      disabled={bulkDeleting || (needsAck && !bulkAck)}
                    >
                      {`Delete all ${targets.length}`}
                    </Button>
                    <Button
                      color="error"
                      variant="contained"
                      onClick={() => handleBulkDeleteConfirm("free")}
                      disabled={bulkDeleting || free.length === 0}
                    >
                      {bulkDeleting ? <CircularProgress size={20} /> : `Delete the ${free.length} free`}
                    </Button>
                  </>
                );
              })()}
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Move to Folder Dialog */}
      {addToDatasetOpen && (
        <AddToDatasetDialog
          imageUris={selectedUris()}
          onClose={() => setAddToDatasetOpen(false)}
          onAdded={() => {
            setSelectMode(false);
            setSelectedKeys(new Set());
            navigate("/datasets");
          }}
        />
      )}

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

      <ImageEditDialog
        open={!!editImage}
        sourceUri={editImage?.path ?? null}
        onClose={() => setEditImage(null)}
        // A repo edit lands beside its original, so the open folder is the one to re-read.
        onSaved={(r) => { if (!r.dataset_id && currentFolder) fetchImages(currentFolder); }}
      />

      {/* Create Job Dialog */}
      <CreateLtxJobDialog
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
        initialTags={jobDialogImageTags}
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
              setUntaggedView(false);
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
          <Button
            variant={untaggedView ? "contained" : "outlined"}
            color={untaggedView ? "warning" : "inherit"}
            startIcon={isMobile ? undefined : <LabelOff />}
            size={isMobile ? "small" : "medium"}
            onClick={async () => {
              if (untaggedView) {
                setUntaggedView(false);
                return;
              }
              setFavoritesView(false);
              setUntaggedView(true);
              setLoadingUntagged(true);
              try {
                const imgs = await getUntaggedImages();
                setUntaggedImages(imgs);
              } catch {
                // ignore
              } finally {
                setLoadingUntagged(false);
              }
            }}
          >
            {isMobile ? "Untag" : "Untagged"}
          </Button>
          {(favoritesView && favImages.length > 0) || (filterActive && searchResults.length > 0) ? (
            <Button
              variant="outlined"
              startIcon={isMobile ? undefined : <PlayArrow />}
              size={isMobile ? "small" : "medium"}
              onClick={() => {
                const pool = filterActive ? searchResults : favImages;
                handleOpenScreensaver(pool);
              }}
          >
            {isMobile ? "Play" : "Play"}
          </Button>
        ) : null}
          {/* Selection on the untagged queue (#519): the cards already render checkboxes in
              selectMode; this is the affordance that turns them on, plus the two actions that
              resolve a selection. Tag covers both directions — #518's dialog has Remove. */}
          {untaggedView && untaggedImages.length > 0 && (
            <>
              {selectMode && selectedKeys.size > 0 && (
                <>
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
                  <Button
                    variant="outlined"
                    startIcon={isMobile ? undefined : <LocalOffer />}
                    size={isMobile ? "small" : "medium"}
                    onClick={handleOpenBulkTag}
                  >
                    {isMobile
                      ? `Tag (${selectedKeys.size})`
                      : `Tag ${selectedKeys.size} image${selectedKeys.size > 1 ? "s" : ""}`}
                  </Button>
                </>
              )}
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
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            placeholder="Search by filename or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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

        <TagFilterBar
          counts={tagCounts}
          selected={selectedTags}
          onToggle={(tag) => setSelectedTags(toggleTag(selectedTags, tag))}
          onClear={() => setSelectedTags([])}
        />

        {filterActive && (
          <>
            {searchLoading && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <Box sx={{ textAlign: "center", py: 8 }}>
                <Typography color="text.secondary">
                  No images match {filterLabel}.
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
                          <Box sx={{ position: "relative" }}>
                            <CaptionStatusChip path={image.path} overlay />
                          </Box>
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
                  onPageChange={(_, p) => setQuery({ spage: pageValue(p) })}
                  rowsPerPage={searchRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setQuery({
                      sper: perPageValue(parseInt(e.target.value, 10), DEFAULT_IMAGE_ROWS),
                      spage: null,
                    });
                  }}
                  rowsPerPageOptions={IMAGE_ROWS_OPTIONS}
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

        {!filterActive && (
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
                          <Box sx={{ position: "relative" }}>
                            <CaptionStatusChip path={image.path} overlay />
                          </Box>
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

        {untaggedView && (
          <>
            {loadingUntagged && (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {!loadingUntagged && untaggedImages.length === 0 && (
              <Box sx={{ textAlign: "center", py: 8 }}>
                <Typography color="text.secondary">
                  No untagged images — all caught up!
                </Typography>
              </Box>
            )}
            {untaggedImages.length > 0 && (
              <Grid container spacing={2}>
                {untaggedImages.map((image) => (
                  <Grid key={image.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                    <Card sx={{ position: "relative" }}>
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
                        <Box sx={{ position: "relative" }}>
                          <CaptionStatusChip path={image.path} overlay />
                        </Box>
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
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </>
        )}

        {!favoritesView && !untaggedView && folders.length === 0 && !loading && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography color="text.secondary">
              No image folders found.
            </Typography>
          </Box>
        )}

        {!favoritesView && !untaggedView && (
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
                  <Box sx={{ p: 1.5, display: "flex", alignItems: "center" }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
                      {folder.name}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={`Delete folder ${folder.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderDelete({ name: folder.name, conflict: null });
                      }}
                      sx={{ opacity: isMobile ? 1 : 0.5, "&:hover": { opacity: 1 } }}
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
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
            onPageChange={(_, p) => setQuery({ fpage: pageValue(p) })}
            rowsPerPage={foldersPerPage}
            onRowsPerPageChange={(e) => {
              setQuery({
                fper: perPageValue(parseInt(e.target.value, 10), DEFAULT_FOLDER_ROWS),
                fpage: null,
              });
            }}
            rowsPerPageOptions={FOLDER_ROWS_OPTIONS}
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
          placeholder="Search by filename or description…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
          {/* The one link from the repo to training, and it goes one way: images become
              part of a dataset, and training happens from the dataset (#464). */}
          <Button
            variant="contained"
            color="secondary"
            startIcon={isMobile ? undefined : <PhotoLibrary />}
            size={isMobile ? "small" : "medium"}
            onClick={() => setAddToDatasetOpen(true)}
          >
            {isMobile
              ? `Dataset (${selectedKeys.size})`
              : `Add ${selectedKeys.size} to a dataset`}
          </Button>
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
          <Button
            variant="outlined"
            startIcon={isMobile ? undefined : <LocalOffer />}
            size={isMobile ? "small" : "medium"}
            onClick={handleOpenBulkTag}
          >
            {isMobile ? `Tag (${selectedKeys.size})` : `Tag ${selectedKeys.size} image${selectedKeys.size > 1 ? "s" : ""}`}
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
            setQuery({ ipage: null });
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
            setQuery({ fav: favoritesOnly ? null : "1", ipage: null });
          }}
        >
          {isMobile ? (favoritesOnly ? "Fav" : "Fav") : "Favorites"}
        </Button>
        <Button
          variant="outlined"
          startIcon={isMobile ? undefined : <PlayArrow />}
          size={isMobile ? "small" : "medium"}
          disabled={
            !filterActive && images.length === 0 ||
            filterActive && searchResults.length === 0 ||
            favoritesOnly && !images.some((img) => favoritesSet.has(img.path))
          }
          onClick={() => {
            let pool: ImageFile[];
            if (filterActive) {
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
        {/* The captioner's queue, in the toolbar rather than inside one image's modal: the
            per-image position only existed for an image you had already opened, which is no
            answer to "how is the queue looking?". Renders nothing when idle. */}
        <CaptionQueueChip />
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

      <TagFilterBar
        counts={tagCounts}
        selected={selectedTags}
        onToggle={(tag) => setSelectedTags(toggleTag(selectedTags, tag))}
        onClear={() => setSelectedTags([])}
      />

      {filterActive && (
        <>
          {searchLoading && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <Box sx={{ textAlign: "center", py: 8 }}>
              <Typography color="text.secondary">
                No images match {filterLabel}.
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
                        <Box sx={{ position: "relative" }}>
                          <CaptionStatusChip path={image.path} overlay />
                        </Box>
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
                onPageChange={(_, p) => setQuery({ spage: pageValue(p) })}
                rowsPerPage={searchRowsPerPage}
                onRowsPerPageChange={(e) => {
                  setQuery({
                    sper: perPageValue(parseInt(e.target.value, 10), DEFAULT_IMAGE_ROWS),
                    spage: null,
                  });
                }}
                rowsPerPageOptions={IMAGE_ROWS_OPTIONS}
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

      {!filterActive && (
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
                <Box sx={{ position: "relative" }}>
                  <CaptionStatusChip path={image.path} overlay />
                </Box>
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
          onPageChange={(_, p) => setQuery({ ipage: pageValue(p) })}
          rowsPerPage={imagesPerPage}
          onRowsPerPageChange={(e) => {
            setQuery({
              iper: perPageValue(parseInt(e.target.value, 10), DEFAULT_IMAGE_ROWS),
              ipage: null,
            });
          }}
          rowsPerPageOptions={IMAGE_ROWS_OPTIONS}
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
