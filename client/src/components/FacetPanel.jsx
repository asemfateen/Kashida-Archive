import { GROUP_TYPE_LABELS as TYPE_LABELS } from "../constants.js";

const dayLabel = (day) => {
  try {
    return new Date(day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return day;
  }
};

function Section({ title, dotCls, activeLabel, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label-caps uppercase tracking-wider flex items-center gap-2 text-on-surface-variant dark:text-dark-on-surface-variant">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        {title}
        {activeLabel && (
          <span className="font-mono-data text-mono-data opacity-60">
            {activeLabel}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Row({ active, activeCls, label, n, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center justify-between gap-2 rounded-xl text-body-sm transition-all duration-200 cursor-pointer ${
        active
          ? activeCls
          : "text-on-surface-variant dark:text-dark-on-surface-variant bg-white/40 dark:bg-white/[0.04] hover:bg-surface-container dark:hover:bg-dark-surface-container-high hover:text-midnight-ink dark:hover:text-dark-primary shadow-sm hover:shadow"
      }`}
      title={label}
    >
      <span className="flex items-center gap-2 min-w-0">
        {active && (
          <span className="material-symbols-outlined text-[14px] shrink-0">
            check
          </span>
        )}
        <span className="truncate font-medium text-left">{label}</span>
      </span>
      <span className="font-mono-data text-mono-data text-xs shrink-0 opacity-60">
        {n}
      </span>
    </button>
  );
}

export default function FacetPanel({
  facets,
  facetTags = [],
  facetType = null,
  facetDay = null,
  onToggleTag,
  onToggleType,
  onToggleDay,
}) {
  if (!facets) return null;

  const tags = facets.tags || [];
  const types = facets.types || [];
  const days = facets.days || [];
  const activeCount =
    facetTags.length + (facetType ? 1 : 0) + (facetDay ? 1 : 0);

  const clearAll = () => {
    for (const t of facetTags) onToggleTag(t);
    if (facetType) onToggleType(facetType);
    if (facetDay) onToggleDay(facetDay);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-label-caps uppercase tracking-wider flex items-center gap-2 text-on-surface-variant dark:text-dark-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] opacity-60">
            tune
          </span>
          Refine
          {activeCount > 0 && (
            <span className="font-mono-data text-mono-data opacity-60">
              ({activeCount})
            </span>
          )}
        </h3>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="text-body-sm font-medium text-on-surface-variant dark:text-dark-on-surface-variant hover:text-error dark:hover:text-dark-error transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            Clear
          </button>
        )}
      </div>

      <Section
        title="Tags"
        dotCls="bg-primary"
        activeLabel={facetTags.length > 0 ? `${facetTags.length} active` : ""}
      >
        {tags.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant/60 dark:text-dark-on-surface-variant/60">
            No tags in this result set yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {tags.map(({ tag, n }) => (
              <Row
                key={tag}
                active={facetTags.includes(tag)}
                activeCls="bg-primary dark:bg-dark-primary text-on-primary dark:text-dark-on-primary"
                label={tag}
                n={n}
                onClick={() => onToggleTag(tag)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Type" dotCls="bg-tertiary-container">
        {types.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant/60 dark:text-dark-on-surface-variant/60">
            No types yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {types.map(({ type, n }) => (
              <Row
                key={type}
                active={facetType === type}
                activeCls="bg-tertiary-container text-on-tertiary-container"
                label={TYPE_LABELS[type] || type.toUpperCase()}
                n={n}
                onClick={() => onToggleType(type)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Date" dotCls="bg-secondary">
        {days.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant/60 dark:text-dark-on-surface-variant/60">
            No dates yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {days.map(({ day, n }) => (
              <Row
                key={day}
                active={facetDay === day}
                activeCls="bg-secondary text-on-secondary"
                label={dayLabel(day)}
                n={n}
                onClick={() => onToggleDay(day)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
