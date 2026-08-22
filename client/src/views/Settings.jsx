import { useEffect, useState } from "react";
import { getAiConfig, getAiStatus, patchAiConfig } from "../api.js";
import { DEFAULT_PROMPT } from "../constants.js";
import { collections, feedback } from "../store.js";
import { pushError } from "../notify.jsx";

const SHORTCUTS = [
  ["Cmd/Ctrl + K", "Focus search anywhere"],
  ["Cmd/Ctrl + T", "AI-tag the open image"],
  ["← / →", "Previous / next asset in Detail"],
  ["Esc", "Close open dialogs"],
];

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 py-2.5 border-b border-outline-variant/50 dark:border-dark-outline-variant/50 last:border-0">
    <span className="font-body-sm text-body-sm text-on-surface-variant">
      {label}
    </span>
    <div className="flex items-center gap-2 text-right">{children}</div>
  </div>
);

export default function Settings({ onBack, imageCount }) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [status, setStatus] = useState({
    check: false,
    ok: false,
    error: null,
  });
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackList, setFeedbackList] = useState(() => feedback.list());

  const savePrompt = () => {
    const next = prompt.trim() || DEFAULT_PROMPT;
    setPrompt(next);
    patchAiConfig({ master_prompt: next })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((err) => pushError(err?.message || "Could not save prompt"));
  };

  const checkStatus = async () => {
    setStatus({ check: true, ok: false, error: null });
    try {
      const res = await fetch("/api/health");
      let data = {};
      try {
        data = await res.json();
      } catch {}
      if (!res.ok || data.db === false) {
        setStatus({
          check: false,
          ok: false,
          error:
            data.db === false
              ? "Database not ready"
              : `API error ${res.status}`,
        });
        return;
      }
      setStatus({ check: false, ok: true, error: null });
    } catch {
      setStatus({ check: false, ok: false, error: "API unreachable" });
    }
  };

  useEffect(() => {
    checkStatus();
    getAiConfig()
      .then(({ config }) => {
        if (config?.master_prompt) setPrompt(config.master_prompt);
      })
      .catch(() => {});
    getAiStatus()
      .then(setAiStatus)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendFeedback = (e) => {
    e.preventDefault();
    const text = feedbackText.trim();
    if (!text) return;
    feedback.add(text);
    setFeedbackText("");
    setFeedbackSent(true);
    setFeedbackList(feedback.list());
    setTimeout(() => setFeedbackSent(false), 2500);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-margin-page bg-background">
        <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-16">
          <div>
            <button
              onClick={onBack}
              className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 mb-3"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              <span className="font-label-caps text-label-caps">Library</span>
            </button>
            <h1 className="font-headline-md text-headline-md text-primary tracking-tight font-bold">
              Settings
            </h1>
          </div>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 transition-colors duration-300">
            <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface mb-4">
              System Status
            </h2>
            <div className="flex flex-col">
              <Row label="API server">
                {status.check ? (
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    checking...
                  </span>
                ) : status.ok ? (
                  <span className="flex items-center gap-1.5 font-body-sm text-body-sm text-tertiary-container">
                    <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse-soft"></span>
                    online
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-body-sm text-body-sm text-error">
                    <span className="w-2 h-2 rounded-full bg-error"></span>
                    {status.error}
                  </span>
                )}
              </Row>
              <Row label="Images in library">
                <span className="font-mono-data text-mono-data text-on-surface">
                  {imageCount}
                </span>
              </Row>
              <Row label="Collections">
                <span className="font-mono-data text-mono-data text-on-surface">
                  {collections.list().length}
                </span>
              </Row>
              <Row label="AI tagging">
                {aiStatus?.configured ? (
                  <span className="flex items-center gap-1.5 font-body-sm text-body-sm text-tertiary">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        aiStatus.paused || aiStatus.quota?.rate_limited
                          ? "bg-amber-500"
                          : "bg-tertiary animate-pulse-soft"
                      }`}
                    ></span>
                    {aiStatus.paused
                      ? "paused"
                      : aiStatus.quota?.rate_limited
                        ? "rate-limited"
                        : aiStatus.model || "ready"}
                  </span>
                ) : (
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    Needs GEMINI_API_KEY in server/.env
                  </span>
                )}
              </Row>
              <Row label="Cloud storage">
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Needs R2 credentials in server/.env
                </span>
              </Row>
            </div>
          </section>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 transition-colors duration-300">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface">
                Master AI Tagging Prompt
              </h2>
              <button
                onClick={savePrompt}
                className={`px-4 py-1.5 rounded-full font-label-caps text-label-caps transition-all duration-200 ${
                  saved
                    ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                    : "bg-midnight-ink dark:bg-dark-primary-container text-white dark:text-dark-on-primary hover:bg-prussian-navy dark:hover:opacity-90 active:scale-95"
                }`}
              >
                {saved ? "Saved" : "Save Prompt"}
              </button>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Used when you AI-tag any image (Cmd/Ctrl+T in the asset viewer, or
              the AI button next to Tags). Saved to the server.
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full bg-surface-container-low dark:bg-dark-surface-container-highest border border-outline-variant dark:border-dark-outline-variant rounded-xl px-3 py-2.5 text-body-sm text-on-surface dark:text-dark-on-surface focus:border-midnight-ink dark:focus:border-dark-primary focus:ring-2 focus:ring-midnight-ink/10 dark:focus:ring-dark-primary/20 outline-none transition-all duration-200 resize-y"
              placeholder="e.g. extract exact text and objects"
            />
          </section>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 transition-colors duration-300">
            <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface mb-4">
              Keyboard Shortcuts
            </h2>
            <div className="flex flex-col">
              {SHORTCUTS.map(([keys, action]) => (
                <div
                  key={keys}
                  className="flex items-center justify-between py-3 border-b border-outline-variant/50 dark:border-dark-outline-variant/50 last:border-0"
                >
                  <span className="font-body-sm text-body-sm text-on-surface">
                    {action}
                  </span>
                  <kbd className="kbd-key">{keys}</kbd>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 transition-colors duration-300">
            <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface mb-1">
              Feedback
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Found a bug or want a feature? Tell us — feedback is stored
              locally for now.
            </p>
            <form onSubmit={sendFeedback} className="flex flex-col gap-3">
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={3}
                className="w-full bg-surface-container-low dark:bg-dark-surface-container-highest border border-outline-variant dark:border-dark-outline-variant rounded-xl px-3 py-2.5 text-body-sm text-on-surface dark:text-dark-on-surface focus:border-midnight-ink dark:focus:border-dark-primary focus:ring-2 focus:ring-midnight-ink/10 dark:focus:ring-dark-primary/20 outline-none transition-all duration-200 resize-y"
                placeholder="Your feedback..."
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!feedbackText.trim()}
                  className={`px-4 py-2 rounded-full font-label-caps text-label-caps transition-all duration-200 active:scale-95 ${
                    feedbackSent
                      ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                      : "bg-midnight-ink dark:bg-dark-primary-container text-white dark:text-dark-on-primary hover:bg-prussian-navy dark:hover:opacity-90 disabled:opacity-50"
                  }`}
                >
                  {feedbackSent ? "Thanks!" : "Send Feedback"}
                </button>
              </div>
            </form>
            {feedbackList.length > 0 && (
              <div className="mt-6 flex flex-col gap-2">
                <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase text-xs">
                  Previously submitted
                </h3>
                {feedbackList
                  .slice()
                  .reverse()
                  .slice(0, 5)
                  .map((f) => (
                    <div
                      key={f.id}
                      className="bg-surface-container-low dark:bg-dark-surface-container-highest rounded-xl p-3"
                    >
                      <p className="font-body-sm text-body-sm text-on-surface">
                        {f.text}
                      </p>
                      <p className="font-mono-data text-mono-data text-xs text-on-surface-variant mt-1">
                        {new Date(f.at).toLocaleString()}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
