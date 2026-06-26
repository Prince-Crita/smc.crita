import { TaskType } from "@prisma/client";

export const TASK_DEFINITIONS: {
  taskType: TaskType;
  title: string;
  description: string;
  orderIndex: number;
  icon: string;
}[] = [
  {
    taskType: "OPERATIONAL_VERIFICATION",
    title: "Operational Verification",
    description: "Verify day-to-day operational activities and SOP compliance",
    orderIndex: 1,
    icon: "ClipboardCheck",
  },
  {
    taskType: "STOCK_VERIFICATION",
    title: "Stock Verification",
    description: "Physical inventory verification and stock reconciliation",
    orderIndex: 2,
    icon: "Package",
  },
  {
    taskType: "AVF_REPORT",
    title: "AVF Report",
    description: "Audit & Verification Form report preparation",
    orderIndex: 3,
    icon: "FileText",
  },
  {
    taskType: "ACCOUNTS_VERIFICATION",
    title: "Accounts Verification",
    description: "Financial records and account balance verification",
    orderIndex: 4,
    icon: "Calculator",
  },
  {
    taskType: "MR_MONTHLY_REPORT",
    title: "MR Monthly Report",
    description: "Management Review monthly KPI and issue report",
    orderIndex: 5,
    icon: "BarChart2",
  },
  {
    taskType: "MD_MEETING",
    title: "MD Meeting",
    description: "Meeting with Managing Director for findings review",
    orderIndex: 6,
    icon: "Users",
  },
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  OPERATIONAL_VERIFICATION: "Operational Verification",
  STOCK_VERIFICATION: "Stock Verification",
  AVF_REPORT: "AVF Report",
  ACCOUNTS_VERIFICATION: "Accounts Verification",
  MR_MONTHLY_REPORT: "MR Monthly Report",
  MD_MEETING: "MD Meeting",
};

export const VISIT_STATUS_LABELS = {
  PENDING: "Pending",
  OPEN: "In Progress",
  CLOSED: "Closed",
} as const;

export const TASK_STATUS_LABELS = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partial",
} as const;
