"use client";

import { Loader2Icon } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Label + control + hint/error, wired up with aria attributes. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
  required,
}: {
  label: React.ReactNode;
  htmlFor: string;
  error?: string | string[];
  hint?: React.ReactNode;
  className?: string;
  required?: boolean;
  children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string; id?: string }>;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  const describedBy = message ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {React.cloneElement(children, {
        id: htmlFor,
        "aria-invalid": message ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-xs text-destructive">
          {message}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Submit button for <form action={...}> that shows a pending state. */
export function SubmitButton({
  children,
  pendingText,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} className={className} {...props}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}
