import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: URLSearchParams;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams(searchParams);
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground" aria-label="Pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
          {page > 1 ? (
            <Link href={href(page - 1)} aria-label="Previous page">
              <ChevronLeftIcon /> Previous
            </Link>
          ) : (
            <span>
              <ChevronLeftIcon /> Previous
            </span>
          )}
        </Button>
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" asChild={page < pages} disabled={page >= pages}>
          {page < pages ? (
            <Link href={href(page + 1)} aria-label="Next page">
              Next <ChevronRightIcon />
            </Link>
          ) : (
            <span>
              Next <ChevronRightIcon />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
