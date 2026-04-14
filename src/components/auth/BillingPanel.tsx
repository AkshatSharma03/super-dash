import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Loader2, Star, Zap, Building2 } from "lucide-react";

interface Props {
  token: string;
  onClose: () => void;
}

interface SubscriptionInfo {
  plan: string;
  status: string;
  currentPeriodEnd: number | null;
  stripeCustomerId: string | null;
}

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    icon: Star,
    color: "#94a3b8",
    features: [
      "5 countries / month",
      "Basic CSV export",
      "1 AI Chat session",
      "2 snapshots",
      "500 API calls / month",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    period: "/month",
    icon: Zap,
    color: "#FF006E",
    features: [
      "Unlimited countries",
      "All export formats (CSV, JSON, HTML, Excel)",
      "50 AI Chat sessions",
      "Custom metrics (5)",
      "50 snapshots",
      "5,000 API calls / month",
      "Email alerts",
      "Peer comparison",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$500+",
    period: "/month",
    icon: Building2,
    color: "#8338EC",
    features: [
      "Everything in Pro",
      "Team workspaces (3–10 seats)",
      "Unlimited API calls",
      "Custom peer groups + SLA",
      "Scenario analysis",
      "50 custom metrics",
      "Unlimited snapshots",
      "Dedicated support",
      "On-prem data connectors",
    ],
  },
];

export default function BillingPanel({ token, onClose }: Props) {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/subscription", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setSubscription(data);
        setLoading(false);
      })
      .catch(() => {
        setSubscription({ plan: "free", status: "active", currentPeriodEnd: null, stripeCustomerId: null });
        setLoading(false);
      });
  }, [token]);

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to create checkout session");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManage = async () => {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to open billing portal");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const currentPlan = subscription?.plan || "free";

  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border-3 border-memphis-black shadow-hard-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b-3 border-memphis-black flex items-center justify-between">
          <h2 className="text-lg font-black uppercase tracking-wide">Billing & Plans</h2>
          <button onClick={onClose} className="text-memphis-black/50 hover:text-memphis-black text-xl font-bold">×</button>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-memphis-black/40" />
          </div>
        ) : (
          <div className="p-6">
            <div className="text-center mb-6">
              <p className="text-sm text-memphis-black/60">
                You're currently on the <span className="font-bold text-memphis-black">{currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}</span> plan
                {subscription?.currentPeriodEnd && (
                  <span> · Renews {new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()}</span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PLANS.map(plan => {
                const Icon = plan.icon;
                const isCurrentPlan = currentPlan === plan.id;
                const isUpgrade = plan.id === "pro" && currentPlan === "free";
                const isDowngrade = plan.id === "free" && currentPlan !== "free";

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "border-3 p-5 flex flex-col",
                      isCurrentPlan ? "border-memphis-black bg-memphis-offwhite shadow-hard" : "border-memphis-black/20 bg-white"
                    )}
                    style={isCurrentPlan ? { borderTopColor: plan.color, borderTopWidth: 4 } : undefined}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className="w-5 h-5" style={{ color: plan.color }} />
                      <h3 className="font-black text-sm uppercase tracking-wide">{plan.name}</h3>
                      {isCurrentPlan && (
                        <span className="text-[9px] font-bold bg-memphis-black text-white px-2 py-0.5 uppercase">Current</span>
                      )}
                    </div>

                    <div className="mb-4">
                      <span className="text-2xl font-black">{plan.price}</span>
                      <span className="text-xs text-memphis-black/50">{plan.period}</span>
                    </div>

                    <ul className="space-y-1.5 mb-6 flex-1">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-memphis-black/70">
                          <Check className="w-3 h-3 shrink-0 mt-0.5" style={{ color: plan.color }} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    {plan.id === "enterprise" ? (
                      <a
                        href="mailto:sales@econchart.com?subject=Enterprise%20Plan"
                        className="w-full py-2 text-center text-xs font-black uppercase tracking-wide border-2 border-memphis-black bg-white hover:bg-memphis-black hover:text-white transition-colors"
                      >
                        Contact Sales
                      </a>
                    ) : isCurrentPlan && currentPlan === "pro" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleManage}
                        disabled={checkoutLoading}
                        className="w-full text-xs"
                      >
                        Manage Subscription
                      </Button>
                    ) : isUpgrade ? (
                      <Button
                        onClick={handleUpgrade}
                        disabled={checkoutLoading}
                        className="w-full text-xs font-bold"
                        style={{ background: plan.color }}
                      >
                        {checkoutLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Upgrade to Pro"}
                      </Button>
                    ) : (
                      <div className="w-full py-2 text-center text-xs text-memphis-black/40 font-bold uppercase">
                        {isDowngrade ? "Downgrade in portal" : "Current plan"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border-2 border-red-200 text-red-700 text-xs">
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
