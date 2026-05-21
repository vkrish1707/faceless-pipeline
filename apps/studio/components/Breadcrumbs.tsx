import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {c.href && !last ? (
              <Link href={c.href} className="hover:text-foreground hover:underline">{c.label}</Link>
            ) : (
              <span className={last ? "text-foreground" : ""}>{c.label}</span>
            )}
            {!last && <span className="text-muted-foreground/60">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
