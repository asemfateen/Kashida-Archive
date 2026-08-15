import { useEffect, useState } from "react";
import { collections, savedSearches, feedback } from "../store.js";

const DEFAULT_PROMPT = "Give me 5 descriptive keywords for this image.";

const SHORTCUTS = [
  ["Cmd/Ctrl + K", "Focus search anywhere"],
  ["Cmd/Ctrl + T", "AI-tag the open image"],
  ["← / →", "Previous / next asset in Detail"],
  ["Esc", "Close open dialogs"],
];

export default function Settings({ onBack, imageCount }) {
  const [prompt, setPrompt] = useState(() => {
    try {
      return localStorage.getItem("masterPrompt") || DEFAULT_PROMPT;
    } catch {
      return DEFAULT_PROMPT;
    }
  });
  const [saved, setSaved] = useState(false);
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
    try {
      localStorage.setItem("masterPrompt", next);
    } catch {
      /* ignore */
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const checkStatus = async () => {
    setStatus({ check: true, ok: false, error: null });
    try {
      const res = await fetch("/api/health");
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON body (e.g. maintenance page) */
      }
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

  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="font-body-sm text-body-sm text-on-surface-variant">
        {label}
      </span>
      <div className="flex items-center gap-2 text-right">{children}</div>
    </div>
  );

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
          {/* System Status */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
            <h2 className="font-title-sm text-title-sm text-on-surface mb-4">
              System Status
            </h2>
            <div className="flex flex-col gap-1">
              <Row label="API server">
                {status.check ? (
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    checking...
                  </span>
                ) : status.ok ? (
                  <span className="flex items-center gap-1.5 font-body-sm text-body-sm text-tertiary-container">
                    <span className="w-2 h-2 rounded-full bg-tertiary"></span>
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
              <Row label="Saved searches">
                <span className="font-mono-data text-mono-data text-on-surface">
                  {savedSearches.list().length}
                </span>
              </Row>
              <Row label="AI tagging">
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Needs GEMINI_API_KEY in server/.env
                </span>
              </Row>
              <Row label="Cloud storage">
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Needs R2 credentials in server/.env
                </span>
              </Row>
            </div>
          </section>

          {/* Master Prompt */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-title-sm text-title-sm text-on-surface">
                Master AI Tagging Prompt
              </h2>
              <button
                onClick={savePrompt}
                className={`px-4 py-1.5 rounded-lg font-label-caps text-label-caps transition-colors ${
                  saved
                    ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                    : "bg-tertiary text-on-tertiary hover:bg-tertiary-container"
                }`}
              >
                {saved ? "Saved" : "Save Prompt"}
              </button>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Used when you AI-tag any image (Cmd/Ctrl+T in the asset viewer, or
              the AI button next to Tags).
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors resize-y"
              placeholder="e.g. extract exact text and objects"
            />
          </section>

          {/* Keyboard Shortcuts */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
            <h2 className="font-title-sm text-title-sm text-on-surface mb-4">
              Keyboard Shortcuts
            </h2>
            <div className="flex flex-col gap-2">
              {SHORTCUTS.map(([keys, action]) => (
                <div
                  key={keys}
                  className="flex items-center justify-between py-1.5 border-b border-outline-variant last:border-0"
                >
                  <span className="font-body-sm text-body-sm text-on-surface">
                    {action}
                  </span>
                  <kbd className="bg-surface-container-high border border-outline-variant rounded px-2 py-0.5 font-mono-data text-mono-data text-xs">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          {/* Feedback */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
            <h2 className="font-title-sm text-title-sm text-on-surface mb-1">
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
                className="w-full bg-surface-bright border border-outline-variant rounded px-3 py-2 text-body-sm text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors resize-y"
                placeholder="Your feedback..."
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!feedbackText.trim()}
                  className={`px-4 py-2 rounded-lg font-label-caps text-label-caps transition-colors ${
                    feedbackSent
                      ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                      : "bg-tertiary text-on-tertiary hover:bg-tertiary-container disabled:opacity-50"
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
                      className="bg-surface-container-low rounded-lg p-3"
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
