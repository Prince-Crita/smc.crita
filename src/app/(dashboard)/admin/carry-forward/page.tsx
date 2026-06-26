import { prisma } from "@/lib/db/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { formatDate, formatDateTime } from "@/lib/utils/utils";
import { RotateCcw, ArrowRight, CheckCircle2, XCircle, Building2 } from "lucide-react";
import { cn } from "@/lib/utils/utils";

async function getCarryForwardData() {
  const carriedSubtasks = await prisma.subtask.findMany({
    where: { isCarriedForward: true },
    select: {
      id:          true,
      title:       true,
      isCompleted: true,
      task: {
        select: {
          visitId: true,
          title:   true,
          visit: {
            select: {
              visitNumber:   true,
              status:        true,
              scheduledDate: true,
              client: { select: { name: true, code: true } },
              executive: { select: { name: true } },
            },
          },
        },
      },
      sourceSubtask: {
        select: {
          task: {
            select: {
              visit: {
                select: { visitNumber: true, scheduledDate: true, closedAt: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group by destination visit
  const byVisit = new Map<string, typeof carriedSubtasks>();
  for (const s of carriedSubtasks) {
    const vId = s.task.visitId;
    if (!byVisit.has(vId)) byVisit.set(vId, []);
    byVisit.get(vId)!.push(s);
  }

  return Array.from(byVisit.entries()).map(([, subtasks]) => ({
    visitNumber: subtasks[0].task.visit.visitNumber,
    visitId: subtasks[0].task.visitId,
    visitStatus: subtasks[0].task.visit.status,
    clientName: subtasks[0].task.visit.client.name,
    clientCode: subtasks[0].task.visit.client.code,
    executiveName: subtasks[0].task.visit.executive.name,
    scheduledDate: subtasks[0].task.visit.scheduledDate,
    items: subtasks,
  }));
}

export default async function CarryForwardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");
  const user = await verifyJwt(token);
  if (!user || user.role !== "ADMIN") redirect("/login");

  const groups = await getCarryForwardData();
  const totalCarried = groups.reduce((s, g) => s + g.items.length, 0);
  const completedCarried = groups.reduce((s, g) => s + g.items.filter((i: any) => i.isCompleted).length, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Carry-Forward History</h1>
        <p className="text-slate-500 text-sm mt-1">
          Incomplete subtasks automatically carried to next visits
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <p className="text-sm text-slate-500">Total Carried</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-400 mt-0 sm:mt-1">{totalCarried}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <p className="text-sm text-slate-500">Resolved</p>
          <p className="text-2xl sm:text-3xl font-bold text-emerald-400 mt-0 sm:mt-1">{completedCarried}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <p className="text-sm text-slate-500">Still Pending</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-400 mt-0 sm:mt-1">{totalCarried - completedCarried}</p>
        </div>
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-600">
          <RotateCcw className="w-10 h-10 mb-3" />
          <p className="text-sm">No carry-forward items found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.visitId} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              {/* Group header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                    <RotateCcw className="w-4 h-4 text-orange-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white">{group.clientName}</p>
                      <span className="text-xs text-slate-500 font-mono">{group.visitNumber}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {group.executiveName} · Scheduled {formatDate(group.scheduledDate)}
                    </p>
                  </div>
                </div>
                <span className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border",
                  group.visitStatus === "CLOSED" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" :
                  group.visitStatus === "OPEN" ? "text-blue-400 bg-blue-400/10 border-blue-400/20" :
                  "text-amber-400 bg-amber-400/10 border-amber-400/20"
                )}>
                  {group.visitStatus === "OPEN" ? "In Progress" : group.visitStatus.charAt(0) + group.visitStatus.slice(1).toLowerCase()}
                </span>
              </div>

              {/* Items */}
              <div className="divide-y divide-slate-800/50">
                {group.items.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-start gap-4">
                    {item.isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white">{item.title.replace("[CARRY-FORWARD] ", "")}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{item.task.title}</p>
                      {item.sourceSubtask && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-xs text-slate-600">From</span>
                          <span className="text-xs text-orange-400 font-mono">
                            {item.sourceSubtask.task.visit.visitNumber}
                          </span>
                          <span className="text-xs text-slate-600">
                            (closed {formatDate(item.sourceSubtask.task.visit.closedAt)})
                          </span>
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-medium flex-shrink-0 ${item.isCompleted ? "text-emerald-400" : "text-red-400"}`}>
                      {item.isCompleted ? "Resolved" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
