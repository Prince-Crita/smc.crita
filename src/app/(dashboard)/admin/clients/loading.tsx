export default function ClientsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-28 bg-slate-800 rounded-xl" />
          <div className="h-4 w-48 bg-slate-800/60 rounded-lg" />
        </div>
        <div className="h-9 w-28 bg-slate-800 rounded-xl" />
      </div>
      <div className="flex gap-2.5">
        <div className="h-10 flex-1 bg-slate-800 rounded-xl" />
        <div className="h-10 w-20 bg-slate-800 rounded-xl" />
        <div className="h-10 w-10 bg-slate-800 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-slate-800 rounded-xl flex-shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-36 bg-slate-800 rounded-lg" />
                <div className="h-3 w-12 bg-slate-800/60 rounded-md" />
              </div>
            </div>
            <div className="space-y-1.5">
              {[...Array(3)].map((_, j) => <div key={j} className="h-3 w-40 bg-slate-800/60 rounded-md" />)}
            </div>
            <div className="h-12 bg-slate-800/40 rounded-xl" />
            <div className="h-9 bg-slate-800 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
