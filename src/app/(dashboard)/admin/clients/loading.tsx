export default function ClientsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-28 bg-[#e2e7f0] rounded-xl" />
          <div className="h-4 w-48 bg-[#f1f4f9] rounded-lg" />
        </div>
        <div className="h-9 w-28 bg-[#e2e7f0] rounded-xl" />
      </div>
      <div className="flex gap-2.5">
        <div className="h-10 flex-1 bg-[#f1f4f9] rounded-lg" />
        <div className="h-10 w-20 bg-[#f1f4f9] rounded-lg" />
        <div className="h-10 w-10 bg-[#e2e7f0] rounded-lg" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white border border-[#e2e7f0] rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-[#e2e7f0] rounded-xl flex-shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-36 bg-[#e2e7f0] rounded-lg" />
                <div className="h-3 w-12 bg-[#f1f4f9] rounded-md" />
              </div>
            </div>
            <div className="space-y-1.5">
              {[...Array(3)].map((_, j) => <div key={j} className="h-3 w-40 bg-[#f1f4f9] rounded-md" />)}
            </div>
            <div className="h-12 bg-[#f8f9fc] rounded-xl border border-[#e2e7f0]" />
            <div className="h-9 bg-[#f1f4f9] rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
