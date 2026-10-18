import { useEffect, useRef, useState } from "react";
import { errorText, request, useRemote } from "../api";
import type {
  Dashboard,
  ProviderDiagnostic,
  ProviderStatus,
  Role,
} from "../types";
import { ErrorNotice } from "./ui";

const providerLabels: Record<string, string> = {
  deterministic: "Deterministic (no API key)",
  openai: "OpenAI API",
  gemini: "Gemini",
  cloudflare: "Cloudflare Workers AI",
  chatgpt: "ChatGPT subscription",
  anthropic: "Anthropic",
};
const keyLinks: Record<string, { href: string; label: string }> = {
  openai: {
    href: "https://platform.openai.com/api-keys",
    label: "Create an OpenAI API key",
  },
  gemini: {
    href: "https://aistudio.google.com/api-keys",
    label: "Create a Gemini API key",
  },
  cloudflare: {
    href: "https://dash.cloudflare.com/profile/api-tokens",
    label: "Create a Cloudflare API token",
  },
  anthropic: {
    href: "https://console.anthropic.com/settings/keys",
    label: "Create an Anthropic API key",
  },
};
type Props = {
  model: Dashboard["model"];
  revision: number;
  role: Role;
  changed: () => void;
};
type Draft = {
  provider: string;
  model: string;
  account_id: string;
  profile_id: string;
};
type Authorization = {
  url: string | null;
  until: number;
  sawPending: boolean;
  profiles: string;
};

export function ProviderSettings(props: Props) {
  return (
    <section
      className="panel padded provider-settings"
      aria-labelledby="provider-heading"
    >
      <p className="eyebrow">Planner configuration</p>
      <h2 id="provider-heading">Choose the next investigator’s model.</h2>
      <dl className="property-list">
        <div>
          <dt>Active provider</dt>
          <dd>
            {providerLabels[props.model.provider] ?? props.model.provider}
          </dd>
        </div>
        <div>
          <dt>Active model / policy</dt>
          <dd>{props.model.model}</dd>
        </div>
        <div>
          <dt>Recorded input tokens</dt>
          <dd>{props.model.input_tokens}</dd>
        </div>
        <div>
          <dt>Recorded output tokens</dt>
          <dd>{props.model.output_tokens}</dd>
        </div>
      </dl>
      <p className="footnote">
        Provider failures stay visible. There is no silent fallback. Changes
        apply to new investigators.
      </p>
      {props.role === "admin" ? (
        <ProviderForm {...props} />
      ) : (
        <p className="footnote">
          An administrator can change the model provider.
        </p>
      )}
    </section>
  );
}

function ProviderForm({ revision, changed }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | null>(null);
  const [authorization, setAuthorization] = useState<Authorization | null>(
    null,
  );
  const requestAbort = useRef<AbortController | null>(null);
  const resumedPending = useRef(false);
  const current = useRef(true);
  const providers = useRemote<ProviderStatus>(
    "/api/providers",
    revision,
    authorization ? 5000 : 0,
  );
  const status = providers.data;
  const records = Array.isArray(status?.providers) ? status.providers : [];
  const active = records.find((p) => p.id === status?.active_provider);
  const selected: Draft = draft ?? {
    provider: status?.active_provider ?? "deterministic",
    model: active?.model ?? "",
    account_id: active?.account_id ?? "",
    profile_id: active?.profile_id ?? "",
  };
  const record = records.find((p) => p.id === selected.provider);
  const subscription = selected.provider === "chatgpt";
  const deterministic = selected.provider === "deterministic";
  const profiles = status?.chatgpt?.profiles ?? [];
  const activeProfile = profiles.find(
    (p) => p.id === status?.chatgpt?.active_profile_id,
  );
  const selectedProfile = profiles.find((p) => p.id === selected.profile_id);
  const configuredProfile = profiles.find((p) => p.id === active?.profile_id);
  const models = useRemote<{ items: { id: string; name: string }[] }>(
    subscription && selectedProfile?.connected
      ? `/api/providers/chatgpt/models?profile_id=${encodeURIComponent(selected.profile_id)}`
      : null,
    revision,
  );
  const catalog = models.data?.items ?? [];
  const effectiveModel = subscription
    ? catalog.some((m) => m.id === selected.model)
      ? selected.model
      : (catalog[0]?.id ?? "")
    : selected.model;
  const saved =
    selected.provider === status?.active_provider &&
    effectiveModel === active?.model &&
    (selected.provider !== "cloudflare" ||
      selected.account_id === (active?.account_id ?? "")) &&
    (!subscription ||
      (selectedProfile?.connected &&
        selected.profile_id === active?.profile_id)) &&
    !secret;
  const ready = !providers.loading && records.length > 0;
  const profileFingerprint = JSON.stringify(profiles);
  const keyLink = keyLinks[selected.provider];

  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
      requestAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (subscription && status?.chatgpt?.pending && !resumedPending.current) {
      resumedPending.current = true;
      setAuthorization({
        url: null,
        until: Date.now() + 300000,
        sawPending: true,
        profiles: profileFingerprint,
      });
    }
  }, [subscription, status?.chatgpt?.pending, profileFingerprint]);
  useEffect(() => {
    if (!authorization) return;
    const timeout = window.setTimeout(
      () => {
        setAuthorization(null);
        setNotice(
          "ChatGPT sign-in timed out. Continue with ChatGPT to try again.",
        );
      },
      Math.max(0, authorization.until - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [authorization]);
  useEffect(() => {
    if (!authorization || !status?.chatgpt) return;
    if (providers.error) {
      setAuthorization(null);
      return;
    }
    if (!status.chatgpt.pending && status.chatgpt.last_error) {
      setAuthorization(null);
      setError(status.chatgpt.last_error);
      return;
    }
    if (status.chatgpt.pending && !authorization.sawPending) {
      setAuthorization({ ...authorization, sawPending: true });
    } else if (
      !status.chatgpt.pending &&
      status.chatgpt.connected &&
      (authorization.sawPending ||
        profileFingerprint !== authorization.profiles)
    ) {
      setAuthorization(null);
      setDraft({
        provider: "chatgpt",
        model: selected.model,
        account_id: "",
        profile_id:
          status.chatgpt.active_profile_id ??
          profiles.find((p) => p.connected)?.id ??
          "",
      });
      setNotice(
        "ChatGPT connected. Choose an account and model, then save provider.",
      );
      void models.refresh();
      changed();
    }
  }, [
    authorization,
    status,
    providers.error,
    profileFingerprint,
    changed,
    models.refresh,
  ]);

  function selectProvider(provider: string) {
    const next = records.find((p) => p.id === provider);
    setDraft({
      provider,
      model: next?.model ?? "",
      account_id: next?.account_id ?? "",
      profile_id: next?.profile_id ?? "",
    });
    setSecret("");
    setError(null);
    setNotice(null);
    setDiagnostic(null);
    setAuthorization(null);
    resumedPending.current = true;
  }
  async function action(
    kind: string,
    perform: (signal: AbortSignal) => Promise<void>,
  ) {
    if (busy) return;
    const abort = new AbortController();
    requestAbort.current?.abort();
    requestAbort.current = abort;
    setBusy(kind);
    setError(null);
    setNotice(null);
    setDiagnostic(null);
    try {
      await perform(abort.signal);
    } catch (e) {
      if (current.current && !abort.signal.aborted) setError(errorText(e));
    } finally {
      if (current.current && !abort.signal.aborted) {
        setBusy(null);
        if (kind === "save") setSecret("");
      }
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await action("save", async (signal) => {
      await request(
        "/api/providers",
        "POST",
        {
          provider: selected.provider,
          model: effectiveModel,
          ...(secret.trim() ? { api_key: secret.trim() } : {}),
          ...(selected.provider === "cloudflare"
            ? { account_id: selected.account_id.trim() }
            : {}),
          ...(subscription && selected.profile_id
            ? { profile_id: selected.profile_id }
            : {}),
        },
        signal,
      );
      if (signal.aborted) return;
      setSecret("");
      setDraft(null);
      setNotice(
        "Provider saved. New investigators will use this configuration.",
      );
      await providers.refresh(signal);
      if (!signal.aborted) changed();
    });
  }
  function startSignIn() {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    void action("connect", async (signal) => {
      try {
        const result = await request<{
          authorization_url: string;
          expires_at: number;
        }>(
          "/api/providers/chatgpt/start",
          "POST",
          selected.profile_id ? { profile_id: selected.profile_id } : {},
          signal,
        );
        if (signal.aborted) {
          popup?.close();
          return;
        }
        if (popup) popup.location.href = result.authorization_url;
        await providers.refresh(signal);
        if (signal.aborted) return;
        resumedPending.current = true;
        setAuthorization({
          url: result.authorization_url,
          until: Math.min(result.expires_at * 1000, Date.now() + 300000),
          sawPending: false,
          profiles: profileFingerprint,
        });
      } catch (e) {
        popup?.close();
        throw e;
      }
    });
  }

  return (
    <div className="provider-form">
      <ErrorNotice message={error || providers.error || models.error} />
      {status?.active_provider === "chatgpt" && (
        <p className="notice compact">
          Configured planner account:{" "}
          {configuredProfile?.email ||
            configuredProfile?.label ||
            active?.profile_id ||
            "No account configured"}
          {configuredProfile?.connected ? "" : " · disconnected"}. New
          investigators and connection tests use this saved account until you
          save a change.
        </p>
      )}
      {providers.loading && !status && (
        <p role="status" className="footnote">
          Loading provider configuration…
        </p>
      )}
      {notice && (
        <p role="status" className="notice compact">
          {notice}
        </p>
      )}
      <form onSubmit={(e) => void save(e)}>
        <label>
          Provider
          <select
            disabled={!!busy || !ready}
            value={selected.provider}
            onChange={(e) => selectProvider(e.target.value)}
          >
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {deterministic ? (
          <p className="notice compact">
            Deterministic mode follows the graph policy and requires no API key
            or subscription.
          </p>
        ) : subscription ? (
          <>
            <p className="body-copy">
              Use your ChatGPT subscription through a separate sign-in. Arcloom
              does not receive your chat history or memories. Subscription
              limits apply.
            </p>
            {profiles.length > 0 && (
              <label>
                ChatGPT account
                <select
                  value={selected.profile_id}
                  disabled={!!busy}
                  onChange={(e) => {
                    setDraft({ ...selected, profile_id: e.target.value });
                    setDiagnostic(null);
                  }}
                >
                  <option value="">Connect another account</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.email || p.label}
                      {p.connected ? "" : " (disconnected)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="footnote">
              {selectedProfile?.connected
                ? `Connected as ${selectedProfile.email || selectedProfile.label}`
                : "No ChatGPT account selected and connected."}
            </p>
            {activeProfile?.connected && (
              <p className="footnote">
                Most recent ChatGPT sign-in:{" "}
                {activeProfile.email || activeProfile.label}
              </p>
            )}
            <div className="decision-buttons">
              <button
                className="button"
                type="button"
                disabled={!!busy || !!authorization}
                onClick={startSignIn}
              >
                Continue with ChatGPT
              </button>
              {selectedProfile?.connected && (
                <button
                  className="text-button"
                  type="button"
                  disabled={!!busy || !!authorization}
                  onClick={() =>
                    void action("disconnect", async (signal) => {
                      await request(
                        "/api/providers/chatgpt/disconnect",
                        "POST",
                        { profile_id: selected.profile_id },
                        signal,
                      );
                      if (signal.aborted) return;
                      setNotice("ChatGPT account disconnected.");
                      setDraft(null);
                      await providers.refresh(signal);
                      if (!signal.aborted) changed();
                    })
                  }
                >
                  Disconnect account
                </button>
              )}
            </div>
            {authorization && (
              <div className="notice compact" role="status">
                <span>
                  Complete sign-in in the new tab. Checking every 5 seconds for
                  up to 5 minutes.{" "}
                  {authorization.url && (
                    <a
                      href={authorization.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open ChatGPT sign-in
                    </a>
                  )}{" "}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setAuthorization(null);
                      setNotice(
                        "Stopped checking sign-in. You can continue with ChatGPT again.",
                      );
                    }}
                  >
                    Stop checking
                  </button>
                </span>
              </div>
            )}
            <label>
              ChatGPT model
              <select
                disabled={!!busy || !catalog.length}
                value={effectiveModel}
                onChange={(e) =>
                  setDraft({ ...selected, model: e.target.value })
                }
              >
                {!catalog.length && (
                  <option value="">
                    {models.loading && status?.chatgpt?.connected
                      ? "Loading available models…"
                      : "Connect an account to see models"}
                  </option>
                )}
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="footnote">
              <a
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noopener noreferrer"
              >
                ChatGPT usage
              </a>{" "}
              · API billing is separate from a ChatGPT subscription.
            </p>
          </>
        ) : (
          <>
            <label>
              Model ID
              <input
                required
                maxLength={200}
                value={selected.model}
                disabled={!!busy}
                onChange={(e) => {
                  setDraft({ ...selected, model: e.target.value });
                  setDiagnostic(null);
                }}
              />
            </label>
            {selected.provider === "cloudflare" && (
              <label>
                Cloudflare account ID
                <input
                  required
                  maxLength={200}
                  autoComplete="off"
                  disabled={!!busy}
                  value={selected.account_id}
                  onChange={(e) =>
                    setDraft({ ...selected, account_id: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              API key
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={secret}
                disabled={!!busy}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setDiagnostic(null);
                }}
                aria-describedby="provider-key-help"
              />
            </label>
            <p id="provider-key-help" className="footnote">
              {record?.key_configured
                ? "Key configured. Leave blank to keep this provider’s saved key."
                : "No key configured for this provider. Enter a key to use it."}{" "}
              Keys are stored on the server and never returned to this form.{" "}
              {keyLink && (
                <a
                  href={keyLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {keyLink.label}
                </a>
              )}
            </p>
          </>
        )}
        <div className="decision-buttons">
          <button
            className="button primary"
            disabled={
              !!busy ||
              !ready ||
              !!authorization ||
              (subscription && (!selectedProfile?.connected || !effectiveModel))
            }
          >
            {busy === "save" ? "Saving provider…" : "Save provider"}
          </button>
          <button
            className="button"
            type="button"
            disabled={!!busy || !ready || !saved || !!authorization}
            onClick={() =>
              void action("test", async (signal) => {
                const result = await request<ProviderDiagnostic>(
                  "/api/providers/test",
                  "POST",
                  undefined,
                  signal,
                );
                if (!signal.aborted) {
                  setDiagnostic(result);
                  changed();
                }
              })
            }
          >
            {busy === "test" ? "Testing connection…" : "Test connection"}
          </button>
        </div>
        <p className="footnote">
          Save changes before testing. Test connection may use provider quota
          and model-call budget.
        </p>
      </form>
      {diagnostic && (
        <div
          className={`notice ${diagnostic.status === "error" ? "error" : diagnostic.status === "needs_review" ? "warning" : "success"}`}
          role="status"
        >
          <div>
            <strong>
              {diagnostic.status === "selected"
                ? "Connection test: selected"
                : diagnostic.status === "needs_review"
                  ? "Connection test: needs review"
                  : "Connection test: error"}
            </strong>
            <p>{diagnostic.reason}</p>
            <p className="footnote">
              {diagnostic.provider} · {diagnostic.model} ·{" "}
              {diagnostic.input_tokens} input · {diagnostic.output_tokens}{" "}
              output tokens
            </p>
            <p className="footnote">
              Diagnostic only. This does not create a case or verify a finding.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
