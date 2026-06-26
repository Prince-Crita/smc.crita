export default function ExecutiveLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-44 bg-slate-800 rounded-xl" />
        <div className="h-4 w-56 bg-slate-800/60 rounded-lg" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-20 bg-slate-800 rounded-md" />
              <div className="h-8 w-8 bg-slate-800 rounded-xl" />
            </div>
            <div className="h-8 w-12 bg-slate-800 rounded-lg" />
            <div className="h-3 w-16 bg-slate-800/60 rounded-md" />
          </div>
        ))}
      </div>

      {/* Visit cards section */}
      <div className="space-y-3">
        <div className="h-5 w-32 bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between">
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-36 bg-slate-800 rounded-lg" />
                  <div className="h-3 w-24 bg-slate-800/60 rounded-md" />
                </div>
                <div className="h-5 w-16 bg-slate-800 rounded-full" />
              </div>
              <div className="h-2 bg-slate-800 rounded-full" />
              <div className="h-3 w-28 bg-slate-800/60 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
