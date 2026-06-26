export default function ExecutiveVisitsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-32 bg-slate-800 rounded-xl" />
        <div className="h-4 w-52 bg-slate-800/60 rounded-lg" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 w-20 bg-slate-800 rounded-lg" />
        ))}
      </div>

      {/* Visit cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-36 bg-slate-800 rounded-lg" />
                <div className="h-3 w-24 bg-slate-800/60 rounded-md" />
              </div>
              <div className="h-5 w-16 bg-slate-800 rounded-full ml-2 flex-shrink-0" />
            </div>
            <div className="h-3 w-40 bg-slate-800/60 rounded-md" />
            <div className="space-y-2">
              <div className="h-2 bg-slate-800 rounded-full" />
              <div className="flex justify-between">
                <div className="h-3 w-20 bg-slate-800/60 rounded-md" />
                <div className="h-3 w-10 bg-slate-800/60 rounded-md" />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-800 flex justify-between">
              <div className="h-3 w-24 bg-slate-800/60 rounded-md" />
              <div className="h-4 w-4 bg-slate-800 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
