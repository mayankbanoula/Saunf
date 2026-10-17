import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

import { signOut } from "../actions";

export const metadata: Metadata = { title: "No workspace access" };

export default function NoAccessPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">No workspace access</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Your account isn&apos;t an active member of a Saunf workspace. It may have been deactivated, or your invitation
        hasn&apos;t been set up yet. Contact your administrator.
      </p>
      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </>
  );
}
