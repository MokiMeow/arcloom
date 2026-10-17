export interface Decision {
  model: string;
  outcome: string;
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  margin: number;
  caution_probability: number;
  latency_ms: number;
  estimated_model_cost_usd: number;
  input_sha256: string;
  calibrated_on_arcloom: boolean;
}
export function DecisionReceipt({ decision }: { decision?: Decision | null }) {
  if (!decision) return null;
  return (
    <details className="panel padded">
      <summary>Inspect Cloudflare decision receipt</summary>
      <p>
        <strong>{decision.model}</strong> ·{" "}
        {decision.outcome.replaceAll("_", " ")}
      </p>
      <p className="muted">
        A probability distribution over offered tests, not a probability that a
        vulnerability exists. Thresholds have not been calibrated on Arcloom.
      </p>
      <dl className="property-list">
        {Object.entries(decision.probabilities)
          .sort((a, b) => b[1] - a[1])
          .map(([id, p]) => (
            <div key={id}>
              <dt>{id}</dt>
              <dd>{(100 * p).toFixed(1)}%</dd>
            </div>
          ))}
        <div>
          <dt>Model confidence</dt>
          <dd>{decision.confidence.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Decision margin</dt>
          <dd>{decision.margin.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Caution score</dt>
          <dd>{decision.caution_probability.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Observed request latency</dt>
          <dd>{decision.latency_ms.toFixed(0)} ms</dd>
        </div>
        <div>
          <dt>Estimated inference cost</dt>
          <dd>${decision.estimated_model_cost_usd.toFixed(6)}</dd>
        </div>
      </dl>
      <p className="break-all muted">Input SHA-256: {decision.input_sha256}</p>
      <p className="muted">
        Approval, test observations, and evidence review are separate from this
        decision.
      </p>
    </details>
  );
}
