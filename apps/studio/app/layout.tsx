import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Faceless Pipeline",
  description: "Local-first faceless content studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
