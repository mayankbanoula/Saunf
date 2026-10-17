// Small presentational primitives: Label, Card, Badge, Skeleton, Separator, Progress, Avatar, Alert.
import { cva, type VariantProps } from "class-variance-authority";
import {
  Avatar as AvatarPrimitive,
  Label as LabelPrimitive,
  Progress as ProgressPrimitive,
  Separator as SeparatorPrimitive,
} from "radix-ui";
import * as React from "react";

import { cn, initials } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-lg border bg-card text-card-foreground shadow-[0_1px_2px_0_rgb(0_0_0/0.03)]", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        warning: "border-transparent bg-warning/15 text-[oklch(0.45_0.1_60)]",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

export function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      value={v}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - v}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

const AVATAR_TONES = [
  "bg-[oklch(0.92_0.05_150)] text-[oklch(0.35_0.07_155)]",
  "bg-[oklch(0.92_0.04_245)] text-[oklch(0.38_0.09_250)]",
  "bg-[oklch(0.93_0.05_70)] text-[oklch(0.42_0.09_60)]",
  "bg-[oklch(0.92_0.04_300)] text-[oklch(0.4_0.1_300)]",
  "bg-[oklch(0.93_0.04_20)] text-[oklch(0.42_0.1_25)]",
  "bg-[oklch(0.92_0.03_190)] text-[oklch(0.38_0.07_200)]",
];

function toneFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

export function UserAvatar({
  name,
  id,
  src,
  className,
  size = "md",
}: {
  name: string | null | undefined;
  id?: string | null;
  src?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizes = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" };
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex shrink-0 overflow-hidden rounded-full", sizes[size], className)}
      title={name ?? undefined}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        className={cn("flex size-full items-center justify-center font-semibold", toneFor(id ?? name ?? "?"))}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:size-4 flex gap-3 items-start", {
  variants: {
    variant: {
      default: "bg-card",
      destructive: "border-destructive/30 bg-destructive/5 text-destructive",
      success: "border-[var(--status-done)]/30 bg-accent text-accent-foreground",
      warning: "border-warning/40 bg-warning/10 text-[oklch(0.4_0.09_60)]",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
