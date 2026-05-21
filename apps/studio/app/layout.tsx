import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CostBadge } from "@/components/CostBadge";
import { ShortcutsProvider } from "@/components/ShortcutsProvider";

export const metadata: Metadata = {
  title: "Faceless Pipeline",
  description: "Local-first faceless content studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b bg-card/30">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="font-semibold">Studio</Link>
              <Link href="/renders" className="text-muted-foreground hover:text-foreground">Renders</Link>
              <Link href="/settings" className="text-muted-foreground hover:text-foreground">Settings</Link>
              <Link href="/admin/logs" className="text-muted-foreground hover:text-foreground">Logs</Link>
            </nav>
            <CostBadge />
          </div>
        </header>
        <ShortcutsProvider>{children}</ShortcutsProvider>
      </body>
    </html>
  );
}
