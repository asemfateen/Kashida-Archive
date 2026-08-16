import { useState } from "react";

const NAV_ITEMS = [
  { key: "all", icon: "grid_view", label: "Gallery" },
  { key: "recent", icon: "history", label: "Activity" },
  { key: "favorites", icon: "star", label: "Favorites" },
  { key: "trash", icon: "delete", label: "Trash" },
  { key: "upload", icon: "cloud", label: "Cloud" },
  { key: "ai", icon: "auto_awesome", label: "AI" },
];

const RAIL_BUTTON =
  "h-12 flex items-center gap-3 transition-all duration-200 cursor-pointer rounded-2xl";

export default function SidePanel({ activeKey, onNavigate, onSettings }) {
  const [expanded, setExpanded] = useState(false);

  const itemClass = (active) =>
    `${RAIL_BUTTON} ${
      expanded ? "w-full px-3" : "w-12 mx-auto justify-center"
    } ${
      active
        ? "bg-midnight-ink text-white shadow-sm"
        : "text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm active:scale-95"
    }`;

  return (
    <nav
      className={`bg-transparent flex flex-col py-6 shrink-0 z-40 transition-all duration-200 ease-in-out ${
        expanded ? "w-64" : "w-panel-width"
      }`}
    >
      <div
        className={`flex items-center mb-8 ${
          expanded ? "justify-between px-3" : "justify-center"
        }`}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-3 text-midnight-ink bg-white shadow-soft hover:bg-gray-50 transition-colors cursor-pointer active:scale-95 rounded-2xl"
          title={expanded ? "Collapse menu" : "Expand menu"}
          aria-label={expanded ? "Collapse menu" : "Expand menu"}
        >
          <span className="material-symbols-outlined">
            {expanded ? "chevron_left" : "menu"}
          </span>
        </button>
        {expanded && (
          <span className="text-sm font-semibold text-midnight-ink">Menu</span>
        )}
      </div>
      <div className={`flex flex-col gap-3 flex-1 ${expanded ? "px-3" : ""}`}>
        {NAV_ITEMS.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={item.label}
              aria-label={item.label}
              className={itemClass(active)}
            >
              <span className="material-symbols-outlined shrink-0">
                {item.icon}
              </span>
              {expanded && (
                <span className="text-sm font-medium whitespace-nowrap">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        className={`flex flex-col gap-3 pt-4 mt-auto ${expanded ? "px-3" : ""}`}
      >
        <button
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          className={itemClass(false)}
        >
          <span className="material-symbols-outlined shrink-0">settings</span>
          {expanded && (
            <span className="text-sm font-medium whitespace-nowrap">
              Settings
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
