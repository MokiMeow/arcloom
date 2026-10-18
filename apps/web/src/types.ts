import type { Decision } from "./components/DecisionReceipt";
export type Role = "admin" | "reviewer" | "researcher" | "viewer";
export interface Actor {
  id: string;
  tenant: string;
  role: Role;
}
export interface Session {
  actor: Actor;
  csrf: string | null;
}
export type CaseState =
  | "awaiting_approval"
  | "queued"
  | "running"
  | "awaiting_review"
  | "confirmed"
  | "not_reproduced"
  | "inconclusive"
  | "rejected"
  | "denied";
export type Outcome = "reproduced" | "not_reproduced" | "inconclusive";
export interface Link {
  source: string;
  relation: string;
  target: string;
  props?: Record<string, unknown>;
}
export interface Finding {
  id: string;
  title: string;
  case_id: string;
  test_id: string;
  revision: string;
  current: boolean;
  researcher: string;
  supports: string[];
  depth: number;
}
export interface Dashboard {
  workspace: string;
  revision: string;
  revision_title: string;
  scope_enabled: boolean;
  scope_expires_at: number;
  counts: Partial<Record<CaseState, number>>;
  findings: Finding[];
  verified_current: number;
  verified_historical: number;
  memory: {
    engine: string;
    available: boolean;
    pending_events: number;
    in_sync: boolean;
  };
  budget: {
    executions: number;
    execution_limit: number;
    model_calls: number;
    model_call_limit: number;
  };
  model: {
    provider: string;
    model: string;
    live_llm: boolean;
    remote_model?: boolean;
    decision_model?: boolean;
    input_tokens: number;
    output_tokens: number;
    sessions: number;
  };
  worker: {
    enabled: boolean;
    last_tick: number | null;
    last_error: string | null;
  };
  synthetic: boolean;
  at: number;
}
export interface TestDefinition {
  id: string;
  title: string;
  asset_id: string;
  requirements: string[];
  enables: string[];
  impact: number;
  request_limit: number;
  description: string;
}
export interface Catalog {
  assets: { id: string; title: string }[];
  tests: TestDefinition[];
  revisions: Record<string, string>;
  boundary: string;
}
export interface Observation {
  label?: string;
  path: string;
  status: number;
  body_sha256: string;
  [key: string]: unknown;
}
export interface Receipt {
  run_id: string;
  case_id: string;
  test_id: string;
  revision: string;
  tenant: string;
  outcome: Outcome;
  conclusion: string;
  observations: Observation[];
  request_count: number | null;
  environment: string;
  signature: string;
  synthetic: boolean;
  [key: string]: unknown;
}
export interface Run {
  id: string;
  outcome: Outcome;
  evidence_hash: string;
  receipt: Receipt;
  revision: string;
  created_at: number;
}
export interface Case {
  id: string;
  title: string;
  test_id: string;
  asset_id: string;
  revision: string;
  origin: string;
  state: CaseState;
  researcher: string;
  reason: string;
  supports: string[];
  path: Link[];
  depth: number;
  stale: boolean;
  created_at: number;
  updated_at: number;
  reports?: { id: string; researcher: string; description: string }[];
  runs?: Run[];
  finding?: Finding | null;
  reviews?: { id: string; reason: string; decision: string; actor: string }[];
  approvals?: { id: string; reason: string; decision: string; actor: string }[];
}
export interface CasePage {
  items: Case[];
  total: number;
  limit: number;
  offset: number;
}
export interface GraphNode {
  id: string;
  kind: string;
  props: Record<string, unknown>;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: Link[];
  engine: string;
  graph_name: string;
  selection_query: string;
  warning: string;
}
export interface Agent {
  decision?: Decision | null;
  id: string;
  provider: string;
  model: string;
  status: string;
  case_id: string | null;
  reason: string;
  previous_messages: number;
  created_at: number;
  candidates: Candidate[];
  input_tokens: number;
  output_tokens: number;
}
export interface Candidate {
  id: string;
  title: string;
  score: number;
  finding_ids: string[];
  requirements: string[];
  path: Link[];
}
export interface Discovery {
  agent_id: string;
  status: string;
  case_id: string | null;
  reason?: string;
  provider: string;
  selection?: Candidate;
}
export interface AuditEvent {
  seq: number;
  kind: string;
  object_id: string;
  actor: string;
  at: number;
  payload: Record<string, unknown>;
  event_hash: string;
}
export interface Events {
  items: AuditEvent[];
  cursor: number;
  has_more: boolean;
}
export interface ProviderConfiguration {
  id: string;
  label: string;
  model: string;
  key_configured: boolean;
  account_id: string | null;
  profile_id: string | null;
  connected: boolean;
}
export interface ProviderStatus {
  active_provider: string;
  providers: ProviderConfiguration[];
  available_providers: { id: string; label: string }[];
  chatgpt: {
    connected: boolean;
    active_profile_id: string | null;
    profiles: {
      id: string;
      email: string;
      label: string;
      connected: boolean;
    }[];
    pending: boolean;
    last_error?: string | null;
    revocation_confirmed?: boolean | null;
  };
}
export interface ProviderDiagnostic {
  status: "selected" | "needs_review" | "error";
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  reason: string;
  error?: string;
}

export interface HandoffPacket {
  schemaVersion: 1;
  workspace: { tenant: string; revision: string };
  graph: { engine: "FalkorDB"; in_sync: boolean };
  audit: { valid: boolean; checked: number; head_hash: string | null };
  summary: {
    confirmed_current: number;
    negative_current: number;
    inconclusive_current: number;
    eligible_followups: number;
  };
  findings: {
    id: string;
    case_id: string;
    title: string;
    asset_id: string;
    revision: string;
    depth: number;
    original_researcher?: string;
    evidence: {
      artifact_id: string;
      sha256: string;
      run_id: string;
      signature_verified: boolean;
    };
    capabilities: string[];
  }[];
  candidates: {
    test_id: string;
    asset_id: string;
    title: string;
    depth: number;
    requires: string[];
    finding_ids: string[];
    paths: Link[][];
  }[];
  observations: {
    case_id: string;
    test_id: string;
    title: string;
    state: string;
    outcome: string | null;
    revision: string;
  }[];
  blocked: {
    test_id: string;
    title: string;
    reason: string;
    missing_capabilities: string[];
  }[];
  packet_sha256: string;
}
