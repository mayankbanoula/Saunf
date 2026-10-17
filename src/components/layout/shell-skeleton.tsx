import { Skeleton } from "@/components/ui/primitives";

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-60 border-r bg-sidebar md:block" />
      <div className="flex-1">
        <div className="h-14 border-b" />
        <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
