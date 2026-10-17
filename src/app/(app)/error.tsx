"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={AlertTriangleIcon}
      title="Something went wrong"
      description={
        <>
          This page couldn&apos;t be loaded. Try again, and contact your administrator if it keeps happening.
          {error.digest ? <span className="mt-1 block font-mono text-xs">Reference: {error.digest}</span> : null}
        </>
      }
      action={<Button onClick={reset}>Try again</Button>}
      className="mt-10"
    />
  );
}
