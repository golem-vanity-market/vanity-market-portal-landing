import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { displayDifficulty, displayHours } from "../utils";

// Shapes mirror provider-ban-server src/shared/types.ts (PortalProviderReport).
interface ActiveBanInfo {
  id: number;
  source: string;
  reason: string | null;
  bannedAt: string;
  expiresAt: string;
}

interface PortalHint {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  data?: Record<string, unknown>;
}

interface PortalProviderReport {
  providerId: string;
  name: string | null;
  score: number;
  category: string;
  statsGolemUrl: string;
  status: {
    banned: boolean;
    activeBan: ActiveBanInfo | null;
    bansLast24h: number;
    nextBanHours: number;
    lastBanAt: string | null;
    lastBanReason: string | null;
    activeAgreements: number;
    lastSeen: string | null;
  };
  targets: {
    efficiencyTarget: number;
    speedTarget: number;
    relaxed: boolean;
  };
  performance: {
    window: "d1" | "d7" | "d30" | "all";
    agreements: number;
    workHashes: number;
    costGlm: number;
    hours: number;
    efficiencyThPerGlm: number | null;
    avgSpeedHps: number | null;
    avgCostPerHourGlm: number | null;
    bans: number;
  };
  pricing: {
    priceCpuHour: number | null;
    priceEnvHour: number | null;
    priceStart: number | null;
    monthlyPriceGlm: number | null;
    fetchedAt: string;
  } | null;
  hints: PortalHint[];
  timestamp: string;
}

const PORTAL_API_BASE =
  import.meta.env.VITE_BAN_SERVER_PORTAL_URL ??
  "https://stone.vanity.market/nmpdmxzhrm/ban-server/api/v1/portal";

const WINDOW_LABEL: Record<string, string> = {
  d1: "last 24 hours",
  d7: "last 7 days",
  d30: "last 30 days",
  all: "all time",
};

const CATEGORY_STYLE: Record<string, string> = {
  trusted:
    "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  reliable:
    "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  average: "border-sky-500/50 text-sky-600 dark:text-sky-400 bg-sky-500/10",
  new: "border-sky-500/50 text-sky-600 dark:text-sky-400 bg-sky-500/10",
  underperformer:
    "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
  risky: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
  banned: "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
};

const relativeTime = (iso: string | null): string => {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return "unknown";
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

const untilTime = (iso: string): string => {
  const ms = Date.parse(iso) - Date.now();
  if (isNaN(ms) || ms <= 0) return "expiring now";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

const fmtGlm = (x: number | null, digits = 4): string =>
  x === null ? "—" : `${x.toFixed(digits)}`;

const StatTile = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) => (
  <div className="rounded-lg border bg-card p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    {sub ? (
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    ) : null}
  </div>
);

/**
 * Measured value vs the enforced target. The track spans 0–2x target with a
 * tick at 1x; the fill is clamped, the label always carries the exact numbers
 * so color is never the only signal.
 */
const TargetMeter = ({
  label,
  value,
  target,
  format,
  unit,
}: {
  label: string;
  value: number | null;
  target: number;
  format: (x: number) => string;
  unit: string;
}) => {
  const ratio = value !== null && target > 0 ? value / target : null;
  const meets = ratio !== null && ratio >= 1;
  const fillPct = ratio === null ? 0 : Math.min(ratio / 2, 1) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {value === null ? "no data" : `${format(value)} ${unit}`} · target{" "}
          {format(target)} {unit}
        </span>
      </div>
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${
            meets
              ? "bg-emerald-500"
              : ratio !== null && ratio >= 0.8
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
          style={{ width: `${fillPct}%` }}
        />
        <div className="absolute top-0 left-1/2 h-full w-0.5 bg-foreground/40" />
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {ratio === null ? (
          <span>no measurement in this window</span>
        ) : meets ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>{ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}x the enforced target</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>
              {(ratio * 100).toFixed(0)}% of the enforced target — agreements
              get terminated below 100%
            </span>
          </>
        )}
      </div>
    </div>
  );
};

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is this page?",
    a: "It is your provider's standing with the Vanity Market requestor fleet — a set of Golem requestors that rent CPU time from providers like yours to search for vanity blockchain addresses. Everything here is measured from the fleet's own agreements with your node.",
  },
  {
    q: "I got banned — should I worry?",
    a: (
      <>
        <strong>No.</strong> Bans here are temporary and expire automatically —
        the first ban in a day lasts 1 hour, and only repeated bans within the
        same 24 hours escalate (2 h, 3 h, … capped at 24 h). A clean 24 hours
        fully resets the escalation, and the fleet also periodically lifts all
        bans. A ban only pauses work with this fleet; it does not affect your
        standing anywhere else on the Golem network, and your node is picked up
        again as soon as it expires.
      </>
    ),
  },
  {
    q: "Why was I banned?",
    a: "An agreement is terminated (and the provider temporarily banned) when its measured efficiency (TH/GLM) or speed (H/s) stays below the enforced target for 3 consecutive checks. The exact reason of your last ban — measured value, target, and measurement window — is shown in the Performance section above.",
  },
  {
    q: "How do I meet the efficiency target?",
    a: "Efficiency is hashes delivered per GLM billed, so there are two levers: price and speed. In practice price is the easier one — lowering your per-thread CPU price directly raises efficiency at unchanged speed. When you are below target, the hint at the top of the page computes the price cut that would get you there.",
  },
  {
    q: "What does “relaxed targets” mean?",
    a: "Providers that deliver sustained work (≥100 GH in 24 h) at ≥2× the global efficiency target automatically earn a relaxed target (half the global one), and keep it while they qualify. Well-performing providers therefore get extra headroom instead of tighter scrutiny.",
  },
  {
    q: "Why do I see many very short agreements?",
    a: "The fleet's requestors fully restart every 6 hours (staggered). Around each restart window a provider is often picked up briefly by a requestor that is itself about to restart, producing a few minutes-long agreements with almost no work besides the one long agreement. This is normal churn on the requestor side, not a fault of your node, and it does not hurt your standing.",
  },
  {
    q: "When do I get paid?",
    a: "The fleet settles invoices in batches roughly every 6 hours, paying in GLM on Polygon. If an agreement just ended, its payment can therefore take a few hours to show up on-chain.",
  },
  {
    q: "What is the score?",
    a: "A 0–100 blend of efficiency vs target, agreements completed without bans, work volume, ban recency, and data freshness. It drives the category label (trusted, reliable, average, underperformer, new, risky, banned) and recovers on its own as you deliver clean work.",
  },
  {
    q: "How fresh is this data?",
    a: "The fleet's monitoring collects agreement data every 30 seconds and this page refreshes itself every minute. The price list is scraped from stats.golem.network a few times per day, so recent price changes can take a while to appear here.",
  },
];

const HintAlert = ({ hint }: { hint: PortalHint }) => {
  const icon =
    hint.severity === "critical" ? (
      <XCircle className="h-4 w-4" />
    ) : hint.severity === "warning" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      <Info className="h-4 w-4" />
    );
  const title =
    hint.severity === "critical"
      ? "Action required"
      : hint.severity === "warning"
        ? "Warning"
        : "Info";
  return (
    <Alert
      variant={hint.severity === "critical" ? "destructive" : "default"}
      className={
        hint.severity === "warning"
          ? "border-amber-500/50 [&>svg]:text-amber-500"
          : undefined
      }
    >
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{hint.message}</AlertDescription>
    </Alert>
  );
};

const ProviderInfoPage = () => {
  const { providerId } = useParams<{ providerId: string }>();
  const [report, setReport] = useState<PortalProviderReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasCopied, setHasCopied] = useState(false);

  const validId = !!providerId && /^0x[0-9a-fA-F]{40}$/.test(providerId);

  const load = useCallback(async () => {
    if (!validId) return;
    try {
      const resp = await fetch(
        `${PORTAL_API_BASE}/providers/${providerId!.toLowerCase()}`,
      );
      if (resp.status === 404) {
        setError(
          "This provider has no recorded activity on the Vanity Market fleet.",
        );
        setReport(null);
        return;
      }
      if (!resp.ok) throw new Error(`API responded with ${resp.status}`);
      setReport((await resp.json()) as PortalProviderReport);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [providerId, validId]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const copyId = () => {
    if (!providerId) return;
    navigator.clipboard.writeText(providerId);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  if (!validId) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-10">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Invalid provider id</AlertTitle>
          <AlertDescription>
            Expected an address like 0x3e2f…a1de (0x followed by 40 hex
            characters).
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="container mx-auto max-w-4xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="container mx-auto max-w-4xl space-y-4 px-4 py-10">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>No data for this provider</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  if (!report) return null;

  const { status, targets, performance: perf, pricing } = report;
  const windowLabel = WINDOW_LABEL[perf.window] ?? perf.window;

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">
              {report.name ?? "Unnamed provider"}
            </h1>
            <Badge
              variant="outline"
              className={CATEGORY_STYLE[report.category] ?? ""}
            >
              {report.category}
            </Badge>
            {targets.relaxed ? (
              <Badge
                variant="outline"
                className="border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                relaxed targets
              </Badge>
            ) : null}
          </div>
          <button
            onClick={copyId}
            className="mt-1 flex items-center gap-1.5 font-mono text-sm text-muted-foreground hover:text-foreground"
            title="Copy provider id"
          >
            {report.providerId}
            {hasCopied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <a
          href={report.statsGolemUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          stats.golem.network <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Hints */}
      <div className="space-y-3">
        {report.hints.map((h, i) => (
          <HintAlert key={`${h.id}-${i}`} hint={h} />
        ))}
        {status.banned || status.bansLast24h > 0 ? (
          <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Bans are temporary and nothing to worry about — they expire
              automatically, a clean 24 h resets the escalation, and they only
              pause work with this fleet. See the FAQ below.
            </span>
          </p>
        ) : null}
      </div>

      {/* Status tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Status"
          value={
            status.banned ? (
              <span className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <Ban className="h-5 w-5" /> Banned
              </span>
            ) : (
              <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> OK
              </span>
            )
          }
          sub={
            status.banned && status.activeBan
              ? `expires in ${untilTime(status.activeBan.expiresAt)}`
              : `last seen ${relativeTime(status.lastSeen)}`
          }
        />
        <StatTile
          label="Score"
          value={`${report.score.toFixed(1)}`}
          sub="out of 100"
        />
        <StatTile
          label="Active agreements"
          value={status.activeAgreements}
          sub="with the fleet right now"
        />
        <StatTile
          label="Bans (24h)"
          value={status.bansLast24h}
          sub={
            status.bansLast24h > 0
              ? `next ban would last ${status.nextBanHours} h`
              : "clean — no escalation"
          }
        />
      </div>

      {/* Enforced targets */}
      <Card>
        <CardHeader>
          <CardTitle>Enforced targets</CardTitle>
          <CardDescription>
            Measured over the {windowLabel}. Agreements running below either
            target are terminated and the provider is temporarily banned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TargetMeter
            label="Efficiency"
            value={perf.efficiencyThPerGlm}
            target={targets.efficiencyTarget}
            format={(x) => x.toPrecision(3)}
            unit="TH/GLM"
          />
          <TargetMeter
            label="Average speed"
            value={perf.avgSpeedHps}
            target={targets.speedTarget}
            format={(x) =>
              x >= 1e6
                ? `${(x / 1e6).toFixed(2)}M`
                : x >= 1e3
                  ? `${(x / 1e3).toFixed(0)}k`
                  : x.toFixed(0)
            }
            unit="H/s"
          />
        </CardContent>
      </Card>

      {/* Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Performance ({windowLabel})</CardTitle>
          <CardDescription>
            Work delivered to the Vanity Market requestor fleet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatTile label="Agreements" value={perf.agreements} />
            <StatTile
              label="Compute time"
              value={displayHours(perf.hours)}
              sub="billed agreement hours"
            />
            <StatTile
              label="Work delivered"
              value={displayDifficulty(perf.workHashes)}
              sub="hashes computed"
            />
            <StatTile
              label="Billed"
              value={fmtGlm(perf.costGlm, 3)}
              sub="GLM"
            />
            <StatTile
              label="Avg cost"
              value={fmtGlm(perf.avgCostPerHourGlm)}
              sub="GLM per hour"
            />
            <StatTile
              label="Bans in window"
              value={perf.bans}
              sub={
                status.lastBanAt
                  ? `last ban ${relativeTime(status.lastBanAt)}`
                  : "never banned"
              }
            />
          </div>
          {status.lastBanReason ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Last ban reason: {status.lastBanReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Pricing */}
      {pricing ? (
        <Card>
          <CardHeader>
            <CardTitle>Price list</CardTitle>
            <CardDescription>
              As advertised on the Golem network (fetched{" "}
              {relativeTime(pricing.fetchedAt)}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile
                label="CPU thread / h"
                value={fmtGlm(pricing.priceCpuHour)}
                sub="GLM"
              />
              <StatTile
                label="Env / h"
                value={fmtGlm(pricing.priceEnvHour)}
                sub="GLM"
              />
              <StatTile
                label="Start"
                value={fmtGlm(pricing.priceStart, 2)}
                sub="GLM"
              />
              <StatTile
                label="Monthly quote"
                value={fmtGlm(pricing.monthlyPriceGlm, 1)}
                sub="GLM, full load"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
          <CardDescription>
            How the Vanity Market fleet measures, bans, and pays providers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple">
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Data from the Vanity Market fleet · updated{" "}
          {relativeTime(report.timestamp)} · refreshes automatically
        </span>
        <Button variant="ghost" size="sm" onClick={() => load()}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
    </div>
  );
};

export default ProviderInfoPage;
