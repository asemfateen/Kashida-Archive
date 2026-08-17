import { useEffect, useMemo, useRef, useState } from "react";
import { getFacets, searchImages, updateImage } from "../api.js";
import FacetPanel from "../components/FacetPanel.jsx";
import { savedSearches } from "../store.js";

const GROUP_TYPE_LABELS = { jpg: "JPEG", png: "PNG", raw: "RAW" };

export default function Search({
  query,
  onOpenImage,
  onOpenList,
  onUpload,
  onBack,
  onSettings,
}) {
  const [currentQuery, setCurrentQuery] = useState("");
  const [terms, setTerms] = useState([]);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [facets, setFacets] = useState(null);
  const [facetTags, setFacetTags] = useState([]);
  const [facetType, setFacetType] = useState(null);
  const [facetDay, setFacetDay] = useState(null);
  const [groupBy, setGroupBy] = useState("none");
  const [sort, setSort] = useState("rank");
  const [elapsed, setElapsed] = useState(null);
  const [saved, setSaved] = useState(savedSearches.list());
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [toast, setToast] = useState(null);
  const [favorites, setFavorites] = useState({});
  const searchIdRef = useRef(0);
  const lastQueryRef = useRef(null);
  const lastRunKeyRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const runKey = (q, s) =>
    `${q}::${s}::${facetTags.join(",")}::${facetType}::${facetDay}`;

  const runSearch = async (q, s) => {
    const qq = (q ?? currentQuery).trim();
    const ss = s ?? sort;
    const key = runKey(qq, ss);
    if (key === lastRunKeyRef.current) return;
    lastRunKeyRef.current = key;
    const id = ++searchIdRef.current;
    if (!qq) {
      setSearching(false);
      return;
    }
    const termList = (qq.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
      (t) => t.length > 1,
    );
    if (termList.length === 0) {
      setSearching(false);
      setResults([]);
      setFacets(null);
      return;
    }
    setCurrentQuery(qq);
    setTerms(termList);
    setSearching(true);
    const t0 = performance.now();
    const params = new URLSearchParams({ q: termList.join(" ") });
    if (ss) params.set("sort", ss);
    for (const t of facetTags) params.append("tag", t);
    if (facetType) params.set("type", facetType);
    if (facetDay) {
      params.set("dateFrom", facetDay);
      params.set("dateTo", facetDay);
    }
    try {
      const [found, facetData] = await Promise.all([
        searchImages(params),
        getFacets(params),
      ]);
      if (id !== searchIdRef.current) return;
      setResults(found);
      setFacets(facetData);
      const favMap = {};
      for (const img of found) favMap[img.object_key] = !!img.favorite;
      setFavorites(favMap);
      setElapsed(((performance.now() - t0) / 1000).toFixed(1));
    } catch {
      if (id === searchIdRef.current) {
        setResults([]);
        setFacets(null);
      }
    } finally {
      if (id === searchIdRef.current) setSearching(false);
    }
  };

  // The query comes from the URL (/search?q=...). Re-run whenever it changes,
  // which covers typing a fresh search AND browser back/forward navigation.
  useEffect(() => {
    const q = typeof query === "string" ? query.trim() : "";
    if (q && q !== lastQueryRef.current) {
      lastQueryRef.current = q;
      lastRunKeyRef.current = null;
      clearFacets();
      setGroupBy("none");
      runSearch(q, sort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Facet toggles re-run the active search so results, counts and grid stay
  // in lock-step (dynamic query previews, no dead-ends).
  useEffect(() => {
    const q = lastQueryRef.current;
    if (!q) return;
    runSearch(q, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetTags, facetType, facetDay]);

  const removeTerm = (term) => {
    lastRunKeyRef.current = null;
    const next = terms.filter((t) => t !== term);
    setTerms(next);
    if (next.length === 0) {
      searchIdRef.current++;
      setSearching(false);
      setResults(null);
      return;
    }
    runSearch(next.join(" "), sort);
  };

  const typeOf = (key) => {
    const ext = (key.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg"].includes(ext)) return "jpg";
    if (ext === "png") return "png";
    return "raw";
  };

  const toggleFacetTag = (tag) =>
    setFacetTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  const toggleFacetType = (type) =>
    setFacetType((prev) => (prev === type ? null : type));
  const toggleFacetDay = (day) =>
    setFacetDay((prev) => (prev === day ? null : day));
  const clearFacets = () => {
    setFacetTags([]);
    setFacetType(null);
    setFacetDay(null);
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
    lastRunKeyRef.current = null;
    setSort(s.sort || "rank");
    setCurrentQuery((s.terms || []).join(" "));
    setTerms(s.terms || []);
    if ((s.terms || []).length > 0)
      runSearch((s.terms || []).join(" "), s.sort || "rank");
  };

  const doSave = (e) => {
    e.preventDefault();
    const name = saveName.trim();
    if (!name) return;
    savedSearches.add(name, { terms, sort });
    setSaved(savedSearches.list());
    setSaveModal(false);
    setSaveName("");
    showToast(`Saved "${name}"`);
  };

  const deleteSaved = (id) => {
    savedSearches.remove(id);
    setSaved(savedSearches.list());
  };

  const groupKeyOf = (item) => {
    if (groupBy === "tag")
      return (item.tags || "").split(" ").filter(Boolean)[0] || "untagged";
    if (groupBy === "type") return typeOf(item.object_key);
    if (groupBy === "date")
      return (item.created_at || "").slice(0, 10) || "unknown";
    return null;
  };

  const groupedGroups = useMemo(() => {
    if (groupBy === "none" || !results || results.length === 0) return null;
    const groups = new Map();
    results.forEach((image, idx) => {
      const key = groupKeyOf(image);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ image, idx });
    });
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, results]);

  const renderCard = (image, i) => {
    const isFav = favorites[image.object_key] ?? image.favorite;
    return (
      <div
        key={image.id || image.object_key}
        onClick={() => {
          onOpenList(
            results.map((img) => ({
              ...img,
              src: img.url || img.src,
            })),
            i,
          );
        }}
        className="group relative bg-surface-container-lowest border rounded-lg overflow-hidden flex flex-col hover:border-primary transition-colors cursor-pointer border-outline-variant"
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
                  isFav ? { fontVariationSettings: "'FILL' 1" } : undefined
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
  };

  const count = results === null ? 0 : results.length;

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Facet Matrix Sidebar */}
        {results !== null && (
          <aside className="w-72 bg-surface-container-low border-r border-outline-variant overflow-y-auto p-4 shrink-0 hidden lg:block">
            <FacetPanel
              facets={facets}
              facetTags={facetTags}
              facetType={facetType}
              facetDay={facetDay}
              onToggleTag={toggleFacetTag}
              onToggleType={toggleFacetType}
              onToggleDay={toggleFacetDay}
            />
          </aside>
        )}

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
              <div className="flex gap-3 mt-2 flex-wrap items-center">
                {saved.length > 0 && (
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="material-symbols-outlined text-[15px] text-on-surface-variant">
                      bookmark
                    </span>
                    {saved.map((s) => (
                      <span
                        key={s.id}
                        className="flex items-center gap-1 rounded-full bg-surface-container-low border border-outline-variant pl-2 pr-1 py-0.5"
                      >
                        <button
                          onClick={() => openSaved(s)}
                          className="font-body-sm text-body-sm text-on-surface hover:text-primary transition-colors"
                          title={`${(s.terms || []).join(" ")}`}
                        >
                          {s.name}
                        </button>
                        <button
                          onClick={() => deleteSaved(s.id)}
                          className="text-on-surface-variant hover:text-error transition-colors"
                          title="Delete saved search"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            close
                          </span>
                        </button>
                      </span>
                    ))}
                  </span>
                )}
                <button
                  onClick={() => {
                    if (terms.length === 0) {
                      showToast("Run a search first to save it");
                      return;
                    }
                    setSaveModal(true);
                  }}
                  className="flex items-center gap-1 text-primary hover:underline font-body-sm text-body-sm"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    bookmark_add
                  </span>
                  Save Search
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
                title="Back to library"
              >
                <span className="material-symbols-outlined">arrow_back</span>
                <span className="font-label-caps text-label-caps">Library</span>
              </button>
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
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-sm font-body-sm text-on-surface focus:border-primary outline-none"
              >
                <option value="none">Group: None</option>
                <option value="tag">Group: Tag</option>
                <option value="type">Group: Type</option>
                <option value="date">Group: Date</option>
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
            {!searching && results !== null && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <span className="material-symbols-outlined text-5xl text-primary-fixed-dim">
                  manage_search
                </span>
                <p className="font-title-sm text-title-sm text-primary">
                  No matches found
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Try different keywords, or clear the search terms.
                </p>
              </div>
            )}
            {!searching &&
              results !== null &&
              results.length > 0 &&
              (groupedGroups ? (
                <div className="flex flex-col gap-10">
                  {groupedGroups.map(([key, items]) => (
                    <section key={key}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary" />
                          {groupBy === "type"
                            ? GROUP_TYPE_LABELS[key] || key
                            : key}
                        </h3>
                        <span className="font-mono-data text-mono-data text-on-surface-variant">
                          {items.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-grid-gap">
                        {items.map(({ image, idx }) => renderCard(image, idx))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-grid-gap">
                  {results.map((image, i) => renderCard(image, i))}
                </div>
              ))}
            {!searching && results === null && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                Type keywords in the search bar above and press Search.
              </p>
            )}
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
