import Link from "next/link";

export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
