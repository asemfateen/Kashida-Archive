import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Avatar from "./Avatar.jsx";

export default function Taskbar({ onSearch }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch?.(q);
  };

  return (
    <nav className="bg-surface-container-lowest border-b border-outline-variant z-50 shrink-0">
      <div className="flex justify-between items-center w-full px-margin-page py-unit h-16">
        <div className="flex items-center gap-gutter w-[320px]">
          <Link
            to="/"
            className="font-headline-md text-headline-md text-primary tracking-tight font-semibold hover:opacity-90 transition-opacity"
            title="Home"
          >
            Kashida Archive
          </Link>
        </div>
        <div className="flex-1 max-w-2xl mx-4">
          <form className="relative w-full group" onSubmit={submit}>
            <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-on-surface-variant pointer-events-none">
              search
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-container-low border border-transparent focus:bg-surface-container-lowest focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container rounded-xl pl-10 pr-24 py-2.5 font-body-md text-body-md text-on-surface transition-colors placeholder-on-surface-variant outline-none"
              placeholder="Search archive... (Cmd+K)"
              type="text"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-tertiary text-on-tertiary font-label-caps text-label-caps px-3 py-1.5 rounded-lg hover:bg-tertiary-container transition-colors"
            >
              Search
            </button>
          </form>
        </div>
        <div className="flex items-center gap-4 w-[320px] justify-end">
          <Link
            to="/"
            className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-label-caps"
            title="Home"
          >
            <span className="material-symbols-outlined">home</span>
            Home
          </Link>
          <button
            onClick={() => navigate("/profile")}
            className="hover:opacity-85 transition-opacity rounded-full"
            title="Profile"
          >
            <Avatar />
          </button>
        </div>
      </div>
    </nav>
  );
}
