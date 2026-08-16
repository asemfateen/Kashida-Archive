import { useCallback, useEffect, useState } from "react";
import {
  cancelAllAiJobs,
  deleteAiJob,
  enqueueAiJobs,
  getAiConfig,
  getAiStatus,
  listAiJobs,
  patchAiConfig,
  patchAiJob,
  retryAiJob,
  retryAllFailedAiJobs,
  updateImage,
} from "../api.js";
import { pushError } from "../notify.jsx";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "queued", label: "Waiting" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
  { key: "canceled", label: "Cancelled" },
];

const STATUS_CHIP = {
  queued: "bg-ice-slate/70 text-on-surface-variant",
  running: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-error/10 text-error",
  canceled: "bg-gray-100 text-on-surface-variant",
};

const STATUS_LABEL = {
  queued: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  canceled: "Cancelled",
};

const fmtTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-label-caps text-label-caps ${STATUS_CHIP[status] || STATUS_CHIP.queued}`}
    >
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
      )}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function StatusBanner({ status }) {
  const cfg = status?.config || {};
  const quota = status?.quota || {};
  const queue = status?.queue || {};
  const usage = quota.usage || 0;
  const dailyLimit = quota.daily_limit || 20;
  const pct = Math.min(100, Math.round((usage / dailyLimit) * 100));

  let tone = "good";
  let icon = "monitor_heart";
  let title = "AI is running normally";
  let detail =
    "The queue is processing in the background, pacing requests so Gemini's quota stays safe.";

  if (status?.configured === false) {
    tone = "off";
    icon = "power_off";
    title = "AI is not configured";
    detail =
      "Add a GEMINI_API_KEY to the server environment to enable tagging.";
  } else if (status?.paused) {
    tone = "paused";
    icon = "pause_circle";
    title = "AI is paused";
    detail = "The queue is stopped — nothing will be tagged until you resume.";
  } else if (quota.rate_limited) {
    tone = "limited";
    icon = "hourglass_top";
    title = `Rate-limited until ${fmtTime(quota.rate_limited_until)}`;
    detail = "Gemini hit its limit — the queue pauses and resumes on its own.";
  }

  const bannerClass =
    tone === "good"
      ? "bg-emerald-50 border-emerald-200"
      : tone === "off"
        ? "bg-error/5 border-error/20"
        : tone === "limited"
          ? "bg-amber-50 border-amber-200"
          : "bg-ice-slate/50 border-black/10";

  const dotClass =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "off"
        ? "bg-error"
        : tone === "limited"
          ? "bg-amber-500"
          : "bg-on-surface-variant";

  const iconClass =
    tone === "good"
      ? "text-emerald-600 bg-emerald-100"
      : tone === "off"
        ? "text-error bg-error/10"
        : tone === "limited"
          ? "text-amber-600 bg-amber-100"
          : "text-on-surface-variant bg-black/5";

  const barClass =
    pct >= 100 ? "bg-error" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div
      className={`rounded-3xl border shadow-soft p-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between ${bannerClass}`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`}
        >
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-midnight-ink tracking-tight">
              {title}
            </h2>
            <span className={`w-2 h-2 rounded-full ${dotClass}`}></span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
            {detail}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:items-end shrink-0">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 bg-white border border-black/10 rounded-full px-3 py-1 font-mono-data text-mono-data text-on-surface">
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
              auto_awesome
            </span>
            {status?.model || "gemini"}
          </span>
          {queue && (
            <span className="inline-flex items-center gap-1.5 bg-white border border-black/10 rounded-full px-3 py-1 font-mono-data text-mono-data text-on-surface">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
                pending_actions
              </span>
              {queue.queued + queue.running} in queue
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 w-48">
          <div className="flex items-center justify-between font-label-caps text-label-caps text-on-surface-variant">
            <span>Daily usage</span>
            <span className="font-mono-data text-mono-data">
              {usage} / {dailyLimit}
            </span>
          </div>
          <div className="h-1.5 bg-black/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobCard({
  job,
  expanded,
  onToggle,
  onRetry,
  onCancel,
  onDelete,
  onSavePrompt,
  onSaveTags,
  masterPrompt,
  saving,
}) {
  const [promptDraft, setPromptDraft] = useState(job.prompt || masterPrompt);
  const [tagsDraft, setTagsDraft] = useState(job.result_tags || "");

  useEffect(() => {
    setPromptDraft(job.prompt || masterPrompt);
    setTagsDraft(job.result_tags || "");
  }, [job.prompt, job.result_tags, masterPrompt, job.id]);

  const filename = job.original_filename || job.object_key.split("/").pop();

  return (
    <div className="rounded-3xl bg-white shadow-soft border border-gray-100 hover:shadow-lg transition-all duration-200 overflow-hidden">
      <div
        className="flex items-center gap-4 p-3 cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="w-14 h-14 rounded-2xl bg-surface-container-low overflow-hidden shrink-0 border border-black/5">
          {job.thumb ? (
            <img
              src={job.thumb}
              alt={filename}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined text-on-surface-variant">
                image
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-body-md text-body-md text-midnight-ink font-medium truncate">
              {filename}
            </span>
            <StatusChip status={job.status} />
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
            {job.status === "done" ? (
              <span className="text-on-surface">
                {job.result_tags || "No tags returned"}
              </span>
            ) : job.status === "failed" ? (
              <span className="text-error">
                {job.error || "AI tagging failed"}
              </span>
            ) : job.status === "running" ? (
              "AI is analyzing this photo..."
            ) : job.status === "canceled" ? (
              "Cancelled — will not be tagged."
            ) : (
              <>
                {job.prompt ? "Custom prompt · " : ""}Waiting in line
                {job.attempts > 0 ? ` · attempt ${job.attempts + 1}` : ""}
              </>
            )}
          </p>
          <p className="font-mono-data text-mono-data text-on-surface-variant/70 mt-0.5">
            Added {fmtDate(job.created_at)}
          </p>
        </div>
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {job.status === "failed" && (
            <ActionButton
              icon="refresh"
              title="Retry this photo"
              onClick={onRetry}
              className="hover:bg-midnight-ink hover:text-white"
            />
          )}
          {job.status === "canceled" && (
            <ActionButton
              icon="restart_alt"
              title="Re-queue this photo"
              onClick={onRetry}
              className="hover:bg-midnight-ink hover:text-white"
            />
          )}
          {job.status === "queued" && (
            <ActionButton
              icon="close"
              title="Cancel this photo"
              onClick={onCancel}
              className="hover:bg-error hover:text-on-error"
            />
          )}
          {["done", "failed", "canceled"].includes(job.status) && (
            <ActionButton
              icon="delete"
              title="Remove from queue"
              onClick={onDelete}
              className="hover:bg-error hover:text-on-error"
            />
          )}
          <ActionButton
            icon={expanded ? "expand_less" : "expand_more"}
            title={expanded ? "Collapse" : "Edit prompt or tags"}
            onClick={onToggle}
            className="hover:bg-white"
          />
        </div>
      </div>

      {expanded && (
        <div className="mx-3 mb-3 px-4 py-4 rounded-2xl bg-surface-container-low border border-black/5 flex flex-col gap-4">
          {job.status === "done" ? (
            <div>
              <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1.5">
                Edit the photo's tags
              </label>
              <div className="flex gap-2">
                <input
                  value={tagsDraft}
                  onChange={(e) => setTagsDraft(e.target.value)}
                  className="flex-1 bg-white border border-black/10 rounded-xl px-3 py-2 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                  placeholder="e.g. protest, cairo, rally"
                />
                <button
                  disabled={saving}
                  onClick={() => onSaveTags(tagsDraft)}
                  className="px-4 py-2 rounded-xl bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-colors disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1.5">
                Prompt for this photo
              </label>
              <div className="flex gap-2">
                <input
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  className="flex-1 bg-white border border-black/10 rounded-xl px-3 py-2 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                  placeholder={DEFAULT_PROMPT}
                />
                <button
                  disabled={saving}
                  onClick={() => onSavePrompt(promptDraft)}
                  className="px-4 py-2 rounded-xl bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-colors disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
                Leave empty to use the master prompt. Saved to the server.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, title, onClick, className }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-8 h-8 flex items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant border border-black/5 transition-all active:scale-90 ${className || ""}`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}

function FilterTab({ active, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-label-caps text-label-caps transition-colors ${
        active
          ? "bg-midnight-ink text-white"
          : "bg-white/40 text-on-surface-variant hover:bg-white hover:text-midnight-ink shadow-sm border border-black/5"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={`font-mono-data text-mono-data ${
            active ? "text-white/70" : "text-on-surface-variant/70"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function Ai() {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(null);
  const [toast, setToast] = useState(null);
  const [configDraft, setConfigDraft] = useState({
    master_prompt: "",
    min_interval_ms: 1500,
    daily_limit: 20,
  });
  const [configSaved, setConfigSaved] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        getAiStatus(),
        listAiJobs({ limit: 300 }),
      ]);
      setStatus(s);
      setJobs(j);
    } catch (err) {
      pushError(err?.message || "Failed to refresh AI status");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    getAiConfig()
      .then(({ config }) =>
        setConfigDraft({
          master_prompt: config.master_prompt || "",
          min_interval_ms: config.min_interval_ms ?? 1500,
          daily_limit: config.daily_limit ?? 20,
        }),
      )
      .catch(() => {
        /* banner already shows connectivity issues */
      });
  }, []);

  const togglePause = async () => {
    try {
      await patchAiConfig({ paused: !status.paused });
      showToast(status.paused ? "AI queue resumed" : "AI queue paused");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not toggle pause");
    }
  };

  const retryOne = async (job) => {
    try {
      await retryAiJob(job.id);
      showToast("Back in the queue");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not retry");
    }
  };

  const cancelOne = async (job) => {
    try {
      await patchAiJob(job.id, { status: "canceled" });
      showToast("Cancelled");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not cancel");
    }
  };

  const deleteOne = async (job) => {
    try {
      await deleteAiJob(job.id);
      showToast("Removed from queue");
      if (expanded === job.id) setExpanded(null);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not remove job");
    }
  };

  const retryAll = async () => {
    try {
      const res = await retryAllFailedAiJobs();
      showToast(
        `Re-queued ${res.requeued} failed photo${res.requeued === 1 ? "" : "s"}`,
      );
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not retry failed photos");
    }
  };

  const cancelAll = async () => {
    if (
      !window.confirm(
        "Cancel every photo waiting in the queue? Running photos finish first.",
      )
    )
      return;
    try {
      const res = await cancelAllAiJobs();
      showToast(
        `Cancelled ${res.canceled} waiting photo${res.canceled === 1 ? "" : "s"}`,
      );
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not cancel queue");
    }
  };

  const savePrompt = async (job, prompt) => {
    setSaving(job.id);
    try {
      await patchAiJob(job.id, { prompt: prompt.trim() || null });
      showToast("Prompt saved");
      setExpanded(null);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not save prompt");
    } finally {
      setSaving(null);
    }
  };

  const saveTags = async (job, tags) => {
    setSaving(job.id);
    try {
      await updateImage(job.object_key, { tags });
      showToast("Tags updated");
      setExpanded(null);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not save tags");
    } finally {
      setSaving(null);
    }
  };

  const saveConfig = async (e) => {
    if (e) e.preventDefault();
    try {
      await patchAiConfig({
        master_prompt: configDraft.master_prompt.trim(),
        min_interval_ms: Number(configDraft.min_interval_ms),
        daily_limit: Number(configDraft.daily_limit),
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      showToast("AI settings saved");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not save settings");
    }
  };

  const counts = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;

  const visible =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
  const failedCount = counts.failed || 0;

  return (
    <main className="flex-1 bg-background overflow-y-auto flex flex-col relative">
      <div className="p-margin-page pb-24">
        <div className="max-w-5xl mx-auto flex flex-col gap-6 pb-16">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-headline-md text-headline-md text-midnight-ink tracking-tight font-bold">
                AI Control
              </h1>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Every Gemini tag runs through this queue — watch it, edit it,
                retry it.
              </p>
            </div>
            <button
              onClick={togglePause}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-label-caps text-label-caps transition-colors ${
                status?.paused
                  ? "bg-midnight-ink text-white hover:bg-prussian-navy"
                  : "bg-white border border-black/10 text-midnight-ink hover:bg-surface-container-low shadow-sm"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {status?.paused ? "play_arrow" : "pause"}
              </span>
              {status?.paused ? "Resume queue" : "Pause queue"}
            </button>
          </div>

          <StatusBanner status={status} />

          {/* Queue */}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
            <div className="flex items-center gap-2">
              <h2 className="font-title-sm text-title-sm text-midnight-ink font-semibold">
                Queue
              </h2>
              <span className="font-mono-data text-mono-data text-on-surface-variant">
                {jobs.length} total
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {failedCount > 0 && (
                <button
                  onClick={retryAll}
                  className="flex items-center gap-1.5 bg-midnight-ink text-white px-4 py-2 rounded-full font-label-caps text-label-caps hover:bg-prussian-navy transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    refresh
                  </span>
                  Retry {failedCount} failed
                </button>
              )}
              <button
                onClick={cancelAll}
                disabled={!counts.queued}
                className="flex items-center gap-1.5 bg-white/40 text-on-surface-variant px-4 py-2 rounded-full font-label-caps text-label-caps border border-black/5 hover:bg-white hover:text-midnight-ink transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[16px]">
                  block
                </span>
                Cancel waiting
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap -mt-2">
            {FILTERS.map((f) => (
              <FilterTab
                key={f.key}
                active={filter === f.key}
                label={f.label}
                count={f.key === "all" ? jobs.length : counts[f.key]}
                onClick={() => setFilter(f.key)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-3xl bg-white/40 border border-black/5">
                <div className="w-14 h-14 rounded-2xl bg-surface-container-low flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl text-on-surface-variant">
                    {filter === "failed" ? "task_alt" : "auto_awesome"}
                  </span>
                </div>
                <p className="font-title-sm text-title-sm text-midnight-ink">
                  {filter === "all"
                    ? "The queue is empty"
                    : `No ${STATUS_LABEL[filter] || filter} photos`}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm">
                  Select photos in the gallery and hit{" "}
                  <span className="font-medium">Tag → AI tag</span> — they'll
                  appear here and process automatically.
                </p>
              </div>
            ) : (
              visible.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  expanded={expanded === job.id}
                  onToggle={() =>
                    setExpanded((prev) => (prev === job.id ? null : job.id))
                  }
                  onRetry={() => retryOne(job)}
                  onCancel={() => cancelOne(job)}
                  onDelete={() => deleteOne(job)}
                  onSavePrompt={(p) => savePrompt(job, p)}
                  onSaveTags={(t) => saveTags(job, t)}
                  masterPrompt={status?.config?.master_prompt || DEFAULT_PROMPT}
                  saving={saving === job.id}
                />
              ))
            )}
          </div>

          {/* Settings */}
          <section className="rounded-3xl bg-white shadow-soft border border-gray-100 p-6 mt-2">
            <h2 className="font-title-sm text-title-sm text-midnight-ink font-semibold mb-1">
              Settings
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-5">
              Saved to the server and applied to every photo that goes through
              the queue.
            </p>
            <form onSubmit={saveConfig} className="flex flex-col gap-5">
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1.5">
                  Master prompt
                </label>
                <textarea
                  value={configDraft.master_prompt}
                  onChange={(e) =>
                    setConfigDraft((p) => ({
                      ...p,
                      master_prompt: e.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full bg-surface-container-low border border-black/10 rounded-2xl px-4 py-3 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors resize-y"
                  placeholder={DEFAULT_PROMPT}
                />
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
                  The instruction Gemini follows for every photo unless a photo
                  has its own prompt.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1.5">
                    Pacing between requests (seconds)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="600"
                    step="0.5"
                    value={configDraft.min_interval_ms / 1000}
                    onChange={(e) =>
                      setConfigDraft((p) => ({
                        ...p,
                        min_interval_ms: Math.max(
                          0,
                          Number(e.target.value) * 1000,
                        ),
                      }))
                    }
                    className="w-full bg-surface-container-low border border-black/10 rounded-xl px-3 py-2 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1.5">
                    Daily request limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    value={configDraft.daily_limit}
                    onChange={(e) =>
                      setConfigDraft((p) => ({
                        ...p,
                        daily_limit: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-surface-container-low border border-black/10 rounded-xl px-3 py-2 text-body-md text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className={`px-6 py-2.5 rounded-full font-label-caps text-label-caps transition-colors ${
                    configSaved
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-midnight-ink text-white hover:bg-prussian-navy"
                  }`}
                >
                  {configSaved ? "Saved" : "Save settings"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-on-surface text-surface-container-lowest px-4 py-2 rounded-full font-body-sm text-body-sm shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}
