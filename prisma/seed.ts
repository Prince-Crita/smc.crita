import * as dotenv from "dotenv";
// Load env FIRST — must be before any module that reads process.env
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, Role, TaskType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Make sure .env.local exists.");
}

// Use standard pg driver for seeding (runs in Node.js, not edge runtime)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);


const FIXED_TASKS: { taskType: TaskType; title: string; description: string; orderIndex: number }[] = [
  {
    taskType: "OPERATIONAL_VERIFICATION",
    title: "Operational Verification",
    description: "Verify day-to-day operational activities, processes, and compliance with standard operating procedures.",
    orderIndex: 1,
  },
  {
    taskType: "STOCK_VERIFICATION",
    title: "Stock Verification",
    description: "Physical verification of inventory levels, stock records, and reconciliation with system data.",
    orderIndex: 2,
  },
  {
    taskType: "AVF_REPORT",
    title: "AVF Report",
    description: "Audit & Verification Form report preparation covering all audited areas and findings.",
    orderIndex: 3,
  },
  {
    taskType: "ACCOUNTS_VERIFICATION",
    title: "Accounts Verification",
    description: "Review and verify financial records, ledgers, and account balances for accuracy.",
    orderIndex: 4,
  },
  {
    taskType: "MR_MONTHLY_REPORT",
    title: "MR Monthly Report",
    description: "Management Review monthly report compilation covering KPIs, issues, and recommendations.",
    orderIndex: 5,
  },
  {
    taskType: "MD_MEETING",
    title: "MD Meeting",
    description: "Meeting with the Managing Director to discuss findings, recommendations, and strategic updates.",
    orderIndex: 6,
  },
];

const SUBTASKS_BY_TYPE: Record<TaskType, string[]> = {
  OPERATIONAL_VERIFICATION: [
    "Review daily production logs and output reports",
    "Verify shift handover documentation",
    "Inspect equipment maintenance records",
    "Check compliance with safety protocols",
    "Validate process adherence to SOPs",
  ],
  STOCK_VERIFICATION: [
    "Physical count of raw materials in warehouse",
    "Reconcile system stock vs physical count",
    "Verify finished goods inventory",
    "Check damaged/expired stock records",
    "Inspect stock movement register",
  ],
  AVF_REPORT: [
    "Compile audit observations from all sections",
    "Cross-verify with previous AVF findings",
    "Prepare non-conformance summary",
    "Document corrective actions taken",
    "Get departmental sign-off",
  ],
  ACCOUNTS_VERIFICATION: [
    "Verify petty cash register and balance",
    "Review bank reconciliation statement",
    "Check debtors and creditors ledgers",
    "Verify GST returns filed vs records",
    "Review TDS deductions and filings",
  ],
  MR_MONTHLY_REPORT: [
    "Compile KPI performance metrics",
    "Document open issues from last review",
    "Prepare recommendation summary",
    "Get functional head sign-off",
    "Attach supporting evidence documents",
  ],
  MD_MEETING: [
    "Prepare meeting agenda",
    "Present audit summary findings",
    "Discuss critical observations",
    "Record MD decisions and directions",
  ],
};

async function main() {
  console.log("🌱 Starting database seed...");

  // Clear existing data
  await prisma.activityLog.deleteMany();
  await prisma.subtask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password@123", 12);

  // --- USERS ---
  console.log("👤 Creating users...");
  const admin = await prisma.user.create({
    data: {
      name: "Prince",
      email: "prince@smcaudit.com",
      passwordHash,
      role: Role.ADMIN,
    },
  });

  // Permanent Super Admin account
  await prisma.user.create({
    data: {
      name: "Crita",
      email: "Crita@smc.com",
      passwordHash: await bcrypt.hash("Access@Crita123", 12),
      role: Role.SUPER_ADMIN,
    },
  });

  // Additional Admin accounts (email + password login)
  await prisma.user.create({
    data: {
      name: "murali",
      email: "md@shaabi.net",
      passwordHash: await bcrypt.hash("mura@123", 12),
      role: Role.ADMIN,
    },
  });
  await prisma.user.create({
    data: {
      name: "selvi",
      email: "admin@shaabi.net",
      passwordHash: await bcrypt.hash("selv@123", 12),
      role: Role.ADMIN,
    },
  });

  // Executive accounts that log in via mobile number + password
  const mobileExecutives = [
    { name: "john", phone: "9994096508", password: "john@123" },
    { name: "logesh", phone: "8015675796", password: "loge@123" },
    { name: "dhamotharan", phone: "8754392615", password: "dham@123" },
    { name: "kumar", phone: "9994176618", password: "kuma@123" },
    { name: "Muthusamy", phone: "9894873780", password: "muth@123" },
    { name: "Sridhar", phone: "7373463799", password: "srid@123" },
    { name: "Prakaash Prakalathan", phone: "9944996035", password: "prak@123" },
    { name: "Alagarsamy", phone: "8072003412", password: "alag@123" },
  ];
  for (const e of mobileExecutives) {
    await prisma.user.create({
      data: {
        name: e.name,
        email: `phone_${e.phone}@shaabi.local`,
        phone: e.phone,
        passwordHash: await bcrypt.hash(e.password, 12),
        role: Role.EXECUTIVE,
      },
    });
  }

  const executives = await Promise.all([
    prisma.user.create({
      data: {
        name: "Alagarsamy",
        email: "alagarsamy@smcaudit.com",
        passwordHash,
        role: Role.EXECUTIVE,
      },
    }),
    prisma.user.create({
      data: {
        name: "Logesh",
        email: "logesh@smcaudit.com",
        passwordHash,
        role: Role.EXECUTIVE,
      },
    }),
    prisma.user.create({
      data: {
        name: "Karthick",
        email: "karthick@smcaudit.com",
        passwordHash,
        role: Role.EXECUTIVE,
      },
    }),
  ]);

  // --- CLIENTS ---
  console.log("🏢 Creating clients...");
  const clients = await Promise.all([
    prisma.client.create({
      data: {
        name: "Clifton Exports",
        code: "CLF001",
        contactPerson: "Mr. Clifton Fernandez",
        address: "45, Export Industrial Estate, Tirupur - 641604",
        phone: "+91 94430 12345",
        email: "accounts@cliftonexports.com",
      },
    }),
    prisma.client.create({
      data: {
        name: "NTEX Apparels",
        code: "NTX002",
        contactPerson: "Ms. Nithya Suresh",
        address: "12, SIDCO Industrial Area, Coimbatore - 641021",
        phone: "+91 98430 56789",
        email: "finance@ntexapparels.com",
      },
    }),
    prisma.client.create({
      data: {
        name: "CR Garments",
        code: "CRG003",
        contactPerson: "Mr. Chandrasekaran Raja",
        address: "78, Ganapathy Mill Road, Tirupur - 641652",
        phone: "+91 97890 34567",
        email: "admin@crgarments.com",
      },
    }),
    prisma.client.create({
      data: {
        name: "Sree Textiles",
        code: "SRT004",
        contactPerson: "Mr. Sreedhar Nair",
        address: "23, Textile Park, Erode - 638001",
        phone: "+91 99430 78901",
        email: "cfo@sreetextiles.com",
      },
    }),
    prisma.client.create({
      data: {
        name: "Valli Fabrics",
        code: "VLF005",
        contactPerson: "Ms. Valliammai Krishnan",
        address: "101, Fabric Zone, Salem - 636004",
        phone: "+91 98760 23456",
        email: "operations@vallifabrics.com",
      },
    }),
  ]);

  // --- VISITS ---
  console.log("📋 Creating visits with tasks and subtasks...");

  const today = new Date();
  const visitConfigs = [
    // Client 0 (Clifton) → Exec 0 (Alagarsamy)
    { clientIdx: 0, execIdx: 0, daysOffset: -60, status: "CLOSED" as const },
    { clientIdx: 0, execIdx: 0, daysOffset: -30, status: "CLOSED" as const },
    { clientIdx: 0, execIdx: 0, daysOffset: 0, status: "OPEN" as const },

    // Client 1 (NTEX) → Exec 1 (Logesh)
    { clientIdx: 1, execIdx: 1, daysOffset: -45, status: "CLOSED" as const },
    { clientIdx: 1, execIdx: 1, daysOffset: -15, status: "OPEN" as const },
    { clientIdx: 1, execIdx: 1, daysOffset: 15, status: "PENDING" as const },

    // Client 2 (CR Garments) → Exec 2 (Karthick)
    { clientIdx: 2, execIdx: 2, daysOffset: -50, status: "CLOSED" as const },
    { clientIdx: 2, execIdx: 2, daysOffset: -20, status: "OPEN" as const },
    { clientIdx: 2, execIdx: 2, daysOffset: 10, status: "PENDING" as const },

    // Client 3 (Sree Textiles) → Exec 0 (Alagarsamy)
    { clientIdx: 3, execIdx: 0, daysOffset: -35, status: "CLOSED" as const },
    { clientIdx: 3, execIdx: 0, daysOffset: -5, status: "OPEN" as const },
    { clientIdx: 3, execIdx: 0, daysOffset: 25, status: "PENDING" as const },

    // Client 4 (Valli Fabrics) → Exec 1 (Logesh)
    { clientIdx: 4, execIdx: 1, daysOffset: -40, status: "CLOSED" as const },
    { clientIdx: 4, execIdx: 1, daysOffset: -10, status: "PENDING" as const },
    { clientIdx: 4, execIdx: 1, daysOffset: 20, status: "PENDING" as const },
  ];

  let visitCounter = 1;

  for (const config of visitConfigs) {
    const client = clients[config.clientIdx];
    const executive = executives[config.execIdx];
    const scheduledDate = new Date(today);
    scheduledDate.setDate(scheduledDate.getDate() + config.daysOffset);

    const visitNumber = `SMC-VIS-${String(visitCounter).padStart(4, "0")}`;
    visitCounter++;

    const openedAt = config.status !== "PENDING" ? new Date(scheduledDate.getTime() + 2 * 60 * 60 * 1000) : null;
    const closedAt = config.status === "CLOSED" ? new Date(scheduledDate.getTime() + 6 * 60 * 60 * 1000) : null;

    const visit = await prisma.visit.create({
      data: {
        visitNumber,
        clientId: client.id,
        executiveId: executive.id,
        status: config.status,
        scheduledDate,
        openedAt,
        closedAt,
      },
    });

    // Create 6 fixed tasks
    for (const taskDef of FIXED_TASKS) {
      const subtaskTitles = SUBTASKS_BY_TYPE[taskDef.taskType];
      const isMdMeeting = taskDef.taskType === "MD_MEETING";

      // Determine task status based on visit status
      let taskStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "PARTIALLY_COMPLETED" = "PENDING";
      if (config.status === "CLOSED") {
        taskStatus = "COMPLETED";
      } else if (config.status === "OPEN") {
        taskStatus = taskDef.orderIndex <= 3 ? "IN_PROGRESS" : "PENDING";
      }

      const task = await prisma.task.create({
        data: {
          visitId: visit.id,
          taskType: taskDef.taskType,
          title: taskDef.title,
          description: taskDef.description,
          status: taskStatus,
          orderIndex: taskDef.orderIndex,
          mdMeetingAnswer: isMdMeeting && config.status === "CLOSED" ? "YES" : null,
          completedAt: config.status === "CLOSED" ? closedAt : null,
        },
      });

      // Create subtasks
      for (let i = 0; i < subtaskTitles.length; i++) {
        const subtaskTitle = subtaskTitles[i];
        let isCompleted = false;
        let incompletionReason: string | null = null;

        if (config.status === "CLOSED") {
          // For closed visits: most subtasks complete, some with carry-forward scenario
          isCompleted = i < subtaskTitles.length - 1 || taskDef.orderIndex === 6;
          if (!isCompleted) {
            incompletionReason = "Could not complete due to document unavailability during visit. Carried forward to next visit.";
          }
        } else if (config.status === "OPEN") {
          // For open visits: partial completion
          isCompleted = taskDef.orderIndex <= 2 && i < 3;
        }

        await prisma.subtask.create({
          data: {
            taskId: task.id,
            title: subtaskTitle,
            isCompleted,
            incompletionReason,
            completedAt: isCompleted ? closedAt || openedAt : null,
          },
        });
      }
    }

    // Create activity logs for closed/open visits
    if (config.status !== "PENDING") {
      await prisma.activityLog.create({
        data: {
          visitId: visit.id,
          userId: executive.id,
          action: "VISIT_OPENED",
          metadata: { visitNumber, clientName: client.name },
          createdAt: openedAt!,
        },
      });
    }

    if (config.status === "CLOSED") {
      await prisma.activityLog.create({
        data: {
          visitId: visit.id,
          userId: executive.id,
          action: "TASK_COMPLETED",
          metadata: { tasksCompleted: 6, visitNumber },
          createdAt: new Date(scheduledDate.getTime() + 4 * 60 * 60 * 1000),
        },
      });

      await prisma.activityLog.create({
        data: {
          visitId: visit.id,
          userId: executive.id,
          action: "VISIT_CLOSED",
          metadata: { visitNumber, clientName: client.name, summary: "All tasks completed. Visit closed successfully." },
          createdAt: closedAt!,
        },
      });

      // Generate and store visit summary
      await prisma.visit.update({
        where: { id: visit.id },
        data: {
          summaryJson: {
            visitNumber,
            clientName: client.name,
            executiveName: executive.name,
            scheduledDate: scheduledDate.toISOString(),
            closedAt: closedAt!.toISOString(),
            totalTasks: 6,
            completedTasks: 6,
            partialTasks: 0,
            carryForwardCount: 1,
            mdMeetingHeld: true,
            mdMeetingAnswer: "YES",
            keyFindings: [
              "All operational verifications completed successfully",
              "Minor stock discrepancy found and documented",
              "AVF report filed with 2 non-conformances",
              "Accounts reconciled with bank statements",
            ],
            recommendations: [
              "Implement daily stock count procedure",
              "Strengthen purchase order approval workflow",
            ],
            overallRating: "Satisfactory",
          },
        },
      });
    }
  }

  // Log admin login activity
  await prisma.activityLog.create({
    data: {
      userId: admin.id,
      action: "USER_LOGIN",
      metadata: { role: "ADMIN", name: "Prince" },
    },
  });

  console.log("✅ Seed complete!");
  console.log("\n📊 Summary:");
  console.log(`   Users: 1 super admin + 3 admins + ${3 + mobileExecutives.length} executives`);
  console.log(`   Clients: ${clients.length}`);
  console.log(`   Visits: ${visitConfigs.length} (with 6 tasks each)`);
  console.log("\n🔐 Login Credentials:");
  console.log("   Super Admin → Crita@smc.com / Access@Crita123");
  console.log("   Admin       → prince@smcaudit.com / Password@123");
  console.log("   Admin       → md@shaabi.net / mura@123");
  console.log("   Admin       → admin@shaabi.net / selv@123");
  console.log("   Exec (email)  → alagarsamy@smcaudit.com / Password@123");
  console.log("   Exec (email)  → logesh@smcaudit.com / Password@123");
  console.log("   Exec (email)  → karthick@smcaudit.com / Password@123");
  console.log("   Exec (mobile) → see mobileExecutives list in this file for phone/password pairs");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
