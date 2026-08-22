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
  "h-12 flex items-center transition-all duration-200 cursor-pointer rounded-2xl";

export default function SidePanel({ activeKey, onNavigate, onSettings }) {
  const [expanded, setExpanded] = useState(false);

  const itemClass = (active) =>
    `${RAIL_BUTTON} ${
      expanded ? "w-full px-3 gap-3" : "w-12 mx-auto justify-center gap-0"
    } ${
      active
        ? "bg-midnight-ink dark:bg-dark-primary-container text-white dark:text-dark-on-primary shadow-sm"
        : "text-on-surface-variant dark:text-dark-on-surface-variant bg-white/40 dark:bg-white/[0.04] hover:bg-surface-container dark:hover:bg-dark-surface-container-high hover:text-midnight-ink dark:hover:text-dark-primary hover:shadow-soft active:scale-95"
    }`;

  return (
    <nav
      className={`bg-transparent flex flex-col py-6 shrink-0 z-40 transition-all duration-300 ease-in-out ${
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
          className="p-3 text-midnight-ink dark:text-dark-on-surface bg-white dark:bg-dark-surface-container-high shadow-soft dark:shadow-dark-soft hover:bg-gray-50 dark:hover:bg-dark-surface-container-highest hover:shadow-soft-lg dark:hover:shadow-dark-soft-lg transition-all duration-200 cursor-pointer active:scale-95 rounded-2xl"
          title={expanded ? "Collapse menu" : "Expand menu"}
          aria-label={expanded ? "Collapse menu" : "Expand menu"}
        >
          <span className="material-symbols-outlined transition-transform duration-300 ease-in-out" style={{ transform: expanded ? "rotate(0deg)" : "rotate(0deg)" }}>
            {expanded ? "chevron_left" : "menu"}
          </span>
        </button>
        <span
          className={`text-sm font-semibold text-midnight-ink dark:text-dark-on-surface overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${
            expanded ? "opacity-100 max-w-[100px] ml-1" : "opacity-0 max-w-0 ml-0"
          }`}
        >
          Menu
        </span>
      </div>
      <div className={`flex flex-col gap-2 flex-1 ${expanded ? "px-3" : "items-center"}`}>
        {NAV_ITEMS.map((item, i) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={item.label}
              aria-label={item.label}
              className={itemClass(active)}
            >
              <span className="material-symbols-outlined shrink-0 text-[20px]">
                {item.icon}
              </span>
              <span
                className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ease-in-out ${
                  expanded ? "opacity-100 max-w-[120px]" : "opacity-0 max-w-0 w-0"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className={`flex flex-col gap-2 pt-4 mt-auto ${expanded ? "px-3" : "items-center"}`}
      >
        <button
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          className={itemClass(false)}
        >
          <span className="material-symbols-outlined shrink-0 text-[20px]">
            settings
          </span>
          <span
            className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ease-in-out ${
              expanded ? "opacity-100 max-w-[120px]" : "opacity-0 max-w-0 w-0"
            }`}
          >
            Settings
          </span>
        </button>
      </div>
    </nav>
  );
}
