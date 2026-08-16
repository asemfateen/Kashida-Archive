import { useEffect, useRef, useState } from "react";
import {
  enqueueAiJobs,
  getAiConfig,
  patchAiConfig,
  updateImage,
  deleteImage,
} from "../api.js";
import { pushError } from "../notify.jsx";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

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
  const [tags, setTags] = useState(() => [
    ...new Set((image.tags || "").split(" ").filter(Boolean)),
  ]);
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState(null);
  const [tagNotice, setTagNotice] = useState(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [promptModal, setPromptModal] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const tagRef = useRef(null);
  const navRef = useRef(null);
  const keyRef = useRef(image.object_key);

  const src = image.url || image.src;

  useEffect(() => {
    keyRef.current = image.object_key;
    setTags([...new Set((image.tags || "").split(" ").filter(Boolean))]);
    setZoom(1);
    setTagError(null);
    setTagNotice(null);
    setTagging(false);
  }, [image.object_key]);

  useEffect(() => {
    getAiConfig()
      .then(({ config }) => {
        if (config?.master_prompt) setPrompt(config.master_prompt);
      })
      .catch(() => {
        /* AI config is best-effort here */
      });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const typing =
        e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      if (typing) return;
      if (e.key === "Escape") {
        setPromptModal(false);
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
    setTagNotice(null);
    try {
      await enqueueAiJobs([image.object_key]);
      setTagNotice(
        "Added to the AI queue — it tags in the background. Check AI Control.",
      );
    } catch (err) {
      setTagError(err?.message || "Could not queue AI tagging");
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
    setPromptModal(false);
    patchAiConfig({ master_prompt: next }).catch((err) =>
      pushError(err?.message || "Could not save prompt"),
    );
  };

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Canvas */}
        <main className="flex-1 relative flex flex-col bg-background">
          {/* Floating Top Toolbar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-white/90 backdrop-blur-xl border border-black/5 shadow-soft rounded-full px-2 py-1.5 max-w-[calc(100%-32px)]">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "18px" }}
              >
                arrow_back
              </span>
              <span className="font-label-caps text-label-caps">Back</span>
            </button>
            <div className="w-px h-4 bg-black/10"></div>
            <span className="font-mono-data text-mono-data text-on-surface-variant truncate max-w-[180px] px-2">
              {image.original_filename}
            </span>
            <div className="w-px h-4 bg-black/10"></div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onNavigate(-1)}
                disabled={total <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors disabled:opacity-40"
                title="Previous Asset (Left Arrow)"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <span className="font-mono-data text-mono-data text-on-surface-variant px-1">
                {index + 1} / {total}
              </span>
              <button
                onClick={() => onNavigate(1)}
                disabled={total <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors disabled:opacity-40"
                title="Next Asset (Right Arrow)"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>

          {/* Image Stage */}
          <div className="flex-1 p-margin-page pt-20 flex items-center justify-center bg-surface-container overflow-hidden">
            <div className="relative w-full h-full">
              <div
                className="w-full h-full overflow-auto flex items-center justify-center cursor-grab"
                onClick={(e) => {
                  if (
                    e.target.tagName === "IMG" ||
                    e.target === e.currentTarget
                  ) {
                    setZoom((z) => (z === 1 ? 1.5 : 1));
                  }
                }}
                title={zoom === 1 ? "Click to zoom in" : "Click to zoom out"}
              >
                <div
                  className="flex items-center justify-center transition-all duration-200"
                  style={{
                    width: zoom === 1 ? "100%" : `${zoom * 100}%`,
                    height: zoom === 1 ? "100%" : `${zoom * 100}%`,
                  }}
                >
                  <img
                    alt="Current Asset"
                    className="max-w-full max-h-full object-contain rounded-3xl shadow-soft border border-black/5 bg-white"
                    src={src}
                  />
                </div>
              </div>
              {/* Zoom Controls */}
              <div className="absolute bottom-4 right-4 flex bg-white/90 backdrop-blur border border-black/5 rounded-full shadow-soft">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)));
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors"
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
                  className="flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors px-2"
                  title="Reset zoom"
                >
                  <span className="font-mono-data text-mono-data">
                    {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.min(3, +(z + 0.5).toFixed(2)));
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors"
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

          {/* Floating Quick Action Bar */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 bg-white/90 backdrop-blur-xl border border-black/5 shadow-soft rounded-full px-2 py-1.5">
            <button
              onClick={() => onFavorite(image)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
                image.favorite
                  ? "text-midnight-ink"
                  : "text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink"
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
            <div className="w-px h-4 bg-black/10"></div>
            <button
              onClick={() => image.url && window.open(image.url, "_blank")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                download
              </span>
              <span className="font-label-caps text-label-caps">Download</span>
            </button>
            <div className="w-px h-4 bg-black/10"></div>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                delete
              </span>
              <span className="font-label-caps text-label-caps">Trash</span>
            </button>
          </div>
        </main>

        {/* Metadata & Tagging Panel */}
        <aside className="w-panel-width-fixed bg-transparent flex flex-col overflow-y-auto p-4 gap-4">
          {/* Tags Card */}
          <section className="bg-white rounded-3xl shadow-soft border border-black/5 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                Tags
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTag}
                  onContextMenu={openPromptModal}
                  disabled={tagging}
                  title="Left-click: AI-tag this image. Right-click: edit master prompt."
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-colors disabled:opacity-60"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "14px" }}
                  >
                    auto_awesome
                  </span>
                  {tagging ? "Queueing..." : "AI"}
                </button>
                <span className="font-mono-data text-mono-data text-on-surface-variant text-[10px]">
                  Cmd+T
                </span>
              </div>
            </div>
            {tagError && (
              <p className="font-body-sm text-body-sm text-error bg-error/10 border border-error/30 rounded-xl px-3 py-2">
                {tagError}
              </p>
            )}
            {tagNotice && (
              <p className="font-body-sm text-body-sm text-midnight-ink bg-surface-container-low rounded-xl px-3 py-2">
                {tagNotice}
              </p>
            )}
            {/* Existing Tags (Chips) */}
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 bg-surface-container-low border border-black/5 text-on-surface font-body-sm text-body-sm px-2.5 py-1 rounded-full"
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
                className="w-full bg-surface-container-low border border-black/5 rounded-xl px-3 py-2 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                placeholder={saving ? "Saving..." : "Add tags..."}
                type="text"
              />
              <button
                type="submit"
                disabled={saving}
                className="absolute right-2 top-2 text-on-surface-variant disabled:opacity-40"
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

          {/* File Details Card */}
          <section className="bg-white rounded-3xl shadow-soft border border-black/5 p-4 flex flex-col gap-4">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              File Details
            </h3>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Original Filename
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-data text-mono-data text-on-surface truncate">
                  {image.original_filename}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Date added
              </label>
              <span className="font-mono-data text-mono-data text-on-surface">
                {image.created_at || "—"}
              </span>
            </div>
          </section>
        </aside>
      </div>

      {/* Master Prompt Modal */}
      {promptModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptModal(false);
          }}
        >
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-soft border border-black/5 p-6">
            <h3 className="text-lg font-bold text-midnight-ink tracking-tight mb-1">
              Master AI Tagging Prompt
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Used when you AI-tag any image. Saved to the server — right-click
              the AI button to reopen this editor.
            </p>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={4}
              className="w-full bg-surface-container-low border border-black/5 rounded-xl px-3 py-2 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors resize-y"
              placeholder="e.g. extract exact text and objects"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPromptModal(false)}
                className="px-4 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant border border-black/5 hover:bg-surface-container-low transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={savePrompt}
                className="px-4 py-2 rounded-full font-label-caps text-label-caps bg-midnight-ink text-white hover:bg-prussian-navy transition-colors"
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
