import { useEffect, useRef, useState } from "react";
import { tagImage, updateImage, deleteImage } from "../api.js";
import { collections } from "../store.js";
import Avatar from "../components/Avatar.jsx";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

function loadPrompt() {
  try {
    return localStorage.getItem("masterPrompt") || DEFAULT_PROMPT;
  } catch {
    return DEFAULT_PROMPT;
  }
}

async function makeThumbnail(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
  });
  const scale = Math.min(
    1,
    512 / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export default function Detail({
  image,
  index,
  total,
  onBack,
  onNavigate,
  onUpdated,
  onDeleted,
  onFavorite,
}) {
  const [tags, setTags] = useState(() =>
    (image.tags || "").split(" ").filter(Boolean),
  );
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState(null);
  const [prompt, setPrompt] = useState(loadPrompt);
  const [promptModal, setPromptModal] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [collModal, setCollModal] = useState(false);
  const [collectionsList, setCollectionsList] = useState([]);
  const [newCollName, setNewCollName] = useState("");
  const [collError, setCollError] = useState(null);
  const tagRef = useRef(null);
  const navRef = useRef(null);

  const src = image.url || image.src;

  const openCollections = () => {
    setCollectionsList(collections.list());
    setNewCollName("");
    setCollModal(true);
  };

  const inCollection = (coll) =>
    coll.items.some((i) => i.key === image.object_key);

  const toggleCollection = (coll) => {
    const item = {
      key: image.object_key,
      url: image.url || image.src,
      filename: image.original_filename,
    };
    const member = inCollection(coll);
    const next = member
      ? collections.removeItems(coll.id, [item.key])
      : collections.addItems(coll.id, [item]);
    setCollectionsList((prev) =>
      prev.map((c) => (c.id === coll.id ? next : c)),
    );
    setCollError(null);
  };

  const createCollectionAndAdd = (e) => {
    if (e) e.preventDefault();
    const name = newCollName.trim();
    if (!name) return;
    const coll = collections.create(name, [
      {
        key: image.object_key,
        url: image.url || image.src,
        filename: image.original_filename,
      },
    ]);
    setCollectionsList((prev) => [...prev, coll]);
    setNewCollName("");
  };

  useEffect(() => {
    setTags((image.tags || "").split(" ").filter(Boolean));
    setZoom(1);
    setTagError(null);
  }, [image.object_key]);

  useEffect(() => {
    const onKey = (e) => {
      const typing =
        e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      if (typing) return;
      if (e.key === "Escape") {
        setPromptModal(false);
        setCollModal(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        tagRef.current?.();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navRef.current?.(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navRef.current?.(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    navRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    tagRef.current = handleTag;
  });

  const persistTags = async (nextTags) => {
    setSaving(true);
    setTagError(null);
    try {
      const row = await updateImage(image.object_key, {
        tags: nextTags.join(" "),
      });
      setTags(nextTags);
      onUpdated(row);
    } catch (err) {
      setTagError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addTag = async (e) => {
    if (e) e.preventDefault();
    const tag = newTag
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, " ");
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag];
    setNewTag("");
    await persistTags(next);
  };

  const removeTag = async (tag) => {
    await persistTags(tags.filter((t) => t !== tag));
  };

  const handleDelete = async () => {
    try {
      await deleteImage(image.object_key);
      onDeleted();
    } catch (err) {
      setTagError(err.message);
    }
  };

  const handleTag = async () => {
    if (tagging) return;
    setTagging(true);
    setTagError(null);
    try {
      let thumbnail = null;
      try {
        thumbnail = await makeThumbnail(src);
      } catch {
        thumbnail = null;
      }
      const payload = thumbnail
        ? { objectKey: image.object_key, thumbnail, prompt }
        : { objectKey: image.object_key, imageUrl: src, prompt };
      const res = await tagImage(payload);
      setTags(res.tags);
      onUpdated({ ...image, tags: res.tags.join(" ") });
    } catch (err) {
      setTagError(err.message);
    } finally {
      setTagging(false);
    }
  };

  const openPromptModal = (e) => {
    if (e) e.preventDefault();
    setDraftPrompt(prompt);
    setPromptModal(true);
  };

  const savePrompt = () => {
    const next = draftPrompt.trim() || DEFAULT_PROMPT;
    setPrompt(next);
    try {
      localStorage.setItem("masterPrompt", next);
    } catch {
      /* ignore */
    }
    setPromptModal(false);
  };
  return (
    <>
      {/* TopNavBar */}
      <nav className="bg-surface-container-lowest border-b border-outline-variant flex justify-between items-center w-full px-margin-page py-unit h-16 z-50">
        <div className="flex items-center gap-gutter">
          <span className="font-headline-md text-headline-md text-primary">
            NewsLens
          </span>
          <div className="ml-8 flex items-center bg-surface-container-low rounded-lg border border-outline-variant px-3 py-1.5 focus-within:bg-surface-container-lowest focus-within:border-tertiary-container transition-colors">
            <span
              className="material-symbols-outlined text-on-surface-variant mr-2"
              style={{ fontSize: "20px" }}
            >
              search
            </span>
            <input
              className="bg-transparent border-none outline-none text-body-sm text-on-surface w-64 placeholder-on-surface-variant focus:ring-0 p-0"
              placeholder="Search assets... (Cmd+K)"
              type="text"
            />
          </div>
        </div>
        <div className="flex items-center gap-gutter">
          <div className="flex gap-4">
            <button className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full flex items-center justify-center scale-95 active:opacity-80 transition-transform">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full flex items-center justify-center scale-95 active:opacity-80 transition-transform">
              <span className="material-symbols-outlined">settings</span>
            </button>
          </div>
          <button className="bg-tertiary text-on-tertiary font-label-caps text-label-caps px-4 py-2 rounded hover:bg-tertiary-container transition-colors">
            Upload
          </button>
          <Avatar />
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Canvas */}
        <main className="flex-1 bg-surface-bright flex flex-col relative">
          {/* Asset Toolbar */}
          <div className="h-12 border-b border-outline-variant bg-surface-container-lowest flex items-center justify-between px-margin-page">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="text-on-surface-variant hover:text-on-surface flex items-center gap-1 transition-colors"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "18px" }}
                >
                  arrow_back
                </span>
                <span className="font-label-caps text-label-caps">
                  Back to Grid
                </span>
              </button>
              <div className="w-px h-4 bg-outline-variant"></div>
              <span className="font-mono-data text-mono-data text-secondary">
                {image.original_filename}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigate(-1)}
                disabled={total <= 1}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant transition-colors disabled:opacity-40"
                title="Previous Asset (Left Arrow)"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <span className="font-mono-data text-mono-data text-secondary px-2">
                {index + 1} / {total}
              </span>
              <button
                onClick={() => onNavigate(1)}
                disabled={total <= 1}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant transition-colors disabled:opacity-40"
                title="Next Asset (Right Arrow)"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>

          {/* Image Viewer */}
          <div className="flex-1 p-margin-page flex items-center justify-center bg-background overflow-hidden">
            <div className="relative w-full h-full">
              <div
                className="w-full h-full overflow-auto flex items-center justify-center cursor-grab"
                onClick={() =>
                  setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))
                }
                title="Click to zoom in"
              >
                <div
                  className="relative transition-transform duration-200"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                  }}
                >
                  <img
                    alt="Current Asset"
                    className="max-w-full max-h-full object-contain shadow-sm border border-outline-variant rounded bg-surface-container-lowest"
                    src={src}
                  />
                </div>
              </div>
              <div className="absolute bottom-4 right-4 flex bg-surface-container-lowest border border-outline-variant rounded shadow-sm">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)));
                  }}
                  className="p-2 hover:bg-surface-container text-on-surface-variant transition-colors border-r border-outline-variant"
                  title="Zoom out"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px" }}
                  >
                    zoom_out
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom(1);
                  }}
                  className="p-2 hover:bg-surface-container text-on-surface-variant transition-colors border-r border-outline-variant"
                  title="Reset zoom"
                >
                  <span className="font-mono-data text-mono-data px-2">
                    {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.min(3, +(z + 0.5).toFixed(2)));
                  }}
                  className="p-2 hover:bg-surface-container text-on-surface-variant transition-colors"
                  title="Zoom in"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px" }}
                  >
                    zoom_in
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Quick Action Bar */}
          <div className="h-12 border-t border-outline-variant bg-surface-container-lowest flex items-center justify-center gap-6">
            <button
              onClick={() => onFavorite(image)}
              className={`flex items-center gap-2 transition-colors ${
                image.favorite
                  ? "text-tertiary-container"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              title={
                image.favorite ? "Remove from favorites" : "Add to favorites"
              }
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: "20px",
                  fontVariationSettings: image.favorite
                    ? "'FILL' 1"
                    : undefined,
                }}
              >
                {image.favorite ? "star" : "star_outline"}
              </span>
              <span className="font-label-caps text-label-caps">
                {image.favorite ? "Favorited" : "Favorite"}
              </span>
            </button>
            <div className="w-px h-4 bg-outline-variant"></div>
            <button
              onClick={() => image.url && window.open(image.url, "_blank")}
              className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                download
              </span>
              <span className="font-label-caps text-label-caps">
                Download High-Res
              </span>
            </button>
            <div className="w-px h-4 bg-outline-variant"></div>
            <button
              onClick={openCollections}
              className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors"
              title="Organize into collections"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                auto_awesome_motion
              </span>
              <span className="font-label-caps text-label-caps">
                Add to Collection
              </span>
            </button>
            <div className="w-px h-4 bg-outline-variant"></div>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 text-on-surface-variant hover:text-error transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                delete
              </span>
              <span className="font-label-caps text-label-caps">
                Move to Trash
              </span>
            </button>
          </div>
        </main>

        {/* Metadata & Tagging Panel */}
        <aside className="w-panel-width-fixed bg-surface-container-lowest border-l border-outline-variant flex flex-col h-full overflow-y-auto">
          <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center sticky top-0 z-10">
            <h2 className="font-title-sm text-title-sm text-on-surface">
              Metadata &amp; Tagging
            </h2>
            <button className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                more_horiz
              </span>
            </button>
          </div>
          <div className="p-4 flex flex-col gap-6">
            {/* Tagging Section */}
            <section>
              <div className="flex justify-between items-end mb-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant">
                  Tags
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTag}
                    onContextMenu={openPromptModal}
                    disabled={tagging}
                    title="Left-click: AI-tag this image. Right-click: edit master prompt."
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary text-on-tertiary font-label-caps text-label-caps hover:bg-tertiary-container transition-colors disabled:opacity-60"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "14px" }}
                    >
                      auto_awesome
                    </span>
                    {tagging ? "Tagging..." : "AI"}
                  </button>
                  <span className="font-mono-data text-mono-data text-secondary text-[10px]">
                    Cmd+T
                  </span>
                </div>
              </div>
              {tagError && (
                <p className="font-body-sm text-body-sm text-error mb-2">
                  {tagError}
                </p>
              )}
              {/* Existing Tags (Chips) */}
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 bg-surface-container-high border border-outline-variant text-on-surface font-body-sm text-body-sm px-2.5 py-1 rounded-full"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      disabled={saving}
                      className="text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                      title="Remove tag"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "14px" }}
                      >
                        close
                      </span>
                    </button>
                  </span>
                ))}
              </div>
              {/* Auto-suggest Input */}
              <form className="relative" onSubmit={addTag}>
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors"
                  placeholder={saving ? "Saving..." : "Add tags..."}
                  type="text"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="absolute right-2 top-2.5 text-on-surface-variant disabled:opacity-40"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "16px" }}
                  >
                    add
                  </span>
                </button>
              </form>
            </section>
            <hr className="border-outline-variant" />
            {/* Structured Data Section */}
            <section className="flex flex-col gap-4">
              <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                File Details
              </h3>
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-secondary">
                  Original Filename
                </label>
                <div className="flex items-center justify-between">
                  <span className="font-mono-data text-mono-data text-on-surface truncate">
                    {image.original_filename}
                  </span>
                  <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "16px" }}
                    >
                      content_copy
                    </span>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-secondary">
                  Date added
                </label>
                <span className="font-mono-data text-mono-data text-on-surface">
                  {image.created_at || "—"}
                </span>
              </div>
            </section>
            <hr className="border-outline-variant" />
          </div>
        </aside>
      </div>
      {/* Add to Collection Modal */}
      {collModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCollModal(false);
          }}
        >
          <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-5">
            <h3 className="font-title-sm text-title-sm text-on-surface mb-1">
              Add to Collection
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
              {image.original_filename}
            </p>
            {collError && (
              <p className="font-body-sm text-body-sm text-error mb-2">
                {collError}
              </p>
            )}
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto mb-4">
              {collectionsList.length === 0 && (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No collections yet — create one below.
                </p>
              )}
              {collectionsList.map((coll) => {
                const member = inCollection(coll);
                return (
                  <button
                    key={coll.id}
                    onClick={() => toggleCollection(coll)}
                    className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                      member
                        ? "bg-primary-container border-primary text-on-primary-fixed-variant"
                        : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[20px]">
                        auto_awesome_motion
                      </span>
                      <span className="font-body-sm text-body-sm">
                        {coll.name}
                      </span>
                    </span>
                    <span className="font-mono-data text-mono-data text-xs">
                      {member ? "Added" : `${coll.items.length} items`}
                    </span>
                  </button>
                );
              })}
            </div>
            <form onSubmit={createCollectionAndAdd} className="relative">
              <input
                value={newCollName}
                onChange={(e) => setNewCollName(e.target.value)}
                className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors pr-10"
                placeholder="New collection name..."
                type="text"
              />
              <button
                type="submit"
                className="absolute right-2 top-2 text-tertiary-container"
                title="Create and add"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
              </button>
            </form>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setCollModal(false)}
                className="px-4 py-2 rounded-lg font-label-caps text-label-caps text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Master Prompt Modal */}
      {promptModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptModal(false);
          }}
        >
          <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-5">
            <h3 className="font-title-sm text-title-sm text-on-surface mb-1">
              Master AI Tagging Prompt
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Used when you AI-tag any image. Right-click the AI button to
              reopen this editor.
            </p>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={4}
              className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors resize-y"
              placeholder="e.g. extract exact text and objects"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPromptModal(false)}
                className="px-4 py-2 rounded-lg font-label-caps text-label-caps text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={savePrompt}
                className="px-4 py-2 rounded-lg font-label-caps text-label-caps bg-tertiary text-on-tertiary hover:bg-tertiary-container transition-colors"
              >
                Save Prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
