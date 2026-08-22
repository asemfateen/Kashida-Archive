import { useEffect, useState } from "react";
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
          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 flex items-center gap-5 transition-colors duration-300">
            <Avatar size={72} />
            <div>
              <h1 className="font-title-sm text-title-sm text-primary">
                Profile
              </h1>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                Signed in as the archive operator
              </p>
            </div>
          </section>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 flex flex-col gap-4 transition-colors duration-300">
            <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface">
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
              <div className="bg-surface-container-low dark:bg-dark-surface-container-highest rounded-xl px-3 py-2 border border-black/5 dark:border-dark-outline-variant">
                <span className="font-mono-data text-mono-data text-xs text-on-surface-variant break-all block">
                  {token ? `${token.slice(0, 24)}...` : "—"}
                </span>
              </div>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {tokenAge()}
              </span>
            </div>
          </section>

          <section className="bg-white dark:bg-dark-surface-container-high border border-black/5 dark:border-dark-outline-variant rounded-2xl shadow-soft dark:shadow-dark-soft p-6 flex flex-col gap-4 transition-colors duration-300">
            <h2 className="font-title-sm text-title-sm text-on-surface dark:text-dark-on-surface">
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
                    className="px-4 py-2 rounded-full font-label-caps text-label-caps bg-error text-on-error hover:opacity-90 transition-opacity active:scale-95"
                  >
                    Log Out
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant dark:text-dark-on-surface-variant border border-outline-variant dark:border-dark-outline-variant hover:bg-surface-container dark:hover:bg-dark-surface-container-high transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="self-start px-4 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant dark:text-dark-on-surface-variant border border-outline-variant dark:border-dark-outline-variant hover:border-error hover:text-error transition-colors"
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
