import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { suggestTags } from "../api.js";
import Avatar from "./Avatar.jsx";

export default function Taskbar({
  onSearch,
  onSettings,
  onUpload,
  searchQuery = "",
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
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

  // Keep the box in sync with the active URL query after navigation (but never
  // while the user is mid-typing).
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
    // Keyword disambiguation: suggest real metadata tags that start with the
    // last word being typed, so free-text terms can be swapped for facets.
    const id = ++suggestIdRef.current;
    const lastWord = text.split(/\s+/).pop() || "";
    if (!lastWord) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    if (suggestRef.current) clearTimeout(suggestRef.current);
    suggestRef.current = setTimeout(() => {
      suggestTags(lastWord.toLowerCase())
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
    <header className="w-full h-20 bg-surface-container flex justify-between items-center px-margin-page sticky top-0 z-50 shrink-0">
      <div className="flex items-center gap-4 w-1/4">
        <Link
          to="/"
          className="text-2xl font-bold text-midnight-ink tracking-tight hover:opacity-90 transition-opacity"
          title="Home"
        >
          Kashida Archive
        </Link>
      </div>
      <div className="flex-1 max-w-2xl px-4 flex justify-center">
        <form className="relative w-full max-w-xl" onSubmit={submit}>
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <span className="material-symbols-outlined text-gray-400">
              search
            </span>
          </div>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full pl-12 pr-24 py-3.5 border-none leading-5 bg-white shadow-soft placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-midnight-ink/20 rounded-full font-body-md text-body-md text-on-surface transition duration-200 ease-in-out"
            placeholder="Search archive... (Cmd+K)"
            type="text"
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
            <button
              type="submit"
              className="bg-midnight-ink text-white text-sm px-5 py-2 font-medium hover:bg-prussian-navy transition-colors rounded-full shadow-sm"
            >
              Search
            </button>
          </div>
          {showSuggest && suggestions.length > 0 && (
            <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-2xl shadow-lg border border-black/5 overflow-hidden z-50">
              {suggestions.map(({ tag, n }) => (
                <button
                  key={tag}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(tag)}
                  className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-surface-container-low transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">
                      tag
                    </span>
                    <span className="text-sm text-on-surface truncate">
                      {tag}
                    </span>
                  </span>
                  <span className="font-mono-data text-mono-data text-on-surface-variant shrink-0">
                    {n}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>
      <div className="flex items-center gap-4 w-1/4 justify-end">
        <button
          onClick={onUpload}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-midnight-ink bg-white/50 hover:bg-white transition-colors cursor-pointer active:scale-95 rounded-full shadow-sm"
          title="Upload"
        >
          <span className="material-symbols-outlined text-[18px]">upload</span>
          Upload
        </button>
        <button
          onClick={onSettings}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-midnight-ink bg-white/50 hover:bg-white transition-colors cursor-pointer active:scale-95 rounded-full shadow-sm"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[18px]">
            settings
          </span>
          Settings
        </button>
        <button
          onClick={() => navigate("/profile")}
          className="hover:opacity-85 transition-opacity rounded-full"
          title="Profile"
        >
          <Avatar />
        </button>
      </div>
    </header>
  );
}
