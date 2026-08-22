import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-surface-container dark:bg-dark-surface text-on-surface dark:text-dark-on-surface font-body-md text-body-md flex items-center justify-center p-4 transition-colors duration-300 login-bg">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="flex flex-col items-center mb-8" style={{ animationDelay: "0ms" }}>
          <div className="w-14 h-14 rounded-2xl bg-midnight-ink dark:bg-dark-primary-container flex items-center justify-center mb-4 shadow-soft dark:shadow-dark-soft animate-float">
            <span className="material-symbols-outlined text-on-primary text-3xl">
              photo_library
            </span>
          </div>
          <h1 className="text-2xl font-bold text-midnight-ink dark:text-dark-on-surface tracking-tight">
            Kashida Archive
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Sign in to your archive
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-[2rem] shadow-soft-lg dark:shadow-dark-soft-lg p-8 flex flex-col gap-4 transition-colors duration-300"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex flex-col gap-1.5 animate-in" style={{ animationDelay: "150ms" }}>
            <label htmlFor="login-username" className="font-label-caps text-label-caps text-on-surface-variant">
              Username
            </label>
            <input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="input-base w-full"
              placeholder="admin"
              type="text"
            />
          </div>
          <div className="flex flex-col gap-1.5 animate-in" style={{ animationDelay: "200ms" }}>
            <label htmlFor="login-password" className="font-label-caps text-label-caps text-on-surface-variant">
              Password
            </label>
            <input
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="input-base w-full"
              type="password"
            />
          </div>

          {error && (
            <p className="font-body-sm text-body-sm text-error bg-error/10 border border-error/30 rounded-xl px-3 py-2 animate-fade-in">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 bg-midnight-ink dark:bg-dark-primary-container hover:bg-prussian-navy dark:hover:opacity-90 text-white dark:text-dark-on-primary font-label-caps text-label-caps px-4 py-2.5 rounded-full transition-all duration-200 disabled:opacity-60 active:scale-[0.98] shadow-sm animate-in"
            style={{ animationDelay: "250ms" }}
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
