"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Client-side history back. Falls back to a provided href when there's no history (direct nav). */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="-ml-2"
    >
      ← Back
    </Button>
  );
}
