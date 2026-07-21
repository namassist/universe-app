import Image from "next/image";

import { cn } from "@/lib/utils";

/* Logo resmi UNIVERSE (public/logoV1.svg) — pengganti huruf "U" dummy */
function UniverseLogo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logoV1.svg"
      alt="UNIVERSE"
      width={60}
      height={60}
      priority={priority}
      className={cn("flex-none", className)}
    />
  );
}

/* Lingkaran kaca ber-ring glow dengan logo di tengah — avatar auth & kiosk */
function LogoBadge({
  className,
  logoClassName,
}: {
  className?: string;
  logoClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid flex-none place-items-center rounded-full border border-(--glass-2-border) bg-(--glass-2-fill) shadow-[0_0_0_3px_var(--ring-avatar),0_0_28px_rgba(0,212,255,.4)] backdrop-blur-md",
        className
      )}
    >
      <UniverseLogo className={logoClassName} />
    </div>
  );
}

export { UniverseLogo, LogoBadge };
