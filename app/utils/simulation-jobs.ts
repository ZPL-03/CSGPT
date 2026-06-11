import { z, ZodError } from "zod";

export const SIMULATION_SOLVERS = [
  "calculix",
  "abaqus",
  "ansys",
  "comsol",
  "custom",
] as const;

export const SIMULATION_STATUSES = [
  "queued",
  "submitted",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SimulationSolver = (typeof SIMULATION_SOLVERS)[number];
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

const plainObjectSchema = z
  .record(z.unknown())
  .refine((value) => !Array.isArray(value), "必须是对象");

export const simulationJobCreateSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(120, "标题过长"),
  solver: z.enum(SIMULATION_SOLVERS),
  input: plainObjectSchema,
  conversationId: z.string().trim().min(1).max(200).optional(),
  messageId: z.string().trim().min(1).max(200).optional(),
  submitToExternal: z.boolean().optional(),
});

export const simulationJobUpdateSchema = z
  .object({
    status: z.enum(SIMULATION_STATUSES).optional(),
    result: z.unknown().optional(),
    error: z.string().trim().max(4000).nullable().optional(),
    externalJobId: z.string().trim().max(300).nullable().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.result !== undefined ||
      value.error !== undefined ||
      value.externalJobId !== undefined,
    "至少需要一个更新字段",
  );

export type SimulationJobCreateInput = z.infer<
  typeof simulationJobCreateSchema
>;

export type SimulationJobUpdateInput = z.infer<
  typeof simulationJobUpdateSchema
>;

export type SimulationJobRecord = {
  id: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  solver: string;
  status: string;
  title: string;
  input: unknown;
  result: unknown | null;
  externalJobId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function formatSimulationValidationError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function getFemServiceConfig() {
  return {
    baseUrl: process.env.FEM_SERVICE_BASE_URL?.trim() || "",
    apiKey: process.env.FEM_SERVICE_API_KEY?.trim() || "",
    jobsPath: process.env.FEM_SERVICE_JOBS_PATH?.trim() || "/jobs",
  };
}

export function isFemServiceConfigured() {
  const config = getFemServiceConfig();
  return Boolean(config.baseUrl);
}

export function buildFemServiceJobUrl(baseUrl: string, jobsPath: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = jobsPath.startsWith("/") ? jobsPath : `/${jobsPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function normalizeSimulationStatus(
  status: unknown,
): SimulationStatus | undefined {
  if (typeof status !== "string") return undefined;
  return SIMULATION_STATUSES.includes(status as SimulationStatus)
    ? (status as SimulationStatus)
    : undefined;
}

export function normalizeSimulationJob(job: SimulationJobRecord) {
  return {
    id: job.id,
    userId: job.userId,
    conversationId: job.conversationId,
    messageId: job.messageId,
    solver: job.solver,
    status: job.status,
    title: job.title,
    input: job.input,
    result: job.result,
    externalJobId: job.externalJobId,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function buildFemServiceSubmissionPayload(job: SimulationJobRecord) {
  return {
    id: job.id,
    title: job.title,
    solver: job.solver,
    input: job.input,
    conversationId: job.conversationId,
    messageId: job.messageId,
  };
}
