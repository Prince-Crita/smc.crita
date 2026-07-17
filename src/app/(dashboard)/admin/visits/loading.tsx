export default function AdminVisitsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-32 bg-[#e2e7f0] rounded-xl" />
        <div className="h-4 w-52 bg-[#f1f4f9] rounded-lg" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-[#e2e7f0] rounded-xl p-3.5">
            <div className="h-3 w-14 bg-[#e2e7f0] rounded-md mb-2" />
            <div className="h-7 w-10 bg-[#f1f4f9] rounded-lg" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-4">
        <div className="h-9 w-full bg-[#f1f4f9] rounded-lg" />
      </div>
      <div className="hidden md:block bg-white border border-[#e2e7f0] rounded-xl overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="border-b border-[#f1f4f9] last:border-0 p-4 flex items-center gap-4">
            <div className="h-4 w-24 bg-[#e2e7f0] rounded-lg" />
            <div className="h-4 w-32 bg-[#f1f4f9] rounded-lg" />
            <div className="h-4 w-20 bg-[#f1f4f9] rounded-lg" />
            <div className="ml-auto h-5 w-24 bg-[#e2e7f0] rounded-full" />
          </div>
        ))}
      </div>
      <div className="md:hidden space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-[#e2e7f0] rounded-xl p-4 space-y-3">
            <div className="h-4 w-3/4 bg-[#e2e7f0] rounded-lg" />
            <div className="h-2 bg-[#f1f4f9] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
