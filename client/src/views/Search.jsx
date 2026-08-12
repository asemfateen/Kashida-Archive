import { useEffect, useMemo, useRef, useState } from "react";
import { searchImages, updateImage } from "../api.js";
import { savedSearches } from "../store.js";
import Avatar from "../components/Avatar.jsx";

export default function Search({
  onOpenImage,
  onOpenList,
  onUpload,
  onBack,
  onCollections,
  onSettings,
  onBatch,
}) {
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState([]);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState("rank");
  const [elapsed, setElapsed] = useState(null);
  const [types, setTypes] = useState({ jpg: true, raw: true, png: false });
  const [dateRange, setDateRange] = useState("custom");
  const [start, setStart] = useState("01/01/2024");
  const [end, setEnd] = useState("Present");
  const [saved, setSaved] = useState(savedSearches.list());
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [toast, setToast] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [favorites, setFavorites] = useState({});
  const searchRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
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

  const runSearch = async (q, s) => {
    const qq = (q ?? query).trim();
    const ss = s ?? sort;
    if (!qq && terms.length === 0) return;
    const termList = qq
      ? qq
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu)
          .filter((t) => t.length > 1)
      : terms;
    if (termList.length === 0) {
      setResults([]);
      return;
    }
    setTerms(termList);
    setSearching(true);
    const t0 = performance.now();
    try {
      const found = await searchImages(termList.join(" "), ss);
      setResults(found);
      setSelectedKeys(new Set());
      const favMap = {};
      for (const img of found) favMap[img.object_key] = !!img.favorite;
      setFavorites(favMap);
      setElapsed(((performance.now() - t0) / 1000).toFixed(1));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const removeTerm = (term) => {
    const next = terms.filter((t) => t !== term);
    setTerms(next);
    if (next.length === 0) {
      setResults(null);
      return;
    }
    runSearch(next.join(" "), sort);
  };

  const activeTypes = Object.entries(types)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const typeOf = (key) => {
    const ext = (key.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg"].includes(ext)) return "jpg";
    if (ext === "png") return "png";
    return "raw";
  };

  const inDateRange = (createdAt) => {
    if (dateRange === "today") {
      const t = new Date();
      const target = new Date(createdAt);
      return target >= new Date(t.getTime() - 864e5);
    }
    if (dateRange === "week") {
      return new Date(createdAt) >= new Date(Date.now() - 7 * 864e5);
    }
    if (dateRange === "custom") {
      const parse = (v) => {
        const m = v.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
      };
      const from = parse(start);
      const to = end === "Present" ? new Date() : parse(end);
      const d = new Date(createdAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  };

  const filtered = useMemo(() => {
    if (!results) return null;
    return results.filter(
      (r) =>
        activeTypes.some((t) => typeOf(r.object_key) === t) &&
        inDateRange(r.created_at),
    );
  }, [results, activeTypes, dateRange, start, end]);

  const toggleSelect = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFavorite = async (image, e) => {
    e.stopPropagation();
    try {
      const row = await updateImage(image.object_key, {
        favorite: !image.favorite,
      });
      setFavorites((prev) => ({ ...prev, [row.object_key]: row.favorite }));
      setResults((prev) =>
        prev
          ? prev.map((img) =>
              img.object_key === row.object_key ? { ...img, ...row } : img,
            )
          : prev,
      );
    } catch {
      /* ignore */
    }
  };

  const openSaved = (s) => {
    setTypes({ jpg: true, raw: true, png: false });
    setDateRange("custom");
    if (s.types) setTypes(s.types);
    if (s.dateRange) setDateRange(s.dateRange);
    if (s.start) setStart(s.start);
    if (s.end) setEnd(s.end);
    setSort(s.sort || "rank");
    setQuery((s.terms || []).join(" "));
    setTerms(s.terms || []);
    if ((s.terms || []).length > 0)
      runSearch((s.terms || []).join(" "), s.sort || "rank");
  };

  const doSave = (e) => {
    e.preventDefault();
    const name = saveName.trim();
    if (!name) return;
    savedSearches.add(name, {
      terms,
      sort,
      types: { ...types },
      dateRange,
      start,
      end,
    });
    setSaved(savedSearches.list());
    setSaveModal(false);
    setSaveName("");
    showToast(`Saved "${name}"`);
  };

  const deleteSaved = (id) => {
    savedSearches.remove(id);
    setSaved(savedSearches.list());
  };

  const clearAll = () => {
    setQuery("");
    setTerms([]);
    setResults(null);
    setStart("01/01/2024");
    setEnd("Present");
    setDateRange("custom");
    setTypes({ jpg: true, raw: true, png: false });
    setSort("rank");
    setSelectedKeys(new Set());
  };

  const count = filtered === null ? 0 : filtered.length;
  const selectedCount = selectedKeys.size;

  return (
    <>
      {/* TopNavBar */}
      <header className="bg-surface-container-lowest border-b border-outline-variant px-margin-page py-unit h-16 z-50 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={onBack}
            className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
            title="Back to library"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span className="font-label-caps text-label-caps">Library</span>
          </button>
          <span className="font-headline-md text-headline-md text-primary tracking-tight font-bold">
            NewsLens
          </span>
        </div>
        <div className="flex-1 max-w-2xl mx-12">
          <form
            className="relative w-full group"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
              search
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-container-low border border-transparent group-focus-within:border-primary group-focus-within:bg-surface-container-lowest rounded-full py-2 pl-10 pr-24 outline-none transition-colors font-body-md text-on-surface"
              placeholder="Search assets... (Cmd+K)"
              type="text"
            />
            <button
              type="submit"
              disabled={searching}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-on-primary px-3 py-1 rounded-full font-label-caps text-label-caps disabled:opacity-60"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </form>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onCollections}
            className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full"
            title="Collections"
          >
            <span className="material-symbols-outlined">
              auto_awesome_motion
            </span>
          </button>
          <button
            onClick={onSettings}
            className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full"
            title="Settings"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button
            onClick={onUpload}
            className="bg-primary text-on-primary px-4 py-2 rounded font-title-sm text-title-sm hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <span className="material-symbols-outlined">upload</span>
            Upload
          </button>
          <Avatar />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SideNavBar / Filter Panel */}
        <aside className="w-panel-width-fixed bg-surface-container-lowest border-r border-outline-variant h-full flex flex-col shrink-0 overflow-y-auto z-40">
          <div className="p-6 border-b border-outline-variant">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-title-sm text-title-sm text-primary">
                Advanced Filters
              </h2>
              <button
                onClick={clearAll}
                className="text-on-surface-variant hover:text-primary transition-colors text-sm underline font-body-sm"
              >
                Clear All
              </button>
            </div>
            <button
              onClick={() => {
                if (terms.length === 0) {
                  showToast("Run a search first to save it");
                  return;
                }
                setSaveModal(true);
              }}
              className="w-full flex items-center justify-center gap-2 border border-outline hover:border-primary text-primary py-2 rounded transition-colors font-body-sm text-body-sm"
            >
              <span className="material-symbols-outlined text-[18px]">
                bookmark_add
              </span>
              Save Search
            </button>
            {saved.length > 0 && (
              <div className="mt-4 flex flex-col gap-1">
                <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-1 uppercase text-xs">
                  Saved Searches
                </h3>
                {saved.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center justify-between rounded hover:bg-surface-container-low transition-colors"
                  >
                    <button
                      onClick={() => openSaved(s)}
                      className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left font-body-sm text-body-sm text-on-surface hover:text-primary transition-colors"
                      title={`${(s.terms || []).join(" ")}`}
                    >
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                        bookmark
                      </span>
                      <span className="truncate">{s.name}</span>
                    </button>
                    <button
                      onClick={() => deleteSaved(s.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-on-surface-variant hover:text-error transition-all"
                      title="Delete saved search"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        close
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-6 space-y-8 flex-1">
            {/* Date Range */}
            <div>
              <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-3 uppercase">
                Date Range
              </h3>
              <div className="space-y-3">
                {[
                  ["today", "Past 24 Hours"],
                  ["week", "Past Week"],
                  ["custom", "Custom Range"],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="date"
                      checked={dateRange === key}
                      onChange={() => setDateRange(key)}
                      className="form-radio text-primary focus:ring-primary border-outline"
                    />
                    <span className="font-body-sm text-body-sm">{label}</span>
                  </label>
                ))}
                {dateRange === "custom" && (
                  <div className="pl-7 flex gap-2">
                    <input
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-xs font-mono-data text-on-surface outline-none focus:border-primary"
                      placeholder="Start"
                      type="text"
                    />
                    <input
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-xs font-mono-data text-on-surface outline-none focus:border-primary"
                      placeholder="End"
                      type="text"
                    />
                  </div>
                )}
              </div>
            </div>
            {/* Asset Type */}
            <div>
              <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-3 uppercase">
                Asset Type
              </h3>
              <div className="space-y-3">
                {Object.entries({ jpg: "JPEG", raw: "RAW", png: "PNG" }).map(
                  ([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={types[key]}
                        onChange={() =>
                          setTypes((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className="form-checkbox text-primary rounded focus:ring-primary border-outline"
                      />
                      <span className="font-body-sm text-body-sm">{label}</span>
                    </label>
                  ),
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-background flex flex-col overflow-hidden relative">
          {/* Results Header */}
          <div className="px-margin-page py-4 border-b border-outline-variant bg-surface-container-lowest shrink-0 flex justify-between items-center z-10 gap-4 flex-wrap">
            <div>
              <h1 className="font-title-sm text-title-sm text-primary flex items-center gap-2">
                {count.toLocaleString()} Results
                {elapsed !== null && (
                  <span className="text-on-surface-variant font-body-sm font-normal">
                    in {elapsed}s
                  </span>
                )}
              </h1>
              {terms.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {terms.map((term) => (
                    <span
                      key={term}
                      className="bg-primary-container text-on-primary-fixed-variant px-2 py-1 rounded text-xs font-mono-data flex items-center gap-1 border border-primary-fixed"
                    >
                      {term}
                      <button
                        onClick={() => removeTerm(term)}
                        className="hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          close
                        </span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {selectedCount > 0 && (
                <button
                  onClick={() =>
                    onBatch(
                      filtered.filter((img) =>
                        selectedKeys.has(img.object_key),
                      ),
                    )
                  }
                  className="mt-2 flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-lg font-label-caps text-label-caps text-xs"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    auto_awesome_motion
                  </span>
                  {selectedCount} selected — add to Collections
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  if (terms.length > 0)
                    runSearch(terms.join(" "), e.target.value);
                }}
                className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-sm font-body-sm text-on-surface focus:border-primary outline-none"
              >
                <option value="rank">Sort: Relevance</option>
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
              </select>
            </div>
          </div>

          {/* Asset Grid */}
          <div className="flex-1 overflow-y-auto p-margin-page">
            {searching && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                Searching...
              </p>
            )}
            {!searching && filtered !== null && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <span className="material-symbols-outlined text-5xl text-primary-fixed-dim">
                  manage_search
                </span>
                <p className="font-title-sm text-title-sm text-primary">
                  No matches found
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Try different keywords, or clear the type/date filters.
                </p>
              </div>
            )}
            {!searching && filtered !== null && filtered.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-grid-gap">
                {filtered.map((image, i) => {
                  const isFav = favorites[image.object_key] ?? image.favorite;
                  const isSel = selectedKeys.has(image.object_key);
                  return (
                    <div
                      key={image.id || image.object_key}
                      onClick={() => {
                        const src = image.url || image.src;
                        onOpenList(
                          filtered.map((img) => ({
                            ...img,
                            src: img.url || img.src,
                          })),
                          i,
                        );
                      }}
                      className={`group relative bg-surface-container-lowest border rounded-lg overflow-hidden flex flex-col hover:border-primary transition-colors cursor-pointer ${
                        isSel ? "border-primary" : "border-outline-variant"
                      }`}
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-surface-variant">
                        <img
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          src={image.url || image.src}
                          alt={image.original_filename}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        {/* Selection Checkbox */}
                        <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSelect(image.object_key)}
                            onClick={(e) => e.stopPropagation()}
                            className="form-checkbox w-5 h-5 text-primary rounded bg-surface-container-lowest border-outline focus:ring-primary shadow-sm"
                          />
                        </div>
                        {/* Quick Actions */}
                        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <button
                            onClick={(e) => toggleFavorite(image, e)}
                            className={`bg-surface-container-lowest/80 backdrop-blur-sm p-1.5 rounded hover:bg-surface-container-lowest shadow-sm ${
                              isFav
                                ? "text-tertiary-container"
                                : "text-on-surface-variant hover:text-primary"
                            }`}
                            title="Favorite"
                          >
                            <span
                              className="material-symbols-outlined text-[18px]"
                              style={
                                isFav
                                  ? { fontVariationSettings: "'FILL' 1" }
                                  : undefined
                              }
                            >
                              star
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = image.url || image.src;
                              if (url) window.open(url, "_blank");
                            }}
                            className="bg-surface-container-lowest/80 backdrop-blur-sm p-1.5 rounded hover:bg-surface-container-lowest text-on-surface-variant hover:text-primary shadow-sm"
                            title="Download"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              download
                            </span>
                          </button>
                        </div>
                        {/* Matched Tags Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex flex-wrap gap-1.5">
                          {(image.tags || "")
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 3)
                            .map((tag) => (
                              <span
                                key={tag}
                                className="bg-primary text-on-primary text-[10px] px-1.5 py-0.5 rounded font-mono-data font-bold border border-primary-fixed"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div className="p-3 bg-surface-container-lowest shrink-0 border-t border-outline-variant">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-mono-data text-[10px] text-on-surface-variant">
                            {image.original_filename}
                          </span>
                          <span className="font-mono-data text-[10px] text-on-surface-variant">
                            {typeOf(image.object_key).toUpperCase()}
                          </span>
                        </div>
                        <p className="font-body-sm text-xs text-primary truncate">
                          {(image.tags || "").split(" ")[0] || "untagged"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!searching && filtered === null && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                Type keywords above and press Search.
              </p>
            )}
          </div>

          {/* Timeline Slider (decorative) */}
          <div className="absolute bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-outline-variant px-margin-page py-3 flex items-center gap-4 shadow-[0_-10px_15px_rgba(0,0,0,0.02)] z-20">
            <span className="font-label-caps text-label-caps text-on-surface-variant w-16">
              TIMELINE
            </span>
            <div className="flex-1 relative h-6">
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-surface-container-high rounded"></div>
              {[10, 11, 12, 45, 46, 47, 48, 49].map((pct, i) => (
                <div
                  key={i}
                  className={`absolute bottom-2 w-1 rounded-t ${
                    i >= 4
                      ? "bg-primary-fixed"
                      : "bg-primary-fixed-dim opacity-60"
                  }`}
                  style={{
                    left: `${pct}%`,
                    height: `${4 + (i % 4) * 1.5}rem`,
                    opacity: i >= 4 ? 1 : 0.5,
                  }}
                />
              ))}
            </div>
            <span className="font-mono-data text-mono-data text-primary w-24 text-right">
              {new Date().toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        </main>
      </div>

      {/* Save Search Modal */}
      {saveModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSaveModal(false);
          }}
        >
          <form
            onSubmit={doSave}
            className="w-full max-w-sm bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-5"
          >
            <h3 className="font-title-sm text-title-sm text-on-surface mb-1">
              Save Search
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              {terms.join(" ")} — {sort}
            </p>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              autoFocus
              className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
              placeholder="Search name, e.g. 'Protest coverage'"
              type="text"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setSaveModal(false)}
                className="px-4 py-2 rounded-lg font-label-caps text-label-caps text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg font-label-caps text-label-caps bg-primary text-on-primary hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          </form>
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
