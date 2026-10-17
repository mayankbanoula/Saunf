import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Saunf is your company&apos;s private workspace. Use your work email.
      </p>
    </main>
  );
}
