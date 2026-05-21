"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const path = usePathname() ?? "/";
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={cn(
        "rounded px-2 py-1 transition",
        active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </Link>
  );
}
