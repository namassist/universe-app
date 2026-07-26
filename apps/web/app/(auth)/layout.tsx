/**
 * The unauthenticated shell: the same blob-glow backdrop as the app, without a
 * sidebar or topbar — there is no session yet to render navigation from.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="pointer-events-none fixed -top-30 -right-25 z-0 size-130 rounded-full bg-(--blob-cyan) blur-[130px]" />
      <div className="pointer-events-none fixed -bottom-35 -left-20 z-0 size-120 rounded-full bg-(--blob-blue) blur-[130px]" />
      <main className="relative z-1 grid min-h-screen place-items-center px-6 py-12">
        {children}
      </main>
    </>
  );
}
