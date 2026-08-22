import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  countTags,
  enqueueAiJobs,
  getAiConfig,
  patchAiConfig,
  updateImage,
  deleteImage,
} from "../api.js";
import { DEFAULT_PROMPT } from "../constants.js";
import { pushError } from "../notify.jsx";

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
  const [tagCounts, setTagCounts] = useState({});
  const tagRef = useRef(null);
  const navRef = useRef(null);
  const keyRef = useRef(image.object_key);

  const src = image.url || image.src;
  const navigate = useNavigate();

  useEffect(() => {
    keyRef.current = image.object_key;
    setTags([...new Set((image.tags || "").split(" ").filter(Boolean))]);
    setZoom(1);
    setTagError(null);
    setTagNotice(null);
    setTagging(false);
    setTagCounts({});
    const imageTags = [
      ...new Set((image.tags || "").split(" ").filter(Boolean)),
    ];
    if (imageTags.length > 0) {
      countTags(imageTags)
        .then((rows) =>
          setTagCounts(Object.fromEntries(rows.map((r) => [r.tag, r.n]))),
        )
        .catch(() => {});
    }
  }, [image.object_key]);

  useEffect(() => {
    getAiConfig()
      .then(({ config }) => {
        if (config?.master_prompt) setPrompt(config.master_prompt);
      })
      .catch(() => {});
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
        <main className="flex-1 relative flex flex-col bg-background">
          {/* Floating Top Toolbar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 floating-bar flex items-center gap-1 px-2 py-1.5 max-w-[calc(100%-32px)] animate-in-down">
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
            <div className="w-px h-4 bg-black/10 dark:bg-white/[0.08]"></div>
            <span className="font-mono-data text-mono-data text-on-surface-variant truncate max-w-[180px] px-2 text-xs">
              {image.original_filename}
            </span>
            <div className="w-px h-4 bg-black/10 dark:bg-white/[0.08]"></div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onNavigate(-1)}
                disabled={total <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-midnight-ink transition-colors disabled:opacity-40"
                title="Previous Asset (Left Arrow)"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <span className="font-mono-data text-mono-data text-on-surface-variant px-1 text-xs">
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
          <div className="flex-1 p-margin-page pt-20 flex items-center justify-center bg-surface-container dark:bg-dark-surface-container-low image-stage overflow-hidden">
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
                  className="flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    width: zoom === 1 ? "100%" : `${zoom * 100}%`,
                    height: zoom === 1 ? "100%" : `${zoom * 100}%`,
                  }}
                >
                  <img
                    alt="Current Asset"
                    className="max-w-full max-h-full object-contain rounded-3xl shadow-soft dark:shadow-dark-soft border border-black/5 dark:border-dark-outline-variant bg-white dark:bg-dark-surface-container-high transition-shadow duration-300"
                    src={src}
                  />
                </div>
              </div>
              {/* Zoom Controls */}
              <div className="absolute bottom-4 right-4 floating-bar flex items-center px-1 py-1 animate-in-up" style={{ animationDelay: "200ms" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)));
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-surface-container-low dark:hover:bg-dark-surface-container-highest hover:text-midnight-ink dark:hover:text-dark-primary transition-all duration-200 active:scale-90"
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
                  className="flex items-center justify-center rounded-full text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-surface-container-low dark:hover:bg-dark-surface-container-highest hover:text-midnight-ink dark:hover:text-dark-primary transition-all duration-200 px-2 active:scale-90"
                  title="Reset zoom"
                >
                  <span className="font-mono-data text-mono-data text-xs">
                    {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoom((z) => Math.min(3, +(z + 0.5).toFixed(2)));
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-surface-container-low dark:hover:bg-dark-surface-container-highest hover:text-midnight-ink dark:hover:text-dark-primary transition-all duration-200 active:scale-90"
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
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 floating-bar flex items-center gap-0.5 px-2 py-1.5 animate-in-up" style={{ animationDelay: "150ms" }}>
            <button
              onClick={() => onFavorite(image)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors duration-200 ${
                image.favorite
                  ? "text-midnight-ink dark:text-dark-primary"
                  : "text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-surface-container-low dark:hover:bg-dark-surface-container-highest hover:text-midnight-ink dark:hover:text-dark-primary"
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
            <div className="w-px h-4 bg-black/10 dark:bg-white/[0.08]"></div>
            <button
              onClick={() => image.url && window.open(image.url, "_blank")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-surface-container-low dark:hover:bg-dark-surface-container-highest hover:text-midnight-ink dark:hover:text-dark-primary transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                download
              </span>
              <span className="font-label-caps text-label-caps">Download</span>
            </button>
            <div className="w-px h-4 bg-black/10 dark:bg-white/[0.08]"></div>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-on-surface-variant dark:text-dark-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-colors"
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
          <section className="bg-white dark:bg-dark-surface-container-high rounded-2xl shadow-soft dark:shadow-dark-soft border border-black/5 dark:border-dark-outline-variant p-4 flex flex-col gap-3 transition-colors duration-300">
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
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-all duration-200 disabled:opacity-60 active:scale-95"
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
              <p className="font-body-sm text-body-sm text-error bg-error/10 border border-error/30 rounded-xl px-3 py-2 animate-fade-in">
                {tagError}
              </p>
            )}
            {tagNotice && (
              <p className="font-body-sm text-body-sm text-midnight-ink bg-surface-container-low rounded-xl px-3 py-2 animate-fade-in">
                {tagNotice}
              </p>
            )}
            {/* Existing Tags (Chips) */}
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="tag-chip"
                >
                  <button
                    onClick={() => navigate(`/?q=${encodeURIComponent(tag)}`)}
                    className="hover:text-midnight-ink hover:underline underline-offset-2 transition-colors flex items-center gap-1.5"
                    title={`Search archive for "${tag}"`}
                  >
                    {tag}
                    {tagCounts[tag] !== undefined && (
                      <span className="font-mono-data text-mono-data text-[10px] bg-white/70 border border-black/10 rounded-full px-1.5 py-0.5 leading-none">
                        {tagCounts[tag]}
                      </span>
                    )}
                  </button>
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
                className="input-base w-full text-body-sm pr-8"
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
          <section className="bg-white dark:bg-dark-surface-container-high rounded-2xl shadow-soft dark:shadow-dark-soft border border-black/5 dark:border-dark-outline-variant p-4 flex flex-col gap-4 transition-colors duration-300">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              File Details
            </h3>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Original Filename
              </label>
              <div className="bg-surface-container-low dark:bg-dark-surface-container-highest rounded-xl px-3 py-2 border border-black/5 dark:border-dark-outline-variant">
                <span className="font-mono-data text-mono-data text-on-surface dark:text-dark-on-surface truncate text-sm block">
                  {image.original_filename}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Date added
              </label>
              <span className="font-mono-data text-mono-data text-on-surface text-sm">
                {image.created_at || "—"}
              </span>
            </div>
          </section>
        </aside>
      </div>

      {/* Master Prompt Modal */}
      {promptModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Master AI tagging prompt"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptModal(false);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-dark-surface-container-high rounded-[2rem] shadow-soft-lg dark:shadow-dark-soft-lg border border-black/5 dark:border-dark-outline-variant p-6 animate-fade-in-up">
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
              className="input-base w-full resize-y"
              placeholder="e.g. extract exact text and objects"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPromptModal(false)}
                className="btn-pill-secondary px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={savePrompt}
                className="btn-pill-primary px-4 py-2"
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
