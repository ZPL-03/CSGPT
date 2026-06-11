import type { ControlledAgentPlan } from "./server-agent-planner";

export const CONTROLLED_AGENT_PLAN_HEADER = "x-csgpt-agent-plan";

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeControlledAgentPlanHeader(plan: ControlledAgentPlan) {
  const encoded = encodeURIComponent(JSON.stringify(plan));
  return encoded.length <= MAX_HEADER_VALUE_LENGTH ? encoded : "";
}

export function parseControlledAgentPlanHeader(response?: Response) {
  const value = response?.headers?.get(CONTROLLED_AGENT_PLAN_HEADER);
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed as ControlledAgentPlan;
  } catch {
    return null;
  }
}
