export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-44 bg-slate-800 rounded-xl" />
          <div className="h-4 w-64 bg-slate-800/60 rounded-lg" />
        </div>
        <div className="h-9 w-9 bg-slate-800 rounded-xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-4 w-20 bg-slate-800 rounded-lg" />
                <div className="h-8 w-14 bg-slate-800 rounded-lg" />
                <div className="h-3 w-24 bg-slate-800/60 rounded-md" />
              </div>
              <div className="h-10 w-10 bg-slate-800 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Tab row */}
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-28 bg-slate-800 rounded-xl" />
        ))}
      </div>

      {/* Visit rows */}
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-4">
            <div className="h-4 w-24 bg-slate-800 rounded-lg" />
            <div className="h-4 w-32 bg-slate-800/80 rounded-lg" />
            <div className="h-4 w-20 bg-slate-800/60 rounded-lg" />
            <div className="ml-auto h-4 w-28 bg-slate-800 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
