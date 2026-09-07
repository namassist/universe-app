import { DepthScene } from "@/components/ui/depth-scene";

/**
 * The unauthenticated shell: no sidebar, no topbar — there is no session yet to
 * render navigation from. What it does carry is the depth backdrop, because
 * this is the one screen a person looks at while doing nothing but waiting.
 *
 * Everything here is fixed and `pointer-events-none` beneath a `z-1` child, so
 * a page places its own card into the centre and inherits the scene without
 * knowing it exists — login puts a wide two-column card there, change-password
 * a narrow panel, and neither has to say anything about the background.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-0 bg-(image:--gradient-auth)" />
      <div className="pointer-events-none fixed -top-30 -right-25 z-0 size-130 animate-blob-drift rounded-full bg-(--blob-cyan) blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-35 -left-20 z-0 size-120 animate-blob-drift-alt rounded-full bg-(--blob-blue) blur-[130px]" />
      <DepthScene />
      <main className="relative z-1 grid min-h-screen place-items-center p-6">
        {children}
      </main>
    </>
  );
}
