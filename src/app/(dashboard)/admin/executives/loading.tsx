export default function ExecutivesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 bg-[#e2e7f0] rounded-xl" />
          <div className="h-4 w-52 bg-[#f1f4f9] rounded-lg" />
        </div>
        <div className="h-9 w-32 bg-[#e2e7f0] rounded-xl" />
      </div>
      <div className="h-10 w-full bg-[#f1f4f9] rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-[#e2e7f0] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-[#e2e7f0] rounded-full flex-shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-32 bg-[#e2e7f0] rounded-lg" />
                <div className="h-3 w-16 bg-[#f1f4f9] rounded-md" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="h-16 bg-[#f8f9fc] rounded-xl border border-[#e2e7f0]" />
              ))}
            </div>
            <div className="h-10 bg-[#f1f4f9] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
