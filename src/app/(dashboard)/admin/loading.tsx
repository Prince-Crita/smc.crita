export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-44 bg-[#e2e7f0] rounded-xl" />
          <div className="h-4 w-64 bg-[#f1f4f9] rounded-lg" />
        </div>
        <div className="h-9 w-9 bg-[#e2e7f0] rounded-xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-[#e2e7f0] rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-3 w-20 bg-[#e2e7f0] rounded-lg" />
                <div className="h-8 w-14 bg-[#f1f4f9] rounded-lg" />
                <div className="h-3 w-24 bg-[#f1f4f9] rounded-md" />
              </div>
              <div className="h-10 w-10 bg-[#e2e7f0] rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Tab row */}
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-28 bg-[#e2e7f0] rounded-lg" />
        ))}
      </div>

      {/* Visit rows */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-[#f1f4f9] last:border-0 p-4 flex items-center gap-4">
            <div className="h-4 w-24 bg-[#e2e7f0] rounded-lg" />
            <div className="h-4 w-32 bg-[#f1f4f9] rounded-lg" />
            <div className="h-4 w-20 bg-[#f1f4f9] rounded-lg" />
            <div className="ml-auto h-5 w-24 bg-[#e2e7f0] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
