// Peer comparison UI to benchmark a country against peers.

import { useEffect, useId, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { Card } from ".";
import { getPeerComparison } from "../../utils/api";
import type {
  PeerComparisonResponse,
  PeerGroupType,
  PeerMetricKey,
} from "../../types";
import { PEER_GROUP_OPTIONS, PEER_METRIC_OPTIONS } from "../../data/peerGroups";

interface PeerComparisonProps {
  token: string;
  countryCode: string | null;
}

export function PeerComparison({ token, countryCode }: PeerComparisonProps) {
  const [groupType, setGroupType] = useState<PeerGroupType>("region");
  const [metric, setMetric] = useState<PeerMetricKey>("gdp");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PeerComparisonResponse | null>(null);
  const baseId = useId();
  const groupId = `${baseId}-group`;
  const metricId = `${baseId}-metric`;

  useEffect(() => {
    if (!countryCode) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPeerComparison(token, countryCode, { groupType, metric })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : "Failed to load peer comparison",
        );
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [countryCode, groupType, metric, token]);

  const peers = data?.peers ?? [];
  const target = useMemo(
    () => peers.find((peer) => peer.isTarget) ?? null,
    [peers],
  );

  function formatMetric(value: number, unit: string) {
    if (!Number.isFinite(value)) return "—";
    const withDecimals = value % 1 === 0 ? 0 : 2;

    if (unit === "%") {
      return `${value.toFixed(2)}%`;
    }

    if (unit === "USD") {
      if (Math.abs(value) >= 1_000_000_000) {
        return `${(value / 1_000_000_000).toFixed(2)}bn`;
      }
      if (Math.abs(value) >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}m`;
      }
    }

    const formatted = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: withDecimals,
    }).format(value);
    return `${formatted}${unit ? ` ${unit}` : ""}`;
  }

  function topStatement() {
    if (!data || !target) return null;
    const top = Math.max(
      0,
      Math.min(100, (target.rank / data.summary.peerCount) * 100),
    );
    const topText = `${top.toFixed(0)}%`;
    const medianText =
      data.summary.median == null
        ? "—"
        : formatMetric(data.summary.median, data.summary.metricUnit);
    const avgText =
      data.summary.average == null
        ? "—"
        : formatMetric(data.summary.average, data.summary.metricUnit);

    return [
      `${target.name}: rank ${target.rank} of ${data.summary.peerCount} in`,
      `${data.summary.groupName}, top ${topText}.`,
      `Median for group: ${medianText} · Average: ${avgText}`,
    ].join(" ");
  }

  const rankedPeers = useMemo(
    () => [...peers].sort((a, b) => a.rank - b.rank),
    [peers],
  );

  const chartData = rankedPeers.map((peer) => ({
    name: `${peer.flag} ${peer.code}`,
    rank: peer.rank,
    value: peer.value,
    color: peer.isTarget ? "#FF006E" : "#00AAFF",
  }));

  return (
    <Card title="Peer Benchmarking">
      <div className="grid gap-2 md:grid-cols-2 mb-4">
        <label
          htmlFor={groupId}
          className="text-[12px] text-slate-700 font-semibold flex items-center gap-2"
        >
          Group
          <select
            id={groupId}
            value={groupType}
            onChange={(event) =>
              setGroupType(event.target.value as PeerGroupType)
            }
            className={cn(
              "ml-auto border border-slate-300 px-2 py-1.5",
              "text-xs text-slate-900 bg-white rounded",
            )}
          >
            {PEER_GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label
          htmlFor={metricId}
          className="text-[12px] text-slate-700 font-semibold flex items-center gap-2"
        >
          Metric
          <select
            id={metricId}
            value={metric}
            onChange={(event) => setMetric(event.target.value as PeerMetricKey)}
            className={cn(
              "ml-auto border border-slate-300 px-2 py-1.5",
              "text-xs text-slate-900 bg-white rounded",
            )}
          >
            {PEER_METRIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="text-sm text-slate-600">Loading peer ranking…</div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && !error && !data && (
        <div className="text-sm text-slate-600">
          Select a country to view peer comparison.
        </div>
      )}

      {data && (
        <>
          <div className="text-xs text-slate-700 whitespace-pre-wrap mb-4">
            {topStatement()}
          </div>
          {data.summary.isCapped && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-4">
              Showing {data.summary.peerCount} of {data.summary.totalPeerCount} peers for your plan
              {data.summary.planLimit ? ` (limit ${data.summary.planLimit})` : ""}.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h4 className="text-[11px] text-slate-600 uppercase tracking-[0.6px] mb-2">
                {data.summary.metricLabel} (Year {data.summary.year})
              </h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={chartData}
                  margin={{ top: 6, right: 10, left: 0, bottom: 5 }}
                >
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="name" interval={0} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value: number) => [
                      formatMetric(value, data.summary.metricUnit),
                      data.summary.metric,
                    ]}
                  />
                  <Bar dataKey="value">
                    {chartData.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h4 className="text-[11px] text-slate-600 uppercase tracking-[0.6px] mb-2">
                Peers ({data.peers.length})
              </h4>
              <div className="overflow-x-auto border border-slate-200 rounded">
                <table className="w-full text-xs min-w-[400px]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="text-left px-2 py-2 font-semibold">#</th>
                      <th className="text-left px-2 py-2 font-semibold">
                        Country
                      </th>
                      <th className="text-right px-2 py-2 font-semibold">
                        Value
                      </th>
                      <th className="text-right px-2 py-2 font-semibold">
                        Percentile
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedPeers.map((row) => (
                      <tr
                        key={row.code}
                        className={row.isTarget ? "bg-pink-100/40" : ""}
                      >
                        <td className="px-2 py-1">{row.rank}</td>
                        <td
                          className="px-2 py-1 truncate max-w-[150px]"
                          title={`${row.flag} ${row.name}`}
                        >
                          {row.flag} {row.name}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {formatMetric(row.value, data.summary.metricUnit)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {row.percentile.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
