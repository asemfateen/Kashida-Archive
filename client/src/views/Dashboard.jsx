import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { batchDelete, batchUpdate, searchImages } from "../api.js";

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
  const [toast, setToast] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem("kashida_right_panel_collapsed") === "1",
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
    } catch {
      showToast("Could not update selection");
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
    try {
      const res = await searchImages(q);
      if (id === searchIdRef.current) setResults(res);
    } catch {
      if (id === searchIdRef.current) setResults([]);
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
    } catch {
      showToast("Could not update favorite");
    }
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
                        className="bg-surface-container-high text-primary font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-surface-variant transition-colors border border-outline-variant"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => runBatch("deleteForever")}
                        className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-error hover:text-on-error transition-colors"
                      >
                        Delete forever
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => runBatch("trash")}
                      className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-error hover:text-on-error transition-colors"
                    >
                      Move to Trash
                    </button>
                  )}
                  <button
                    onClick={clearSelection}
                    className="bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-surface-variant transition-colors border border-outline-variant"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setSelectMode(true)}
                  className="bg-surface-container-high text-primary font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-surface-variant transition-colors border border-outline-variant"
                >
                  <span className="material-symbols-outlined text-[18px] align-middle mr-1">
                    check_box
                  </span>
                  Select
                </button>
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
                  className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-error hover:text-on-error transition-colors"
                >
                  Empty Trash
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
            <div className="masonry-grid">
              {loading && (
                <p className="font-body-md text-body-md text-on-surface-variant col-span-full">
                  Loading library...
                </p>
              )}
              {loadError && !loading && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-center col-span-full">
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
                    className="mt-2 bg-tertiary text-on-tertiary px-4 py-2 rounded-lg font-label-caps text-label-caps hover:bg-tertiary-container transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!loading && !loadError && galleryItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                  <span className="material-symbols-outlined text-5xl text-primary-fixed-dim">
                    photo_library
                  </span>
                  <p className="font-title-sm text-title-sm text-primary">
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
                  <button
                    onClick={() => {
                      if (images.length > 0 || results !== null) {
                        clearSearch();
                      } else {
                        onUpload();
                      }
                    }}
                    className="mt-2 bg-tertiary text-on-tertiary px-4 py-2 rounded-lg font-label-caps text-label-caps hover:bg-tertiary-container transition-colors"
                  >
                    {images.length === 0 && results === null
                      ? "Upload your first image"
                      : "Clear search"}
                  </button>
                </div>
              )}
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
                    className={`masonry-item relative group photo-card rounded bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-[0px_10px_15px_rgba(0,0,0,0.05)] cursor-pointer ${
                      selected.has(item.object_key)
                        ? "ring-2 ring-tertiary"
                        : ""
                    }`}
                  >
                    <img
                      className="w-full object-cover"
                      src={src}
                      alt={item.caption}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.parentElement.classList.add(
                          "aspect-[4/3]",
                          "bg-surface-variant",
                        );
                      }}
                    />
                    <div className="absolute inset-0 border-[3px] border-transparent group-hover:border-tertiary-container transition-colors z-10 pointer-events-none"></div>
                    {selectMode && (
                      <div className="absolute top-2 left-2 z-30 w-7 h-7 rounded flex items-center justify-center bg-surface-container-lowest/90 backdrop-blur border border-outline-variant pointer-events-none">
                        <span
                          className="material-symbols-outlined text-[18px]"
                          style={
                            selected.has(item.object_key)
                              ? {
                                  fontVariationSettings: "'FILL' 1",
                                  color: "var(--tertiary, #22d3ee)",
                                }
                              : { color: "var(--on-surface-variant, #94a3b8)" }
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
                            className="w-7 h-7 rounded bg-surface-container-lowest/90 backdrop-blur flex items-center justify-center border border-outline-variant text-primary"
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
                            className="w-7 h-7 rounded bg-error-container/90 backdrop-blur flex items-center justify-center border border-outline-variant text-on-error-container hover:bg-error hover:text-on-error transition-colors"
                            title="Delete forever"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              delete_forever
                            </span>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFavorite(item);
                          }}
                          className="w-7 h-7 rounded bg-surface-container-lowest/80 backdrop-blur flex items-center justify-center border border-outline-variant text-tertiary-container hover:bg-surface-container-lowest transition-colors"
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
                      )}
                    </div>
                    {/* Metadata Overlay */}
                    <div className="photo-metadata absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 opacity-0 transition-opacity z-20 text-white">
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
          className={`bg-surface-container-lowest border-l border-outline-variant flex flex-col overflow-y-auto shadow-[0px_10px_15px_rgba(0,0,0,0.05)] transition-all duration-200 ease-in-out ${
            rightCollapsed ? "w-[76px]" : "w-[320px]"
          }`}
        >
          {rightCollapsed ? (
            <div className="flex flex-col items-center gap-3 p-4">
              <button
                onClick={toggleRight}
                title="Expand panel"
                aria-label="Expand panel"
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-low text-on-surface-variant transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-[20px]">
                  chevron_left
                </span>
              </button>
              <div className="w-6 border-t border-outline-variant"></div>
              <button
                onClick={() => setRightCollapsed(false)}
                title="Recent Tags"
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-low text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">
                  label
                </span>
              </button>
              <button
                onClick={exportJson}
                title="Export current view as JSON"
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-low text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">
                  file_download
                </span>
              </button>
              <button
                onClick={shareLink}
                title="Copy share link"
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-low text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">
                  share
                </span>
              </button>
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4 border-b border-outline-variant pb-2">
                  <h3 className="font-title-sm text-title-sm text-on-surface">
                    Recent Tags
                  </h3>
                  <button
                    onClick={toggleRight}
                    title="Collapse panel"
                    aria-label="Collapse panel"
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-low text-on-surface-variant transition-colors shrink-0"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      chevron_right
                    </span>
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {recentTags.map(([tag, n]) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setQuery(tag);
                        runSearch(null, tag);
                      }}
                      className="group flex items-center justify-between p-2 rounded hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
                          label
                        </span>
                        <span className="font-body-sm text-body-sm text-on-surface">
                          {tag}
                        </span>
                      </div>
                      <span className="font-mono-data text-mono-data text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">
                        {n}
                      </span>
                    </button>
                  ))}
                </div>
                {recentTags.length === 0 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    No tags yet — upload and AI-tag some images.
                  </p>
                )}
              </div>
              <div className="mt-4">
                <h3 className="font-title-sm text-title-sm text-on-surface mb-4 border-b border-outline-variant pb-2">
                  Quick Actions
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={exportJson}
                    className="p-2 border border-outline-variant rounded flex flex-col items-center justify-center gap-1 hover:bg-surface-container-low transition-colors text-on-surface-variant"
                    title="Export current view as JSON"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      file_download
                    </span>
                    <span className="font-label-caps text-label-caps">
                      Export
                    </span>
                  </button>
                  <button
                    onClick={shareLink}
                    className="p-2 border border-outline-variant rounded flex flex-col items-center justify-center gap-1 hover:bg-surface-container-low transition-colors text-on-surface-variant"
                    title="Copy share link"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      share
                    </span>
                    <span className="font-label-caps text-label-caps">
                      Share
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-on-surface text-surface-container-lowest px-4 py-2 rounded-full font-body-sm text-body-sm shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
