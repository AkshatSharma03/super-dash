import { useState } from "react";
import { createSessionShare } from "../../utils/api";
import { Button } from "@/components/ui/button";
import { Share2, Copy, Check, Link2 } from "lucide-react";

interface Props {
  token: string;
  sessionId: string;
}

export default function ShareButton({ token, sessionId }: Props) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShare = async () => {
    if (shareUrl) {
      setShareUrl(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await createSessionShare(token, sessionId);
      setShareUrl(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create share link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleShare}
        disabled={loading}
        className="text-xs gap-1.5"
      >
        {loading ? (
          <span
            className={[
              "w-3 h-3 border-2 border-current border-t-transparent rounded-full",
              "animate-spin",
            ].join(" ")}
          />
        ) : shareUrl ? (
          <Link2 className="w-3.5 h-3.5" />
        ) : (
          <Share2 className="w-3.5 h-3.5" />
        )}
        {shareUrl ? "Shared" : "Share"}
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
            onClick={handleCopy}
            className="text-memphis-black hover:text-memphis-pink transition-colors shrink-0"
            title="Copy link"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
