import { useState, type FormEvent } from "react";
import { Check, CheckCircle2, Save, ShieldCheck } from "lucide-react";
import type { Settings as SettingsData } from "../types";
import { api, json, message } from "../lib/api";
import {
  Button,
  ErrorNotice,
  Field,
  Loading,
  PageHeader,
} from "../components/ui";

export function Settings({
  settings,
  error,
  refresh,
  onSaved,
}: {
  settings?: SettingsData;
  error: string;
  refresh: () => void;
  onSaved: () => void;
}) {
  return (
    <>
      <PageHeader eyebrow="Preferences" title="Settings" />
      <ErrorNotice error={error} retry={refresh} />
      {settings ? (
        <SettingsForm initial={settings} onSaved={onSaved} />
      ) : !error ? (
        <Loading />
      ) : null}
    </>
  );
}
function SettingsForm({
  initial,
  onSaved,
}: {
  initial: SettingsData;
  onSaved: () => void;
}) {
  const [values, setValues] = useState(() => ({
    ...initial,
    model: initial.model || "gpt-5.4-mini",
    optimize_recordings: initial.optimize_recordings ?? true,
  }));
  const [apiKey, setApiKey] = useState("");
  const [hfToken, setHfToken] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function update<K extends keyof SettingsData>(
    key: K,
    value: SettingsData[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
    setSuccess("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const {
        model,
        whisper_model,
        chunk_minutes,
        parallel_requests,
        language,
        diarization,
        optimize_recordings,
        input_price_per_million,
        output_price_per_million,
      } = values;
      const payload = {
        model,
        whisper_model,
        chunk_minutes,
        parallel_requests,
        language,
        diarization,
        optimize_recordings,
        input_price_per_million,
        output_price_per_million,
        ...(clearKey ? { api_key: "" } : apiKey ? { api_key: apiKey } : {}),
        ...(clearToken
          ? { hf_token: "" }
          : hfToken
            ? { hf_token: hfToken }
            : {}),
      };
      const result = await api<SettingsData>("/settings", json("PUT", payload));
      setValues({
        ...result,
        model: result.model || "gpt-5.4-mini",
        optimize_recordings: result.optimize_recordings ?? true,
      });
      setApiKey("");
      setHfToken("");
      setClearKey(false);
      setClearToken(false);
      setSuccess("Settings saved.");
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setChecking(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<{ ok: boolean; message: string }>(
        "/settings/check",
        json("POST"),
      );
      if (result.ok) setSuccess(result.message);
      else setError(result.message);
    } catch (error) {
      setError(message(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <form onSubmit={submit} className="settings-form">
      <section className="settings-section">
        <div>
          <h2>Note generation</h2>
          <p>Only transcript and extracted context text are sent to OpenAI.</p>
        </div>
        <div className="settings-fields">
          <Field
            label="OpenAI API key"
            hint={
              values.api_key_configured
                ? "A key is saved. Leave blank to keep it."
                : "No key configured."
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              disabled={clearKey}
              placeholder={
                values.api_key_configured ? "Saved key retained" : "sk-…"
              }
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          {values.api_key_configured && (
            <label className="check">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(e) => setClearKey(e.target.checked)}
              />
              Remove saved OpenAI key
            </label>
          )}
          <Field label="OpenAI model">
            <input
              required
              list="note-models"
              value={values.model}
              onChange={(e) => update("model", e.target.value)}
            />
            <datalist id="note-models">
              <option value="gpt-5.4-mini" />
              <option value="gpt-4.1-mini" />
              <option value="gpt-4.1" />
              <option value="gpt-4.1-nano" />
            </datalist>
          </Field>
          <div className="form-grid">
            <Field label="Chunk length (minutes)">
              <input
                required
                type="number"
                min="1"
                max="30"
                step="0.5"
                value={values.chunk_minutes}
                onChange={(e) =>
                  update("chunk_minutes", e.target.valueAsNumber)
                }
              />
            </Field>
            <Field label="Parallel requests">
              <input
                required
                type="number"
                min="1"
                max="4"
                value={values.parallel_requests}
                onChange={(e) =>
                  update("parallel_requests", e.target.valueAsNumber)
                }
              />
            </Field>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Local transcription</h2>
          <p>
            Whisper runs on this computer. The first use of a model may require
            a download.
          </p>
        </div>
        <div className="settings-fields">
          <Field label="Whisper model">
            <select
              value={values.whisper_model}
              onChange={(e) => update("whisper_model", e.target.value)}
            >
              {[
                "tiny",
                "base",
                "small",
                "medium",
                "large-v3",
                "large-v3-turbo",
                "tiny.en",
                "base.en",
                "small.en",
                "medium.en",
              ].map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Default language"
            hint="Language code such as en or fr; blank for automatic detection."
          >
            <input
              value={values.language}
              placeholder="Auto-detect"
              onChange={(e) => update("language", e.target.value)}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={values.diarization}
              onChange={(e) => update("diarization", e.target.checked)}
            />
            Detect speakers locally
          </label>
          <p className="small muted">
            Speaker detection requires pyannote, access to its model, and a
            Hugging Face token. Speaker labels can also be edited manually.
          </p>
          <Field
            label="Hugging Face token"
            hint={
              values.hf_token_configured
                ? "A token is saved. Leave blank to keep it."
                : "No token configured."
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={hfToken}
              disabled={clearToken}
              placeholder={
                values.hf_token_configured ? "Saved token retained" : "hf_…"
              }
              onChange={(e) => setHfToken(e.target.value)}
            />
          </Field>
          {values.hf_token_configured && (
            <label className="check">
              <input
                type="checkbox"
                checked={clearToken}
                onChange={(e) => setClearToken(e.target.checked)}
              />
              Remove saved Hugging Face token
            </label>
          )}
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Recording storage</h2>
        </div>
        <div className="settings-fields">
          <label className="check">
            <input
              type="checkbox"
              checked={values.optimize_recordings}
              disabled={busy}
              onChange={(e) => update("optimize_recordings", e.target.checked)}
            />
            Compress recordings automatically after six hours
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Cost estimates</h2>
          <p>
            Optional USD prices per million tokens. Zero leaves estimates unset.
          </p>
        </div>
        <div className="settings-fields form-grid">
          <Field label="Input price per million">
            <input
              required
              type="number"
              min="0"
              step="0.001"
              value={values.input_price_per_million}
              onChange={(e) =>
                update("input_price_per_million", e.target.valueAsNumber)
              }
            />
          </Field>
          <Field label="Output price per million">
            <input
              required
              type="number"
              min="0"
              step="0.001"
              value={values.output_price_per_million}
              onChange={(e) =>
                update("output_price_per_million", e.target.valueAsNumber)
              }
            />
          </Field>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Local capabilities</h2>
          <p>Availability reported by your LecNote server.</p>
        </div>
        <div className="capabilities">
          {Object.entries(values.capabilities).map(([key, enabled]) => (
            <div key={key}>
              <span>
                {key === "ffmpeg"
                  ? "FFmpeg"
                  : key === "ocr"
                    ? "Image OCR"
                    : key === "whisper"
                      ? "Whisper"
                      : "Speaker detection"}
              </span>
              <span className={enabled ? "good" : "muted"}>
                {enabled ? <Check size={15} /> : null}
                {enabled ? "Available" : "Not installed"}
              </span>
            </div>
          ))}
          <Button
            icon={ShieldCheck}
            onClick={check}
            disabled={checking || busy}
          >
            {checking ? "Checking…" : "Check saved configuration"}
          </Button>
        </div>
      </section>
      <div className="settings-save">
        <ErrorNotice error={error} />
        {success && (
          <div className="notice success" role="status">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}
        <Button type="submit" variant="primary" icon={Save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
