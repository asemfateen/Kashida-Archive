import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  batchDelete,
  batchUpdate,
  searchImages,
  tagImage,
  updateImage,
} from "../api.js";
import { mergeTags } from "../tags.js";
import { makeThumbnail } from "../thumbnail.js";
import { pushError } from "../notify.jsx";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

function loadPrompt() {
  try {
    return localStorage.getItem("masterPrompt") || DEFAULT_PROMPT;
  } catch {
    return DEFAULT_PROMPT;
  }
}

export default function Dashboard({
  images,
  loading,
  loadError,
  onRetry,
  activeFilter,
  onFilter,
  onOpenImage,
  onOpenList,
  onUpload,
  searchQuery = null,
  onFavorite,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
  onChanged,
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [tagModal, setTagModal] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  const [tagFailures, setTagFailures] = useState([]);
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem("kashida_right_panel_collapsed") !== "0",
  );
  const searchRef = useRef(null);
  const searchIdRef = useRef(0);
  const navigate = useNavigate();

  const clearSearch = () => {
    searchIdRef.current += 1;
    setResults(null);
    setQuery("");
    setSearching(false);
    navigate("/", { replace: true });
    onFilter("all");
  };

  const toggleRight = () => {
    setRightCollapsed((prev) => {
      localStorage.setItem("kashida_right_panel_collapsed", prev ? "0" : "1");
      return !prev;
    });
  };

  const toggleSelect = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };

  const runBatch = async (action) => {
    const keys = [...selected];
    if (keys.length === 0) return;
    if (
      action === "deleteForever" &&
      !window.confirm(
        `Permanently delete ${keys.length} photo${keys.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    try {
      if (action === "trash") await batchUpdate(keys, { deleted: true });
      else if (action === "restore")
        await batchUpdate(keys, { deleted: false });
      else if (action === "deleteForever") await batchDelete(keys);
      clearSelection();
      showToast(`Moved ${keys.length} photo${keys.length === 1 ? "" : "s"}`);
      onChanged?.();
    } catch (err) {
      pushError(err?.message || "Could not update selection");
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runSearch = async (e, forcedQuery) => {
    if (e) e.preventDefault();
    const q = (forcedQuery ?? query).trim();
    if (!q) {
      setResults(null);
      return;
    }
    const id = ++searchIdRef.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchImages(q);
      if (id === searchIdRef.current) {
        setResults(res);
        setSearchError(null);
      }
    } catch (err) {
      if (id === searchIdRef.current) {
        setResults([]);
        setSearchError(err?.message || "Search failed");
      }
    } finally {
      if (id === searchIdRef.current) setSearching(false);
    }
  };

  const baseItems = results === null ? images : results;

  const galleryItems = baseItems;

  const count = galleryItems.length;

  const handleFavorite = async (image) => {
    try {
      const row = await onFavorite(image);
      setResults((prev) =>
        prev
          ? prev.map((img) =>
              img.object_key === row.object_key ? { ...img, ...row } : img,
            )
          : prev,
      );
    } catch (err) {
      pushError(err?.message || "Could not update favorite");
    }
  };

  const selectedItems = () =>
    galleryItems.filter((i) => selected.has(i.object_key));

  const closeTagModal = () => {
    if (aiBusy) return;
    setTagModal(false);
    setManualInput("");
    setTagFailures([]);
  };

  const finishTagging = (okCount, failCount) => {
    if (failCount > 0) {
      showToast(
        `Tagged ${okCount} photo${okCount === 1 ? "" : "s"}, ${failCount} failed`,
      );
    } else {
      showToast(`Tagged ${okCount} photo${okCount === 1 ? "" : "s"}`);
      clearSelection();
      setTagModal(false);
    }
    onChanged?.();
  };

  const runAITag = async () => {
    const items = selectedItems();
    if (items.length === 0) return;
    if (
      !window.confirm(
        `AI-tag ${items.length} photo${items.length === 1 ? "" : "s"} with Gemini? This may take a moment.`,
      )
    )
      return;
    const prompt = loadPrompt();
    setAiBusy(true);
    setTagFailures([]);
    let done = 0;
    let failed = 0;
    for (const item of items) {
      const label = item.caption || item.original_filename || item.object_key;
      try {
        let thumbnail = null;
        try {
          thumbnail = await makeThumbnail(item.thumb || item.src);
        } catch {
          thumbnail = null;
        }
        const payload = thumbnail
          ? { objectKey: item.object_key, thumbnail, prompt }
          : {
              objectKey: item.object_key,
              imageUrl: item.thumb || item.src,
              prompt,
            };
        await tagImage(payload);
      } catch (err) {
        failed += 1;
        const msg = err?.message || "AI tagging failed";
        setTagFailures((prev) => [...prev, { label, message: msg }]);
        pushError(`${label}: ${msg}`);
      }
      done += 1;
      setAiProgress({ done, total: items.length });
    }
    setAiBusy(false);
    setAiProgress(null);
    finishTagging(items.length - failed, failed);
  };

  const parseManualTags = (value) =>
    value
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);

  const runManualTag = async () => {
    const tags = parseManualTags(manualInput);
    const items = selectedItems();
    if (items.length === 0) return;
    if (tags.length === 0) {
      pushError("Enter at least one tag first");
      return;
    }
    setAiBusy(true);
    setTagFailures([]);
    let done = 0;
    let failed = 0;
    for (const item of items) {
      const label = item.caption || item.original_filename || item.object_key;
      try {
        const merged = mergeTags(item.tags || "", tags);
        await updateImage(item.object_key, { tags: merged.join(" ") });
        done += 1;
      } catch (err) {
        failed += 1;
        const msg = err?.message || "Could not save tags";
        setTagFailures((prev) => [...prev, { label, message: msg }]);
        pushError(`${label}: ${msg}`);
      }
    }
    setAiBusy(false);
    setManualInput("");
    finishTagging(done, failed);
  };

  const addQuickTag = (tag) => {
    setManualInput((prev) => {
      const existing = parseManualTags(prev);
      if (existing.includes(tag)) return prev;
      return existing.length ? `${prev}, ${tag}` : tag;
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(galleryItems, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kashida-archive-${activeFilter}-${Date.now()}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${count} assets`);
  };

  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  };

  // Changing library filter (via the shared side panel) clears any in-page
  // quick search so the grid reflects the selected view.
  useEffect(() => {
    searchIdRef.current += 1;
    setResults(null);
    setQuery("");
    setSearching(false);
    setSelected(new Set());
    setSelectMode(false);
  }, [activeFilter]);

  // Run the search coming from the taskbar (/?q=...) inside the home grid.
  useEffect(() => {
    const q = typeof searchQuery === "string" ? searchQuery.trim() : "";
    if (q) {
      setQuery(q);
      runSearch(null, q);
    } else {
      setResults(null);
      setQuery("");
      searchIdRef.current += 1;
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const tagCounts = new Map();
  for (const img of images) {
    for (const tag of (img.tags || "").split(" ").filter(Boolean)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const recentTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const normalize = (image) => ({
    ...image,
    src: image.url || image.src,
    thumb: image.thumb || image.url || image.src,
    category:
      image.category || (image.tags || "").split(" ")[0]?.toUpperCase() || "",
    caption: image.caption || image.original_filename,
    meta: image.meta || (image.created_at || "").slice(0, 10),
  });

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Canvas */}
        <main className="flex-1 bg-background overflow-y-auto flex flex-col relative">
          {/* Asset Grid */}
          <div className="p-margin-page pb-24">
            {selectMode ? (
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <p className="font-body-md text-body-md text-on-surface">
                  <span className="font-label-caps text-label-caps text-primary">
                    {selected.size} selected
                  </span>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {activeFilter === "trash" ? (
                    <>
                      <button
                        onClick={() => runBatch("restore")}
                        className="bg-surface-container-high text-primary font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-surface-variant transition-colors border border-black/5"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => runBatch("deleteForever")}
                        className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-error hover:text-on-error transition-colors"
                      >
                        Delete forever
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setTagModal(true)}
                        disabled={aiBusy}
                        className="bg-midnight-ink text-white font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-prussian-navy transition-colors disabled:opacity-50"
                        title="Tag the selected photos with AI or manually"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[18px]">
                            sell
                          </span>
                          Tag
                        </span>
                      </button>
                      <button
                        onClick={() => runBatch("trash")}
                        className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-error hover:text-on-error transition-colors"
                      >
                        Move to Trash
                      </button>
                    </>
                  )}
                  <button
                    onClick={clearSelection}
                    className="bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-surface-variant transition-colors border border-black/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-8">
                <button
                  onClick={() => setSelectMode(true)}
                  className="flex items-center gap-2 bg-midnight-ink text-white px-5 py-2.5 rounded-full hover:bg-prussian-navy transition-colors text-sm font-medium shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    check_box
                  </span>
                  Select
                </button>
                <span className="text-on-surface-variant font-mono-data text-mono-data">
                  {count.toLocaleString()} Results
                </span>
              </div>
            )}
            {activeFilter === "trash" && galleryItems.length > 0 && (
              <div className="flex items-center justify-between mb-4">
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {galleryItems.length} item
                  {galleryItems.length === 1 ? "" : "s"} in trash
                </p>
                <button
                  onClick={onEmptyTrash}
                  className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-full hover:bg-error hover:text-on-error transition-colors"
                >
                  Empty Trash
                </button>
              </div>
            )}
            {searchError && (
              <div className="flex items-center gap-2 mb-4 bg-error/10 border border-error/30 text-error font-body-sm text-body-sm px-3 py-2 rounded-xl">
                <span className="material-symbols-outlined text-[16px] shrink-0">
                  error
                </span>
                <span className="flex-1 break-words">{searchError}</span>
                <button
                  onClick={() => setSearchError(null)}
                  className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Dismiss search error"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    close
                  </span>
                </button>
              </div>
            )}
            {results !== null && (
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
                  {searching && (
                    <span className="w-4 h-4 border-2 border-on-surface-variant/30 border-t-on-surface-variant rounded-full animate-spin"></span>
                  )}
                  Showing {galleryItems.length} result
                  {galleryItems.length === 1 ? "" : "s"} for{" "}
                  <span className="text-on-surface font-semibold">
                    "{query}"
                  </span>
                </p>
                <button
                  onClick={clearSearch}
                  className="flex items-center gap-1 text-on-surface-variant hover:text-error transition-colors font-label-caps text-label-caps"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    close
                  </span>
                  Clear
                </button>
              </div>
            )}
            {!loading && !loadError && galleryItems.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] gap-4 text-center">
                <div className="w-16 h-16 rounded-3xl bg-surface-container-low flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant">
                    {activeFilter === "trash"
                      ? "delete"
                      : activeFilter === "favorites"
                        ? "star"
                        : "photo_library"}
                  </span>
                </div>
                <p className="font-title-sm text-title-sm text-midnight-ink">
                  {results !== null
                    ? "No matches found"
                    : activeFilter === "trash"
                      ? "Trash is empty"
                      : activeFilter === "favorites"
                        ? "No favorites yet — star an image"
                        : images.length === 0
                          ? "No images yet"
                          : "No assets match the active filters"}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {results !== null
                    ? "Try clearing the search or choosing another view."
                    : activeFilter === "trash"
                      ? "Deleted photos end up here until they're restored or removed."
                      : activeFilter === "favorites"
                        ? "Tap the star on any photo to add it to your favorites."
                        : "Upload photos or browse the gallery to get started."}
                </p>
                <button
                  onClick={() => {
                    if (results !== null) clearSearch();
                    else if (
                      activeFilter === "trash" ||
                      activeFilter === "favorites"
                    )
                      onFilter("all");
                    else if (images.length === 0) onUpload();
                    else onFilter("all");
                  }}
                  className="mt-2 bg-midnight-ink hover:bg-prussian-navy text-white px-5 py-2.5 rounded-full font-label-caps text-label-caps transition-colors"
                >
                  {results !== null
                    ? "Clear search"
                    : activeFilter === "trash" || activeFilter === "favorites"
                      ? "Browse Gallery"
                      : images.length === 0
                        ? "Upload your first image"
                        : "Browse Gallery"}
                </button>
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center py-24 gap-3">
                <span className="material-symbols-outlined text-2xl text-on-surface-variant animate-spin">
                  progress_activity
                </span>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  Loading library...
                </p>
              </div>
            )}
            {loadError && !loading && (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <span className="material-symbols-outlined text-5xl text-error">
                  cloud_off
                </span>
                <p className="font-title-sm text-title-sm text-on-surface">
                  Couldn't load the library
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
                  {loadError}
                </p>
                <button
                  onClick={onRetry}
                  className="mt-2 bg-midnight-ink hover:bg-prussian-navy text-white px-5 py-2.5 rounded-full font-label-caps text-label-caps transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            <div className="masonry-grid">
              {galleryItems.map((image) => {
                const item = normalize(image);
                const isTrash = activeFilter === "trash";
                const src = item.thumb;
                return (
                  <div
                    key={item.id || item.object_key}
                    onClick={() => {
                      if (selectMode) {
                        toggleSelect(item.object_key);
                        return;
                      }
                      if (results !== null) {
                        onOpenList(
                          galleryItems.map(normalize),
                          galleryItems.indexOf(image),
                        );
                      } else {
                        onOpenImage(item);
                      }
                    }}
                    className={`masonry-item relative group photo-card rounded-3xl bg-white shadow-soft border border-gray-100 hover:shadow-lg transition-all duration-300 cursor-pointer p-2 ${
                      selected.has(item.object_key)
                        ? "ring-2 ring-midnight-ink"
                        : ""
                    }`}
                  >
                    <img
                      className="w-full object-cover rounded-3xl group-hover:scale-[1.02] transition-transform duration-300"
                      src={src}
                      alt={item.caption}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.parentElement.classList.add(
                          "aspect-[4/3]",
                          "bg-surface-variant",
                          "rounded-3xl",
                        );
                      }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300 rounded-3xl z-10 pointer-events-none"></div>
                    {selectMode && (
                      <div className="absolute top-3 left-3 z-30 w-7 h-7 rounded-full flex items-center justify-center bg-white/90 backdrop-blur border border-black/5 shadow-sm pointer-events-none">
                        <span
                          className="material-symbols-outlined text-[18px]"
                          style={
                            selected.has(item.object_key)
                              ? {
                                  fontVariationSettings: "'FILL' 1",
                                  color: "var(--tertiary, #091426)",
                                }
                              : { color: "var(--on-surface-variant, #6A6258)" }
                          }
                        >
                          {selected.has(item.object_key)
                            ? "check_box"
                            : "check_box_outline_blank"}
                        </span>
                      </div>
                    )}
                    {/* Actions Overlay */}
                    <div
                      className="photo-actions absolute top-2 left-2 right-2 flex justify-between opacity-0 transition-opacity z-20"
                      style={
                        selectMode
                          ? { opacity: 0, pointerEvents: "none" }
                          : undefined
                      }
                    >
                      {isTrash ? (
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore(item.object_key);
                            }}
                            className="w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center border border-black/5 shadow-sm text-primary"
                            title="Restore"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              restore
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteForever(item.object_key);
                            }}
                            className="w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center border border-black/5 shadow-sm text-error hover:bg-error hover:text-on-error transition-colors"
                            title="Delete forever"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              delete_forever
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="ml-auto flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFavorite(item);
                            }}
                            className="w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center border border-black/5 shadow-sm text-midnight-ink hover:bg-white transition-colors"
                            title={
                              item.favorite
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            <span
                              className="material-symbols-outlined text-[16px]"
                              style={
                                item.favorite
                                  ? { fontVariationSettings: "'FILL' 1" }
                                  : undefined
                              }
                            >
                              {item.favorite ? "star" : "star_outline"}
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = item.url || item.src;
                              if (url) window.open(url, "_blank");
                            }}
                            className="w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center border border-black/5 shadow-sm text-on-surface-variant hover:bg-white transition-colors"
                            title="Download"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              download
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Metadata Overlay */}
                    <div className="photo-metadata absolute bottom-2 left-2 right-2 rounded-3xl bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 opacity-0 transition-opacity z-20 text-white">
                      {item.category && (
                        <p className="font-label-caps text-label-caps mb-1">
                          {item.category}
                        </p>
                      )}
                      <p className="font-body-sm text-body-sm truncate">
                        {item.caption}
                      </p>
                      <p className="font-mono-data text-mono-data text-white/70 mt-1">
                        {item.meta}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        {/* Right Side Panel */}
        <aside
          className={`flex flex-col transition-all duration-200 ease-in-out ${
            rightCollapsed
              ? "w-16 bg-transparent items-center gap-6 py-6"
              : "w-64 bg-transparent overflow-y-auto"
          }`}
        >
          {rightCollapsed ? (
            <div className="flex flex-col items-center gap-6">
              <button
                onClick={toggleRight}
                title="Expand panel"
                aria-label="Expand panel"
                className="w-12 h-12 flex items-center justify-center text-on-surface-variant hover:text-midnight-ink hover:bg-white shadow-sm transition-all rounded-2xl bg-white/40 shrink-0"
              >
                <span className="material-symbols-outlined text-sm">
                  chevron_left
                </span>
              </button>
              <div className="w-8 h-px bg-black/10"></div>
              <button
                onClick={exportJson}
                title="Download"
                aria-label="Download"
                className="w-12 h-12 flex items-center justify-center text-on-surface-variant hover:text-midnight-ink hover:bg-white shadow-sm transition-all rounded-2xl bg-white/40"
              >
                <span className="material-symbols-outlined text-sm">
                  download
                </span>
              </button>
              <button
                onClick={shareLink}
                title="Share"
                aria-label="Share"
                className="w-12 h-12 flex items-center justify-center text-on-surface-variant hover:text-midnight-ink hover:bg-white shadow-sm transition-all rounded-2xl bg-white/40"
              >
                <span className="material-symbols-outlined text-sm">share</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between px-3 mb-8">
                <button
                  onClick={toggleRight}
                  title="Collapse panel"
                  aria-label="Collapse panel"
                  className="p-3 text-midnight-ink bg-white shadow-soft hover:bg-gray-50 transition-colors cursor-pointer active:scale-95 rounded-2xl shrink-0"
                >
                  <span className="material-symbols-outlined">
                    chevron_right
                  </span>
                </button>
                <span className="text-sm font-semibold text-midnight-ink">
                  Tools
                </span>
              </div>
              <div className="flex flex-col gap-3 px-3">
                <button
                  onClick={exportJson}
                  title="Download current view as JSON"
                  aria-label="Download current view as JSON"
                  className="h-12 w-full px-3 flex items-center gap-3 rounded-2xl text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm active:scale-95 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm shrink-0">
                    download
                  </span>
                  <span className="text-sm font-medium">Download</span>
                </button>
                <button
                  onClick={shareLink}
                  title="Copy share link"
                  aria-label="Copy share link"
                  className="h-12 w-full px-3 flex items-center gap-3 rounded-2xl text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm active:scale-95 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm shrink-0">
                    share
                  </span>
                  <span className="text-sm font-medium">Share</span>
                </button>
              </div>
              <div className="mx-3 my-6 h-px bg-black/10"></div>
              <div className="px-3">
                <h3 className="text-sm font-semibold text-midnight-ink mb-4">
                  Recent Tags
                </h3>
                <div className="flex flex-col gap-2">
                  {recentTags.map(([tag, n]) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setQuery(tag);
                        runSearch(null, tag);
                      }}
                      className="group h-12 w-full px-3 flex items-center justify-between gap-2 rounded-2xl text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-sm shrink-0">
                          label
                        </span>
                        <span className="text-sm font-medium truncate">
                          {tag}
                        </span>
                      </div>
                      <span className="font-mono-data text-mono-data text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {n}
                      </span>
                    </button>
                  ))}
                </div>
                {recentTags.length === 0 && (
                  <p className="text-sm text-on-surface-variant">
                    No tags yet — upload and AI-tag some images.
                  </p>
                )}
              </div>
              <div className="px-3 mt-6">
                <h3 className="text-sm font-semibold text-midnight-ink mb-4">
                  Quick Actions
                </h3>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={exportJson}
                    className="h-12 w-full px-3 flex items-center gap-3 rounded-2xl text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm active:scale-95 transition-all cursor-pointer"
                    title="Export current view as JSON"
                  >
                    <span className="material-symbols-outlined text-sm shrink-0">
                      file_download
                    </span>
                    <span className="text-sm font-medium">Export</span>
                  </button>
                  <button
                    onClick={shareLink}
                    className="h-12 w-full px-3 flex items-center gap-3 rounded-2xl text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm active:scale-95 transition-all cursor-pointer"
                    title="Copy share link"
                  >
                    <span className="material-symbols-outlined text-sm shrink-0">
                      share
                    </span>
                    <span className="text-sm font-medium">Share</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {tagModal && (
        <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-soft border border-black/5 p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-midnight-ink tracking-tight">
                Tag {selected.size} photo{selected.size === 1 ? "" : "s"}
              </h2>
              <button
                onClick={closeTagModal}
                disabled={aiBusy}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant transition-colors disabled:opacity-40"
                aria-label="Close tag dialog"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                AI tagging
              </span>
              <button
                onClick={runAITag}
                disabled={aiBusy}
                className="flex items-center justify-center gap-2 bg-midnight-ink text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-prussian-navy transition-colors disabled:opacity-60"
              >
                {aiBusy && aiProgress ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Tagging {aiProgress.done}/{aiProgress.total}...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">
                      auto_awesome
                    </span>
                    AI tag {selected.size} selected
                  </>
                )}
              </button>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Runs Gemini on each photo and merges the results into its tags.
              </p>
            </div>

            <div className="h-px bg-black/5"></div>

            <div className="flex flex-col gap-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Manual tags
              </label>
              <input
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                disabled={aiBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runManualTag();
                  }
                }}
                className="w-full bg-surface-container-low border border-black/5 rounded-xl px-3 py-2.5 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors disabled:opacity-60"
                placeholder="e.g. news, breaking, politics"
              />
              {recentTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recentTags.map(([tag]) => (
                    <button
                      key={tag}
                      onClick={() => addQuickTag(tag)}
                      disabled={aiBusy}
                      className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant text-xs font-medium hover:bg-white hover:text-midnight-ink hover:shadow-soft border border-black/5 transition-all disabled:opacity-50"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={runManualTag}
                disabled={aiBusy}
                className="flex items-center justify-center gap-2 bg-white border border-black/10 text-midnight-ink px-4 py-2.5 rounded-full text-sm font-medium hover:bg-surface-container-low transition-colors disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">
                  sell
                </span>
                Add tags to {selected.size} selected
              </button>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Tags are merged into each photo — existing tags are kept.
              </p>
            </div>

            {tagFailures.length > 0 && (
              <div className="flex flex-col gap-1.5 bg-error/10 border border-error/30 rounded-2xl p-3 max-h-40 overflow-y-auto">
                <p className="font-label-caps text-label-caps text-error">
                  {tagFailures.length} failed
                </p>
                {tagFailures.map((f, i) => (
                  <p
                    key={i}
                    className="font-body-sm text-body-sm text-error break-words"
                  >
                    <span className="font-semibold">{f.label}:</span>{" "}
                    {f.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-on-surface text-surface-container-lowest px-4 py-2 rounded-full font-body-sm text-body-sm shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
