import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, KeyRound, Copy, Trash2, AlertTriangle, Sparkles } from "lucide-react";
import {
  createDeveloperKey,
  deleteDeveloperKey,
  getDeveloperKeys,
} from "../../utils/api";
import { type DeveloperKeysResponse } from "../../types";

interface Props {
  token: string;
  onClose: () => void;
}

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Invalid date";
  }
}

export default function DeveloperPanel({ token, onClose }: Props) {
  const [keysResponse, setKeysResponse] = useState<DeveloperKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);

  const loadKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getDeveloperKeys(token);
      setKeysResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
      setKeysResponse(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, [token]);

  const planLimit = keysResponse?.planLimit;
  const keys = keysResponse?.keys ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      const next = await createDeveloperKey(token, name.trim() || undefined);
      setCreatedSecret(next.key);
      setName("");
      await loadKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingKeyId) return;
    setDeletingKeyId(id);
    try {
      await deleteDeveloperKey(token, id);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    } finally {
      setDeletingKeyId(null);
    }
  };

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
    } catch {
      const input = document.createElement("input");
      input.value = createdSecret;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }

    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border-3 border-memphis-black shadow-hard-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 py-4 border-b-3 border-memphis-black flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wide">Developer API</h2>
          <button onClick={onClose} className="text-memphis-black/50 hover:text-memphis-black text-xl font-bold">×</button>
        </div>

        <div className="p-5">
          <p className="text-xs text-memphis-black/70 mb-4">
            Use API keys to fetch country indicators and batch exports from the public API.
            Rate limit is tied to your subscription tier.
          </p>

          <div className="grid md:grid-cols-3 gap-3 mb-5">
            <div className="bg-memphis-offwhite border-3 border-memphis-black px-3 py-2.5">
              <p className="text-[11px] text-memphis-black/60">Plan monthly API limit</p>
              <p className="text-lg font-black">{planLimit === null ? "Unlimited" : `${planLimit} calls`}</p>
            </div>
            <div className="bg-memphis-offwhite border-3 border-memphis-black px-3 py-2.5">
              <p className="text-[11px] text-memphis-black/60">Active keys</p>
              <p className="text-lg font-black">{keys.length}</p>
            </div>
            <div className="bg-memphis-offwhite border-3 border-memphis-black px-3 py-2.5">
              <p className="text-[11px] text-memphis-black/60">Billing period</p>
              <p className="text-lg font-black">{keys[0]?.monthKey ?? "—"}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-2 border-3 border-red-400/80 bg-red-50 text-red-700 text-xs flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
              {error}
            </div>
          )}

          <form onSubmit={handleCreate} className="mb-5 border-3 border-memphis-black bg-memphis-offwhite p-3.5">
            <div className="flex items-center gap-2 mb-2.5">
              <KeyRound className="w-4 h-4" />
              <h3 className="text-xs font-black uppercase tracking-wide">Create API key</h3>
            </div>

            <p className="text-[11px] text-memphis-black/60 mb-2">
              Choose a short name. This secret is shown only once.
            </p>
            <div className="flex gap-2 flex-col sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dashboard key"
                className="flex-1 border-3 border-memphis-black px-2 py-2 text-xs outline-none bg-white"
                maxLength={60}
                disabled={isCreating}
              />
              <Button
                type="submit"
                disabled={isCreating}
                className="min-h-10 px-4 text-xs font-bold gap-1"
              >
                {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5" /> Create</>}
              </Button>
            </div>

            {createError && <p className="text-[11px] text-red-600 mt-2">{createError}</p>}
          </form>

          {createdSecret && (
            <div className="mb-5 border-3 border-memphis-black bg-emerald-50 p-3">
              <div className="flex items-start gap-2 mb-2">
                <Sparkles className="w-4 h-4 mt-0.5" />
                <p className="text-xs font-black uppercase tracking-wide">Copy once</p>
              </div>
              <p className="text-[11px] text-emerald-800 mb-2">This is your only chance to view this key. Save it now.</p>
              <div className="flex gap-2">
                <code className="flex-1 px-2 py-1.5 border border-emerald-300 bg-white text-xs break-all">{createdSecret}</code>
                <Button size="sm" onClick={handleCopySecret} className="gap-1">
                  <Copy className="w-3.5 h-3.5" />
                  {copySuccess ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-black uppercase tracking-wide mb-2">API keys</h3>

            {loading ? (
              <div className="text-center py-6 text-memphis-black/50">Loading keys…</div>
            ) : !keys.length ? (
              <div className="text-xs text-memphis-black/60 border-2 border-dashed border-memphis-black/30 p-3">No keys yet. Create one above.</div>
            ) : (
              <div className="border-3 border-memphis-black">
                {keys.map((keyRow) => {
                  const usageLimit = keyRow.rateLimit === null ? "∞" : keyRow.rateLimit;
                  const usageLeft = keyRow.callsRemaining === null ? "∞" : keyRow.callsRemaining;
                  const usageText = `${keyRow.callsThisMonth}/${usageLimit} calls this month`;
                  const remainingText = `${usageLeft} remaining`;
                  const preview = `${keyRow.keyPreview} · last 4: ${keyRow.keyPreview.slice(-4)}`;

                  return (
                    <div key={keyRow.id} className="border-t border-memphis-black p-3 text-xs first:border-t-0">
                      <div className="flex gap-2 items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-black mb-0.5">{keyRow.name}</div>
                          <div className="text-[11px] text-memphis-black/70 mb-1.5">{preview}</div>
                          <div className="text-[11px] text-memphis-black/70">
                            <span className="mr-3">{usageText}</span>
                            <span className="mr-3">{remainingText}</span>
                            <span>Last used {formatDateTime(keyRow.lastUsedAt)}</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0 border border-red-500 text-red-700 bg-white hover:bg-red-50"
                          onClick={() => handleDelete(keyRow.id)}
                          disabled={deletingKeyId === keyRow.id}
                        >
                          {deletingKeyId === keyRow.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-[10px] text-memphis-black/50 mt-4">
            Requests are authenticated via <code>Authorization: Bearer &lt;key&gt;</code> and support <strong>json</strong> (default) and <strong>csv</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
