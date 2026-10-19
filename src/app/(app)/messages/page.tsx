import { permanentRedirect } from "next/navigation";

/** Messages was renamed to Chat; keep old links working. */
export default async function MessagesRedirect({ searchParams }: PageProps<"/messages">) {
  const sp = await searchParams;
  permanentRedirect(typeof sp.with === "string" ? `/chat?with=${encodeURIComponent(sp.with)}` : "/chat");
}
