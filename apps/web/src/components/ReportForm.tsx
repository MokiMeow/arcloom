import { useEffect, useRef, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import { request, errorText } from "../api";
import type { Catalog } from "../types";
import { ErrorNotice } from "./ui";

export function ReportForm({
  catalog,
  close,
  created,
}: {
  catalog: Catalog;
  close: () => void;
  created: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [testId, setTestId] = useState(catalog.tests[0]?.id ?? "");
  const test = catalog.tests.find((t) => t.id === testId)!;
  const [title, setTitle] = useState(test?.title ?? "");
  const [description, setDescription] = useState("");
  const [researcher, setResearcher] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await request<{ case_id: string }>(
        "/api/reports",
        "POST",
        {
          title,
          description,
          researcher,
          test_id: testId,
          asset_id: test.asset_id,
        },
      );
      created(result.case_id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="modal"
      ref={dialog}
      onCancel={close}
      aria-labelledby="report-title"
    >
      <form onSubmit={submit}>
        <header className="modal-head">
          <div>
            <p className="eyebrow">Start an investigation</p>
            <h2 id="report-title">Submit a vulnerability report</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close report"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            Only the registered synthetic lab is in scope. Do not submit
            credentials, customer data, or external targets.
          </span>
        </div>
        <label>
          Registered reproduction test
          <select
            required
            value={testId}
            onChange={(e) => {
              setTestId(e.target.value);
              setTitle(
                catalog.tests.find((t) => t.id === e.target.value)!.title,
              );
            }}
          >
            {catalog.tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <small>
            Target locked to {test.asset_id}. At most {test.request_limit}{" "}
            fixture requests.
          </small>
        </label>
        <label>
          Report title
          <input
            required
            minLength={5}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Original researcher
          <input
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            placeholder="Researcher or team attribution"
            value={researcher}
            onChange={(e) => setResearcher(e.target.value)}
          />
        </label>
        <label>
          What did you observe?
          <textarea
            required
            minLength={10}
            maxLength={8000}
            rows={5}
            placeholder="Describe the observation in the controlled lab. A report is not yet a verified finding."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <ErrorNotice message={error} />
        <footer className="modal-foot">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Submitting…" : "Create investigation"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
