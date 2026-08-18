import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelAllAiJobs,
  clearDoneAiJobs,
  deleteAiJob,
  getAiConfig,
  getAiStatus,
  listAiJobs,
  patchAiConfig,
  patchAiJob,
  retryAiJob,
  retryAllFailedAiJobs,
  tagAllUntagged,
  updateImage,
} from "../api.js";
import { pushError } from "../notify.jsx";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

const VIEWS = [
  { key: "queue", label: "Queue", icon: "view_list" },
  { key: "board", label: "Board", icon: "view_kanban" },
  { key: "table", label: "Table", icon: "table_rows" },
];

const STATUS_META = {
  queued: { color: "bg-amber-100 text-amber-700", dot: "bg-amber-500", label: "Waiting" },
  running: { color: "bg-blue-50 text-blue-600", dot: "bg-blue-500", label: "Running" },
  done: { color: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Done" },
  failed: { color: "bg-rose-50 text-rose-600", dot: "bg-rose-500", label: "Failed" },
  canceled: { color: "bg-gray-100 text-gray-500", dot: "bg-gray-400", label: "Cancelled" },
};

const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

function Thumb({ src, alt, size = "w-10 h-10" }) {
  return (
    <div className={`${size} rounded-lg bg-surface-container-low overflow-hidden shrink-0 border border-black/5`}>
      {src ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[16px]">image</span>
        </div>
      )}
    </div>
  );
}

function LiveDot({ active }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? "bg-emerald-500" : "bg-gray-300"}`}></span>
    </span>
  );
}

function SectionHeader({ label, count, icon, collapsed, onToggle, accent, headerAction }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 py-2 px-1 group cursor-pointer"
    >
      <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{icon}</span>
      <span className="font-title-sm text-title-sm text-midnight-ink font-semibold">{label}</span>
      <span className={`font-mono-data text-mono-data px-1.5 py-0.5 rounded-md ${accent || "bg-surface-container text-on-surface-variant"}`}>
        {count}
      </span>
      {headerAction && (
        <span className="ml-1" onClick={(e) => e.stopPropagation()}>
          {headerAction}
        </span>
      )}
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 ml-auto group-hover:text-on-surface-variant transition-colors">
        {collapsed ? "expand_more" : "expand_less"}
      </span>
    </button>
  );
}

function InlineJob({ job, onRetry, onCancel, onDelete, onEditPrompt, onEditTags, expanded, onToggle, masterPrompt, saving }) {
  const [promptDraft, setPromptDraft] = useState(job.prompt || masterPrompt);
  const [tagsDraft, setTagsDraft] = useState(job.result_tags || "");

  useEffect(() => {
    setPromptDraft(job.prompt || masterPrompt);
    setTagsDraft(job.result_tags || "");
  }, [job.prompt, job.result_tags, masterPrompt, job.id]);

  const filename = job.original_filename || job.object_key.split("/").pop();
  const meta = STATUS_META[job.status] || STATUS_META.queued;
  const isRunning = job.status === "running";

  return (
    <div className={`rounded-xl border transition-all duration-150 ${expanded ? "bg-white shadow-soft border-black/10" : "bg-white/60 border-black/5 hover:bg-white hover:border-black/10"}`}>
      <div
        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
        onClick={onToggle}
      >
        <Thumb src={job.thumb} alt={filename} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-body-md text-body-md text-midnight-ink font-medium truncate max-w-[240px]">
              {filename}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-caps text-label-caps ${meta.color}`}>
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>}
              {meta.label}
            </span>
            {job.attempts > 0 && job.status !== "done" && (
              <span className="font-mono-data text-mono-data text-on-surface-variant/60">
                #{job.attempts + 1}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {job.status === "done" && job.result_tags ? (
              <span className="font-mono-data text-mono-data text-on-surface-variant truncate">
                {job.result_tags}
              </span>
            ) : job.status === "failed" && job.error ? (
              <span className="font-body-sm text-body-sm text-rose-500 truncate max-w-[320px]">
                {job.error}
              </span>
            ) : (
              <span className="font-body-sm text-body-sm text-on-surface-variant/60">
                {job.status === "queued" ? (job.prompt ? "Custom prompt" : "Waiting") : job.status === "running" ? "Analyzing..." : fmtDate(job.created_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {job.status === "failed" && (
            <Action icon="refresh" title="Retry" onClick={onRetry} />
          )}
          {job.status === "canceled" && (
            <Action icon="restart_alt" title="Re-queue" onClick={onRetry} />
          )}
          {job.status === "queued" && (
            <Action icon="close" title="Cancel" onClick={onCancel} danger />
          )}
          {["done", "failed", "canceled"].includes(job.status) && (
            <Action icon="delete" title="Remove" onClick={onDelete} danger />
          )}
          {["queued", "running", "failed"].includes(job.status) && (
            <Action icon="edit" title="Custom prompt" onClick={onToggle} />
          )}
          {job.status === "done" && (
            <Action icon="sell" title="Edit tags" onClick={onToggle} />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-black/5">
          {job.status === "done" ? (
            <div className="flex items-center gap-2">
              <input
                value={tagsDraft}
                onChange={(e) => setTagsDraft(e.target.value)}
                className="flex-1 bg-surface-container-low border border-black/10 rounded-lg px-3 py-1.5 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                placeholder="e.g. protest, cairo, rally"
              />
              <button
                disabled={saving}
                onClick={() => onEditTags(tagsDraft)}
                className="px-3 py-1.5 rounded-lg bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          ) : (
            <div>
              <input
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="w-full bg-surface-container-low border border-black/10 rounded-lg px-3 py-1.5 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                placeholder={DEFAULT_PROMPT}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="font-body-sm text-body-sm text-on-surface-variant/60">
                  Leave empty to use master prompt
                </span>
                <button
                  disabled={saving}
                  onClick={() => onEditPrompt(promptDraft)}
                  className="px-3 py-1.5 rounded-lg bg-midnight-ink text-white font-label-caps text-label-caps hover:bg-prussian-navy transition-colors disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Action({ icon, title, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90 ${
        danger
          ? "text-on-surface-variant/50 hover:bg-rose-50 hover:text-rose-600"
          : "text-on-surface-variant/50 hover:bg-surface-container hover:text-midnight-ink"
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}

function StatusBanner({ status }) {
  const quota = status?.quota || {};
  const queue = status?.queue || {};
  const usage = quota.usage || 0;
  const dailyLimit = quota.daily_limit || 50;
  const pct = Math.min(100, Math.round((usage / dailyLimit) * 100));
  const isPaused = status?.paused;
  const isLimited = quota.rate_limited;
  const isActive = !isPaused && !isLimited && (queue.queued + queue.running) > 0;

  let bg = "bg-emerald-50/60 border-emerald-200/60";
  let dot = "bg-emerald-500";
  let msg = "Queue is processing";

  if (!status?.configured) {
    bg = "bg-rose-50/60 border-rose-200/60";
    dot = "bg-rose-500";
    msg = "AI not configured";
  } else if (isPaused) {
    bg = "bg-gray-50 border-gray-200";
    dot = "bg-gray-400";
    msg = "Queue paused";
  } else if (isLimited) {
    bg = "bg-amber-50/60 border-amber-200/60";
    dot = "bg-amber-500";
    msg = `Rate limited until ${fmtTime(quota.rate_limited_until)}`;
  }

  return (
    <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-4 ${bg}`}>
      <div className="flex items-center gap-3">
        <LiveDot active={isActive} />
        <span className="font-body-md text-body-md text-midnight-ink font-medium">{msg}</span>
        <span className="font-mono-data text-mono-data text-on-surface-variant/60">
          {status?.model || "gemini"}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono-data text-mono-data text-on-surface-variant">
          {queue.queued + queue.running} in queue
        </span>
        <div className="w-32 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
          <span className="font-mono-data text-mono-data text-on-surface-variant/60 shrink-0">
            {usage}/{dailyLimit}
          </span>
        </div>
      </div>
    </div>
  );
}

function SettingsBar({ configDraft, setConfigDraft, onSave, saved, onTogglePause, paused }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-black/5 bg-white/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-surface-container-low/50 transition-colors"
      >
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant">tune</span>
        <span className="font-title-sm text-title-sm text-midnight-ink font-semibold">Settings</span>
        <div className="flex-1"></div>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePause(); }}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-label-caps text-label-caps transition-colors ${
            paused
              ? "bg-midnight-ink text-white hover:bg-prussian-navy"
              : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">{paused ? "play_arrow" : "pause"}</span>
          {paused ? "Resume" : "Pause"}
        </button>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-black/5">
          <div className="flex flex-col gap-3">
            <div>
              <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Master prompt</label>
              <textarea
                value={configDraft.master_prompt}
                onChange={(e) => setConfigDraft((p) => ({ ...p, master_prompt: e.target.value }))}
                rows={2}
                className="w-full bg-surface-container-low border border-black/10 rounded-xl px-3 py-2 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors resize-y"
                placeholder={DEFAULT_PROMPT}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Pacing (sec)</label>
                <input
                  type="number"
                  min="0"
                  max="600"
                  step="0.5"
                  value={configDraft.min_interval_ms / 1000}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, min_interval_ms: Math.max(0, Number(e.target.value) * 1000) }))}
                  className="w-full bg-surface-container-low border border-black/10 rounded-xl px-3 py-1.5 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                />
              </div>
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Daily limit</label>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={configDraft.daily_limit}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, daily_limit: Number(e.target.value) }))}
                  className="w-full bg-surface-container-low border border-black/10 rounded-xl px-3 py-1.5 text-body-sm text-on-surface focus:border-midnight-ink focus:ring-1 focus:ring-midnight-ink outline-none transition-colors"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onSave}
                className={`px-4 py-1.5 rounded-full font-label-caps text-label-caps transition-colors ${
                  saved ? "bg-emerald-100 text-emerald-700" : "bg-midnight-ink text-white hover:bg-prussian-navy"
                }`}
              >
                {saved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewSwitcher({ active, onChange }) {
  return (
    <div className="flex items-center bg-surface-container rounded-xl p-0.5 border border-black/5">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-caps text-label-caps transition-all ${
            active === v.key
              ? "bg-white text-midnight-ink shadow-sm"
              : "text-on-surface-variant hover:text-midnight-ink"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">{v.icon}</span>
          {v.label}
        </button>
      ))}
    </div>
  );
}

function QueueSection({ jobs, title, icon, accent, expanded, onToggle, actions, masterPrompt, saving, headerAction }) {
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col">
      <SectionHeader
        label={title}
        count={jobs.length}
        icon={icon}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        accent={accent}
        headerAction={headerAction}
      />
      {!collapsed && (
        <div className="flex flex-col gap-1.5 pl-1">
          {jobs.map((job) => (
            <div key={job.id} className="group">
              <InlineJob
                job={job}
                expanded={expanded === job.id}
                onToggle={() => onToggle(job.id)}
                masterPrompt={masterPrompt}
                saving={saving === job.id}
                {...actions}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardView({ jobs, expanded, onToggle, actions, masterPrompt, saving, onClearDone }) {
  const columns = [
    { key: "queued", label: "Waiting", icon: "schedule", filter: (j) => j.status === "queued" },
    { key: "running", label: "Running", icon: "play_circle", filter: (j) => j.status === "running" },
    { key: "failed", label: "Failed", icon: "error", filter: (j) => j.status === "failed" },
    { key: "done", label: "Done", icon: "check_circle", filter: (j) => j.status === "done" },
    { key: "canceled", label: "Cancelled", icon: "block", filter: (j) => j.status === "canceled" },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 min-h-0">
      {columns.map((col) => {
        const items = jobs.filter(col.filter);
        const meta = STATUS_META[col.key];
        return (
          <div key={col.key} className="flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-1 py-2">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`}></span>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{col.label}</span>
              <span className="font-mono-data text-mono-data text-on-surface-variant/60">{items.length}</span>
              {col.key === "done" && items.length > 0 && (
                <button
                  onClick={onClearDone}
                  className="flex items-center gap-1 ml-auto px-3 py-1 rounded-full text-[13px] font-label-caps text-label-caps bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                  Clear all
                </button>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto min-h-0 pb-4">
              {items.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-on-surface-variant/40 font-body-sm text-body-sm">
                  Empty
                </div>
              ) : (
                items.map((job) => (
                  <div key={job.id} className="group">
                    <InlineJob
                      job={job}
                      expanded={expanded === job.id}
                      onToggle={() => onToggle(job.id)}
                      masterPrompt={masterPrompt}
                      saving={saving === job.id}
                      {...actions}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ jobs, expanded, onToggle, actions, masterPrompt, saving }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/60 overflow-hidden">
      <div className="grid grid-cols-[44px_1fr_120px_1fr_80px] gap-2 px-3 py-2 border-b border-black/5 bg-surface-container-low/50 font-label-caps text-label-caps text-on-surface-variant">
        <span></span>
        <span>Filename</span>
        <span>Status</span>
        <span>Tags / Error</span>
        <span className="text-right">Actions</span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant/40 font-body-sm text-body-sm">
            No jobs
          </div>
        ) : (
          jobs.map((job) => {
            const filename = job.original_filename || job.object_key.split("/").pop();
            const meta = STATUS_META[job.status] || STATUS_META.queued;
            const isRunning = job.status === "running";
            return (
              <div key={job.id} className="group grid grid-cols-[44px_1fr_120px_1fr_80px] gap-2 px-3 py-2 border-b border-black/3 hover:bg-surface-container-low/50 transition-colors items-center">
                <Thumb src={job.thumb} alt={filename} size="w-8 h-8" />
                <span className="font-body-sm text-body-sm text-midnight-ink truncate">{filename}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-caps text-label-caps w-fit ${meta.color}`}>
                  {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>}
                  {meta.label}
                </span>
                <span className="font-mono-data text-mono-data text-on-surface-variant truncate text-[11px]">
                  {job.status === "done" ? job.result_tags : job.status === "failed" ? job.error : "—"}
                </span>
                <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {job.status === "failed" && <Action icon="refresh" title="Retry" onClick={() => actions.onRetry(job)} />}
                  {job.status === "canceled" && <Action icon="restart_alt" title="Re-queue" onClick={() => actions.onRetry(job)} />}
                  {job.status === "queued" && <Action icon="close" title="Cancel" onClick={() => actions.onCancel(job)} danger />}
                  {["done", "failed", "canceled"].includes(job.status) && <Action icon="delete" title="Remove" onClick={() => actions.onDelete(job)} danger />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function Ai() {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [view, setView] = useState("queue");
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(null);
  const [toast, setToast] = useState(null);
  const [configDraft, setConfigDraft] = useState({ master_prompt: "", min_interval_ms: 4000, daily_limit: 50 });
  const [configSaved, setConfigSaved] = useState(false);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [tagAllBusy, setTagAllBusy] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([getAiStatus(), listAiJobs({ limit: 300 })]);
      setStatus(s);
      setJobs(j);
      setUntaggedCount(s.untagged_count || 0);
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
          min_interval_ms: config.min_interval_ms ?? 4000,
          daily_limit: config.daily_limit ?? 50,
        })
      )
      .catch(() => {});
  }, []);

  const togglePause = async () => {
    try {
      await patchAiConfig({ paused: !status.paused });
      showToast(status.paused ? "Queue resumed" : "Queue paused");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not toggle pause");
    }
  };

  const retryOne = async (job) => {
    try {
      await retryAiJob(job.id);
      showToast("Back in queue");
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
      showToast("Removed");
      if (expanded === job.id) setExpanded(null);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not remove");
    }
  };

  const retryAll = async () => {
    try {
      const res = await retryAllFailedAiJobs();
      showToast(`Re-queued ${res.requeued} failed photo${res.requeued === 1 ? "" : "s"}`);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not retry failed");
    }
  };

  const cancelAll = async () => {
    if (!window.confirm("Cancel every waiting photo? Running photos finish first.")) return;
    try {
      const res = await cancelAllAiJobs();
      showToast(`Cancelled ${res.canceled} waiting photo${res.canceled === 1 ? "" : "s"}`);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not cancel queue");
    }
  };

  const clearDone = async () => {
    if (!window.confirm("Remove all done, failed, and cancelled jobs?")) return;
    try {
      const res = await clearDoneAiJobs();
      showToast(`Cleared ${res.deleted} finished job${res.deleted === 1 ? "" : "s"}`);
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not clear finished jobs");
    }
  };

  const handleTagAllUntagged = async () => {
    setTagAllBusy(true);
    try {
      const res = await tagAllUntagged();
      if (res.enqueued > 0) {
        showToast(`Queued ${res.enqueued} untagged photo${res.enqueued === 1 ? "" : "s"} for AI tagging`);
      } else {
        showToast(res.message || "Nothing to tag");
      }
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not tag untagged images");
    } finally {
      setTagAllBusy(false);
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

  const saveConfig = async () => {
    try {
      await patchAiConfig({
        master_prompt: configDraft.master_prompt.trim(),
        min_interval_ms: Number(configDraft.min_interval_ms),
        daily_limit: Number(configDraft.daily_limit),
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      showToast("Settings saved");
      refresh();
    } catch (err) {
      pushError(err?.message || "Could not save settings");
    }
  };

  const queued = useMemo(() => jobs.filter((j) => j.status === "queued" || j.status === "running"), [jobs]);
  const failed = useMemo(() => jobs.filter((j) => j.status === "failed"), [jobs]);
  const done = useMemo(() => jobs.filter((j) => j.status === "done"), [jobs]);
  const canceled = useMemo(() => jobs.filter((j) => j.status === "canceled"), [jobs]);

  const failedCount = failed.length;

  const actions = { onRetry: retryOne, onCancel: cancelOne, onDelete: deleteOne, onEditPrompt: savePrompt, onEditTags: saveTags };

  return (
    <main className="flex-1 bg-background overflow-y-auto flex flex-col">
      <div className="p-margin-page pb-24">
        <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-16">

          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="font-headline-md text-headline-md text-midnight-ink tracking-tight font-bold">AI Control</h1>
              <LiveDot active={!status?.paused && (queued.length > 0)} />
            </div>
            <div className="flex items-center gap-2">
              <ViewSwitcher active={view} onChange={setView} />
              <button
                onClick={handleTagAllUntagged}
                disabled={tagAllBusy || untaggedCount === 0}
                className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-full font-label-caps text-label-caps hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                {tagAllBusy ? "Tagging..." : `Tag all untagged (${untaggedCount})`}
              </button>
              {failedCount > 0 && (
                <button
                  onClick={retryAll}
                  className="flex items-center gap-1.5 bg-midnight-ink text-white px-3 py-1.5 rounded-full font-label-caps text-label-caps hover:bg-prussian-navy transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">refresh</span>
                  Retry {failedCount} failed
                </button>
              )}
              <button
                onClick={cancelAll}
                disabled={queued.length === 0}
                className="flex items-center gap-1.5 bg-white border border-black/10 text-on-surface-variant px-3 py-1.5 rounded-full font-label-caps text-label-caps hover:bg-surface-container-low transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">block</span>
                Cancel all
              </button>
            </div>
          </div>

          {/* Status Banner */}
          <StatusBanner status={status} />

          {/* Settings */}
          <SettingsBar
            configDraft={configDraft}
            setConfigDraft={setConfigDraft}
            onSave={saveConfig}
            saved={configSaved}
            onTogglePause={togglePause}
            paused={status?.paused}
          />

          {/* Views */}
          {view === "queue" && (
            <div className="flex flex-col gap-1">
              <QueueSection
                jobs={queued}
                title="Queued"
                icon="pending"
                accent="bg-amber-50 text-amber-700"
                expanded={expanded}
                onToggle={setExpanded}
                actions={actions}
                masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
                saving={saving}
              />
              <QueueSection
                jobs={failed}
                title="Failed"
                icon="error"
                accent="bg-rose-50 text-rose-600"
                expanded={expanded}
                onToggle={setExpanded}
                actions={actions}
                masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
                saving={saving}
              />
              <QueueSection
                jobs={done}
                title="Done"
                icon="check_circle"
                accent="bg-emerald-50 text-emerald-700"
                expanded={expanded}
                onToggle={setExpanded}
                actions={actions}
                masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
                saving={saving}
                headerAction={
                  done.length > 0 ? (
                    <button
                      onClick={clearDone}
                      className="flex items-center gap-1 px-3 py-1 rounded-full text-[13px] font-label-caps text-label-caps bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                      Clear all
                    </button>
                  ) : null
                }
              />
              <QueueSection
                jobs={canceled}
                title="Cancelled"
                icon="block"
                accent="bg-gray-100 text-gray-500"
                expanded={expanded}
                onToggle={setExpanded}
                actions={actions}
                masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
                saving={saving}
              />
              {jobs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl bg-white/40 border border-black/5">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">auto_awesome</span>
                  <p className="font-title-sm text-title-sm text-midnight-ink">No jobs in the queue</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs">
                    Select photos in the gallery and hit Tag to start.
                  </p>
                </div>
              )}
            </div>
          )}

          {view === "board" && (
            <BoardView
              jobs={jobs}
              expanded={expanded}
              onToggle={setExpanded}
              actions={actions}
              masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
              saving={saving}
              onClearDone={clearDone}
            />
          )}

          {view === "table" && (
            <TableView
              jobs={jobs}
              expanded={expanded}
              onToggle={setExpanded}
              actions={actions}
              masterPrompt={configDraft.master_prompt || DEFAULT_PROMPT}
              saving={saving}
            />
          )}
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
