import { useEffect, useRef, useState } from "react";
import { searchImages } from "../api.js";

const DIMENSIONS = new Map();
let measureQueued = {};

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
  onQuickTag,
  searchQuery = null,
  onFavorite,
  lastOpened,
  onRestore,
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [quickTag, setQuickTag] = useState("");
  const [toast, setToast] = useState(null);
  const [, setTick] = useState(0);
  const searchRef = useRef(null);
  const searchIdRef = useRef(0);

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

  const handleQuickTag = async (e) => {
    e.preventDefault();
    const tag = quickTag
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, " ");
    if (!tag || !lastOpened) return;
    try {
      await onQuickTag(lastOpened, tag);
      setQuickTag("");
      showToast(`Tagged "${tag}" on ${lastOpened.original_filename}`);
    } catch {
      showToast("Failed to tag — try again");
    }
  };

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

  const markMeasured = (src) => {
    if (measureQueued[src] || DIMENSIONS.has(src)) return;
    measureQueued[src] = true;
    const img = new Image();
    img.onload = () => {
      DIMENSIONS.set(src, { w: img.naturalWidth, h: img.naturalHeight });
      delete measureQueued[src];
      setTick((t) => t + 1);
    };
    img.src = src;
  };

  const normalize = (image) => ({
    ...image,
    src: image.url || image.src,
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
          <div className="p-margin-page masonry-grid pb-24">
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
                      setResults(null);
                      setQuery("");
                      onFilter("all");
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
              const src = item.src;
              return (
                <div
                  key={item.id || item.object_key}
                  onClick={() => {
                    if (results !== null) {
                      onOpenList(
                        galleryItems.map(normalize),
                        galleryItems.indexOf(image),
                      );
                    } else {
                      onOpenImage(item);
                    }
                  }}
                  className="masonry-item relative group photo-card rounded bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-[0px_10px_15px_rgba(0,0,0,0.05)] cursor-pointer"
                >
                  <img
                    className="w-full object-cover"
                    src={src}
                    alt={item.caption}
                    onLoad={() => markMeasured(src)}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.parentElement.classList.add(
                        "aspect-[4/3]",
                        "bg-surface-variant",
                      );
                    }}
                  />
                  <div className="absolute inset-0 border-[3px] border-transparent group-hover:border-tertiary-container transition-colors z-10 pointer-events-none"></div>
                  {/* Actions Overlay */}
                  <div className="photo-actions absolute top-2 left-2 right-2 flex justify-between opacity-0 transition-opacity z-20">
                    {isTrash ? (
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
        </main>

        {/* Right Side Panel */}
        <aside className="w-[320px] bg-surface-container-lowest border-l border-outline-variant flex flex-col p-4 overflow-y-auto shadow-[0px_10px_15px_rgba(0,0,0,0.05)]">
          <div className="mb-6">
            <h3 className="font-title-sm text-title-sm text-on-surface mb-4 border-b border-outline-variant pb-2">
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
                <span className="font-label-caps text-label-caps">Export</span>
              </button>
              <button
                onClick={shareLink}
                className="p-2 border border-outline-variant rounded flex flex-col items-center justify-center gap-1 hover:bg-surface-container-low transition-colors text-on-surface-variant"
                title="Copy share link"
              >
                <span className="material-symbols-outlined text-[20px]">
                  share
                </span>
                <span className="font-label-caps text-label-caps">Share</span>
              </button>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant">
            <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
              Quick-tag{" "}
              {lastOpened
                ? `(last opened: ${lastOpened.original_filename})`
                : "(open an image first)"}
            </label>
            <form className="relative" onSubmit={handleQuickTag}>
              <input
                value={quickTag}
                onChange={(e) => setQuickTag(e.target.value)}
                disabled={!lastOpened}
                className="w-full bg-surface-container-lowest border border-outline-variant focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container rounded p-2 font-body-sm text-body-sm text-on-surface outline-none disabled:opacity-50"
                placeholder="Add tag..."
                type="text"
              />
              <button
                type="submit"
                disabled={!lastOpened}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-tertiary-container disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
              </button>
            </form>
          </div>
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
