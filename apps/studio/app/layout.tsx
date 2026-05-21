import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CostBadge } from "@/components/CostBadge";
import { ShortcutsProvider } from "@/components/ShortcutsProvider";
import { NavLink } from "@/components/NavLink";

export const metadata: Metadata = {
  title: "Faceless Pipeline",
  description: "Local-first faceless content studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b bg-card/30 sticky top-0 z-40 backdrop-blur">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="font-semibold mr-2">Studio</Link>
              <NavLink href="/books" label="Books" />
              <NavLink href="/renders" label="Renders" />
              <NavLink href="/settings" label="Settings" />
              <NavLink href="/admin/logs" label="Logs" />
            </nav>
            <CostBadge />
          </div>
        </header>
        <ShortcutsProvider>{children}</ShortcutsProvider>
      </body>
    </html>
  );
}
