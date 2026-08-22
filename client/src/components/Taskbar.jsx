import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { suggestTags } from "../api.js";
import { useDarkMode } from "../App.jsx";
import Avatar from "./Avatar.jsx";

export default function Taskbar({
  onSearch,
  onSettings,
  onUpload,
  searchQuery = "",
}) {
  const navigate = useNavigate();
  const { isDark, toggle } = useDarkMode();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);
  const suggestRef = useRef(null);
  const suggestIdRef = useRef(0);

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

  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setQuery(searchQuery);
  }, [searchQuery]);

  const pickSuggestion = (tag) => {
    setQuery(tag);
    setShowSuggest(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch?.(tag);
  };

  const onChange = (value) => {
    setQuery(value);
    const text = value.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch?.(text);
    }, 200);
    const id = ++suggestIdRef.current;
    if (!text) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    if (suggestRef.current) clearTimeout(suggestRef.current);
    suggestRef.current = setTimeout(() => {
      suggestTags(text.toLowerCase())
        .then((data) => {
          if (id !== suggestIdRef.current) return;
          setSuggestions(Array.isArray(data) ? data : []);
          setShowSuggest(true);
        })
        .catch(() => {
          if (id === suggestIdRef.current) setShowSuggest(false);
        });
    }, 120);
  };

  const submit = (e) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setShowSuggest(false);
    onSearch?.(query.trim());
  };

  return (
    <header className="w-full h-20 bg-surface-container/80 dark:bg-dark-surface-container/80 backdrop-blur-xl flex justify-between items-center px-margin-page sticky top-0 z-50 shrink-0 border-b border-black/[0.03] dark:border-dark-outline-variant/50 transition-colors duration-300">
      <div className="flex items-center gap-4 w-1/4">
        <Link
          to="/"
          className="flex items-center gap-2.5 group"
          title="Home"
        >
          <div             className="w-9 h-9 rounded-xl bg-midnight-ink dark:bg-dark-surface-container-highest flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
            <span className="material-symbols-outlined text-white text-[20px]">
              photo_library
            </span>
          </div>
          <span className="text-lg font-bold text-midnight-ink dark:text-dark-on-surface tracking-tight group-hover:opacity-80 transition-opacity hidden sm:inline">
            Kashida Archive
          </span>
        </Link>
      </div>

      <div className="flex-1 max-w-2xl px-4 flex justify-center">
        <form className="relative w-full max-w-xl" onSubmit={submit}>
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <span
              className={`material-symbols-outlined text-[20px] transition-colors duration-200 ${
                searchFocused
                ? "text-midnight-ink dark:text-dark-on-surface"
                   : "text-on-surface-variant/50 dark:text-dark-on-surface-variant/50"
              }`}
            >
              search
            </span>
          </div>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={`block w-full pl-11 pr-24 py-3 border-none leading-5 bg-surface-container-low dark:bg-dark-surface-container-high placeholder-on-surface-variant/40 dark:placeholder-dark-on-surface-variant/40 text-on-surface dark:text-dark-on-surface rounded-full font-body-md text-body-md transition-all duration-300 ${
              searchFocused
                ? "shadow-soft-lg dark:shadow-dark-soft-lg ring-2 ring-midnight-ink/10 dark:ring-white/10"
                : "shadow-soft dark:shadow-dark-soft"
            }`}
            placeholder="Search archive... (Cmd+K)"
            type="text"
          />
          <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center">
            <button
              type="submit"
              className="bg-midnight-ink dark:bg-dark-surface-container-highest text-white dark:text-dark-on-surface text-sm px-5 py-2 font-medium hover:bg-prussian-navy dark:hover:bg-dark-on-surface dark:hover:text-dark-surface transition-all duration-200 rounded-full shadow-sm active:scale-95 cursor-pointer"
            >
              Search
            </button>
          </div>
          {showSuggest && suggestions.length > 0 && (
            <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-dark-surface-container-highest rounded-2xl shadow-soft-lg dark:shadow-dark-soft-lg border border-black/5 dark:border-dark-outline-variant overflow-hidden z-50 animate-scale-in origin-top">
              {suggestions.map(({ tag, n }, i) => (
                <button
                  key={tag}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(tag)}
                  className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-surface-container-low dark:hover:bg-dark-surface-container-high transition-colors duration-150 cursor-pointer"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant dark:text-dark-on-surface-variant shrink-0">
                      tag
                    </span>
                    <span className="text-sm text-on-surface dark:text-dark-on-surface truncate">
                      {tag}
                    </span>
                  </span>
                  <span className="font-mono-data text-mono-data text-on-surface-variant dark:text-dark-on-surface-variant shrink-0">
                    {n}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      <div className="flex items-center gap-2 w-1/4 justify-end">
        <button
          onClick={toggle}
          className="w-10 h-10 flex items-center justify-center text-on-surface-variant dark:text-dark-on-surface-variant hover:text-midnight-ink dark:hover:text-dark-on-surface hover:bg-white/60 dark:hover:bg-dark-surface-container-highest transition-all duration-200 cursor-pointer active:scale-95 rounded-full"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isDark ? "light_mode" : "dark_mode"}
          </span>
        </button>
        <div className="w-px h-5 bg-black/10 dark:bg-white/[0.08] mx-1 hidden md:block"></div>
        <button
          onClick={onUpload}
          className="hidden md:flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-on-surface dark:text-dark-on-surface bg-surface-container-low dark:bg-dark-surface-container-high hover:bg-surface-container dark:hover:bg-dark-surface-container-highest hover:shadow-soft dark:hover:shadow-dark-soft transition-all duration-200 cursor-pointer active:scale-95 rounded-full border border-black/[0.04] dark:border-dark-outline-variant"
          title="Upload"
        >
          <span className="material-symbols-outlined text-[18px]">upload</span>
          Upload
        </button>
        <button
          onClick={onSettings}
          className="hidden md:flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-on-surface dark:text-dark-on-surface bg-surface-container-low dark:bg-dark-surface-container-high hover:bg-surface-container dark:hover:bg-dark-surface-container-highest hover:shadow-soft dark:hover:shadow-dark-soft transition-all duration-200 cursor-pointer active:scale-95 rounded-full border border-black/[0.04] dark:border-dark-outline-variant"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[18px]">
            settings
          </span>
          Settings
        </button>
        <button
          onClick={() => navigate("/profile")}
          className="hover:opacity-85 transition-opacity rounded-full ml-1 cursor-pointer"
          title="Profile"
        >
          <Avatar />
        </button>
      </div>
    </header>
  );
}
