import { useState } from "react";
import {
  createSnapshot,
  regenerateSnapshot,
  type SnapshotCreatePayload,
} from "../../utils/api";
import { Button } from "@/components/ui/button";
import { Copy, Check, Link2, RefreshCw, Save, Loader2 } from "lucide-react";
import type { SnapshotFull } from "../../types";

interface SnapshotButtonProps {
  token: string;
  countryCode: string;
  payload: SnapshotFull["dataPayload"];
  isGuest?: boolean;
  existingSnapshotId?: string;
  isPublic?: boolean;
  defaultTitle?: string;
  onSuccess: (snapshot: SnapshotFull) => void;
}

export default function SnapshotButton({
  token,
  countryCode,
  payload,
  isGuest = false,
  existingSnapshotId,
  isPublic = true,
  defaultTitle = `Snapshot ${countryCode}`,
  onSuccess,
}: SnapshotButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotFull | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = snapshot?.shareToken
    ? `${window.location.origin}/api/snapshot/${snapshot.shareToken}`
    : null;

  const ensurePayload = () => {
    if (existingSnapshotId) return;
    if (!payload || typeof payload !== "object") {
      throw new Error("No snapshot payload available for this dataset");
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleClick = async () => {
    if (isGuest) {
      setError("Guests cannot save snapshots");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      ensurePayload();

      if (existingSnapshotId) {
        const result = await regenerateSnapshot(token, existingSnapshotId);
        setSnapshot(result.snapshot);
        onSuccess(result.snapshot);
        return;
      }

      const request: SnapshotCreatePayload = {
        countryCode,
        title: defaultTitle,
        isPublic,
        dataPayload: payload as Record<string, unknown>,
      };

      const created = await createSnapshot(token, request);
      setSnapshot(created);
      onSuccess(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create snapshot");
    } finally {
      setLoading(false);
    }
  };

  const label = existingSnapshotId ? "Regenerate" : "Create Snapshot";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={loading || isGuest}
        className="text-xs gap-1.5"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : existingSnapshotId ? (
          <RefreshCw className="w-3.5 h-3.5" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        {label}
      </Button>

      {shareUrl && (
        <div
          className={[
            "flex items-center gap-1.5 bg-white border-3 border-memphis-black",
            "px-2 py-1 shadow-hard-sm max-w-[280px]",
          ].join(" ")}
        >
          <span className="text-[10px] text-memphis-black/70 truncate flex-1">
            {shareUrl}
          </span>
          <button
            onClick={copyLink}
            className="text-memphis-black hover:text-memphis-pink transition-colors shrink-0"
            title="Copy snapshot link"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {isGuest && (
        <span className="text-[10px] text-amber-600">
          Sign in to save snapshots
        </span>
      )}

      {error && <span className="text-[10px] text-red-600">{error}</span>}

      {!shareUrl && !loading && !existingSnapshotId && !isGuest && (
        <span className="text-[10px] text-slate-500">
          Snapshot saved privately
        </span>
      )}

      {existingSnapshotId && snapshot && !snapshot.isPublic && (
        <span className="text-[10px] text-slate-500">
          This snapshot is private
        </span>
      )}

      {snapshot && (
        <span className="text-[10px] text-slate-500">
          v{snapshot.dataVersion}
        </span>
      )}

      {snapshot?.shareToken ? (
        <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
          <Link2 className="w-3 h-3" /> Shareable
        </span>
      ) : null}
    </div>
  );
}
