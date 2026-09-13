import type {
  Attribution,
  Branch,
  ExperimentInteractionEvent,
  ExperimentRoute,
  ExperimentSubmittedEvent,
} from "../intake/types";
import { extractAttribution } from "../intake/validation";

export const EXPERIMENT_SESSION_KEY = "orstudio_experiment_session_v1";
const FORM_STARTED_KEY_PREFIX = "orstudio_experiment_form_started_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ExperimentSession extends Attribution {
  session_id: string;
}

export interface ExperimentMemory {
  session: ExperimentSession | null;
  startedForms: Set<string>;
}

type SessionStorage = Pick<Storage, "getItem" | "setItem">;

const browserMemory = createExperimentMemory();

export function createExperimentMemory(): ExperimentMemory {
  return { session: null, startedForms: new Set() };
}

function parseStoredSession(raw: string | null): ExperimentSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const allowedKeys = new Set(["session_id", "source", "campaign", "message_variant"]);
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
    if (!UUID_PATTERN.test(String(record.session_id ?? ""))) return null;
    for (const key of ["source", "campaign", "message_variant"] as const) {
      if (Object.hasOwn(record, key) &&
        (typeof record[key] !== "string" || !record[key].trim() || record[key].length > 200)) {
        return null;
      }
    }
    return {
      session_id: record.session_id as string,
      source: record.source as string | undefined,
      campaign: record.campaign as string | undefined,
      message_variant: record.message_variant as string | undefined,
    };
  } catch {
    return null;
  }
}

export function getExperimentSession(
  storage: SessionStorage | null,
  search: string,
  randomUUID: () => string,
  memory: ExperimentMemory = browserMemory,
): ExperimentSession {
  if (memory.session) return memory.session;

  try {
    const stored = parseStoredSession(storage?.getItem(EXPERIMENT_SESSION_KEY) ?? null);
    if (stored) {
      memory.session = stored;
      return stored;
    }
  } catch {
    // Storage failures are intentionally non-blocking.
  }

  const session = { session_id: randomUUID(), ...extractAttribution(search) };
  memory.session = session;
  try {
    storage?.setItem(EXPERIMENT_SESSION_KEY, JSON.stringify(session));
  } catch {
    // The in-memory first-touch context remains usable for this page lifecycle.
  }
  return session;
}

export function getCurrentExperimentSession(): ExperimentSession {
  let storage: SessionStorage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Continue with the in-memory context.
  }
  return getExperimentSession(storage, window.location.search, () => crypto.randomUUID());
}

export function routeForBranch(branch: Branch): ExperimentRoute {
  return branch === "FDM" ? "/pecas" : "/resina";
}

function eventContext(session: ExperimentSession, branch: Branch) {
  return {
    session_id: session.session_id,
    branch,
    route: routeForBranch(branch),
    source: session.source,
    campaign: session.campaign,
    message_variant: session.message_variant,
  };
}

export function buildInteractionEvent(
  eventName: ExperimentInteractionEvent["event_name"],
  session: ExperimentSession,
  branch: Branch,
): ExperimentInteractionEvent {
  return { event_name: eventName, ...eventContext(session, branch) };
}

export function buildSubmittedEvent(
  session: ExperimentSession,
  branch: Branch,
  projectId: string,
): ExperimentSubmittedEvent {
  return {
    event_name: "form_submitted",
    ...eventContext(session, branch),
    project_id: projectId,
  };
}

export function claimFormStarted(
  storage: SessionStorage | null,
  sessionId: string,
  route: ExperimentRoute,
  memory: ExperimentMemory = browserMemory,
): boolean {
  const marker = `${sessionId}:${route}`;
  if (memory.startedForms.has(marker)) return false;
  const key = `${FORM_STARTED_KEY_PREFIX}:${marker}`;
  try {
    if (storage?.getItem(key) === "1") {
      memory.startedForms.add(marker);
      return false;
    }
  } catch {
    // Fall through to the in-memory once marker.
  }
  memory.startedForms.add(marker);
  try {
    storage?.setItem(key, "1");
  } catch {
    // The in-memory marker still prevents duplicates for this page lifecycle.
  }
  return true;
}

export function claimCurrentFormStarted(sessionId: string, route: ExperimentRoute): boolean {
  let storage: SessionStorage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Continue with the in-memory marker.
  }
  return claimFormStarted(storage, sessionId, route);
}
