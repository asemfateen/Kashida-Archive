export default function Avatar({ size = 40 }) {
  return (
    <div
      className="rounded-full bg-midnight-ink dark:bg-dark-primary-container flex items-center justify-center text-white hover:bg-prussian-navy dark:hover:opacity-90 transition-all duration-200 shadow-sm hover:shadow-md ring-2 ring-transparent hover:ring-midnight-ink/10 dark:hover:ring-dark-primary/15 shrink-0"
      style={{ width: size, height: size }}
      title="Photo Editor"
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: size * 0.55 }}
      >
        person
      </span>
    </div>
  );
}
