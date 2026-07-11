import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __aios_sql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  globalThis.__aios_sql ??
  postgres(process.env.DATABASE_URL!, {
    max: 5,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalThis.__aios_sql = sql;

export type TaskStatus = "planning" | "working" | "synthesizing" | "done" | "failed";
export type SubtaskStatus = "pending" | "working" | "done" | "failed";

export interface TaskRow {
  id: string;
  title: string;
  brief: string;
  department: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtaskRow {
  id: string;
  task_id: string;
  worker_key: string;
  title: string;
  status: SubtaskStatus;
  output: string | null;
  position: number;
}

export interface EventRow {
  id: number;
  task_id: string;
  worker_key: string | null;
  message: string;
  created_at: string;
}
