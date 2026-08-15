import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import Avatar from "../components/Avatar.jsx";

export default function Profile() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const tokenAge = () => {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.exp
        ? `Expires ${new Date(payload.exp * 1000).toLocaleString()}`
        : "Session token";
    } catch {
      return "Session token";
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <main className="flex-1 overflow-y-auto p-margin-page bg-background">
        <div className="max-w-2xl mx-auto flex flex-col gap-8 pb-16">
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex items-center gap-4">
            <Avatar size={64} />
            <div>
              <h1 className="font-title-sm text-title-sm text-primary">
                Profile
              </h1>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Signed in as the archive operator
              </p>
            </div>
          </section>

          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col gap-4">
            <h2 className="font-title-sm text-title-sm text-on-surface">
              Session
            </h2>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Username
              </label>
              <span className="font-mono-data text-mono-data text-on-surface">
                admin
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                Token
              </label>
              <span className="font-mono-data text-mono-data text-xs text-on-surface-variant break-all">
                {token ? `${token.slice(0, 24)}…` : "—"}
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {tokenAge()}
              </span>
            </div>
          </section>

          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col gap-4">
            <h2 className="font-title-sm text-title-sm text-on-surface">
              Account
            </h2>
            {confirming ? (
              <div className="flex flex-col gap-3">
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Log out of Kashida Archive on this device?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 rounded-lg font-label-caps text-label-caps bg-error text-on-error hover:opacity-90 transition-opacity"
                  >
                    Log Out
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 rounded-lg font-label-caps text-label-caps text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="self-start px-4 py-2 rounded-lg font-label-caps text-label-caps text-on-surface-variant border border-outline-variant hover:border-error hover:text-error transition-colors"
              >
                Log Out
              </button>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
