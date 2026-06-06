export default function Loading() {
  return (
    <main className="app-scroll-page bg-[#f7faff] text-[#141515]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#d8e2f0] pb-5">
          <div className="h-4 w-44 rounded bg-[#b7cef2]" />
          <div className="h-9 w-80 max-w-full rounded bg-[#d8e2f0]" />
        </header>
        <section className="rounded-lg border border-[#b7cef2] bg-[#eef5ff] p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="h-20 rounded bg-white/70" />
            <div className="h-20 rounded bg-white/70" />
            <div className="h-20 rounded bg-white/70" />
            <div className="h-20 rounded bg-white/70" />
          </div>
        </section>
        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 h-5 w-36 rounded bg-[#d8e2f0]" />
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-16 rounded border border-[#d8e2f0] bg-[#f7faff]"
                />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 h-5 w-40 rounded bg-[#d8e2f0]" />
            <div className="grid gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-16 rounded border border-[#d8e2f0] bg-[#f7faff]"
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
