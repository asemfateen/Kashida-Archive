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
    <div className="h-screen w-screen bg-background text-on-surface font-body-md text-body-md flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-tertiary-container flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-on-primary text-3xl">
              photo_library
            </span>
          </div>
          <h1 className="font-headline-md text-headline-md text-primary tracking-tight font-semibold">
            Kashida Archive
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Sign in to your archive
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-body-md text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors"
              placeholder="admin"
              type="text"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Password
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-body-md text-on-surface focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container outline-none transition-colors"
              type="password"
            />
          </div>

          {error && (
            <p className="font-body-sm text-body-sm text-error bg-error-container/40 border border-error/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 bg-tertiary text-on-tertiary font-label-caps text-label-caps px-4 py-2.5 rounded-lg hover:bg-tertiary-container transition-colors disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
