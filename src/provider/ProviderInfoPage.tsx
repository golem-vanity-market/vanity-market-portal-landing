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
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  PauseCircle,
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
  banned: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
};

// The backend still speaks in "bans"; since the 2026-08 rotation scheduler
// the only bans left are rare manual suspensions, shown as a temporary pause.
const CATEGORY_LABEL: Record<string, string> = {
  banned: "paused",
};

const softenReason = (s: string): string =>
  s
    .replace(/ban-server/gi, "fleet")
    .replace(/\bbanned\b/gi, "paused")
    .replace(/\bban(s)?\b/gi, (_m, s1) => (s1 ? "cooldowns" : "cooldown"))
    .replace(
      /failed to run (the )?command/gi,
      "the node accepted a task but could not run it",
    );

const isExecutionFailure = (reason: string | null | undefined): boolean =>
  !!reason && /failed to run (the )?command/i.test(reason);

// A "failed to run command" reason whose recorded cause is requestor-side
// (DebitNote acceptance lag, or an agreement we signed but never used) —
// the node did nothing wrong.
const isRequestorInterruption = (
  reason: string | null | undefined,
): boolean =>
  !!reason &&
  (/debit\s*-?\s*note/i.test(reason) || /no activity (was )?created/i.test(reason));

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
            <span>{ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}x the target</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>
              {(ratio * 100).toFixed(0)}% of the target — nodes above target
              get longer and more frequent work sessions
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
    q: "Why does my node work in sessions that start and stop?",
    a: (
      <>
        <strong>That is how the fleet shares work — it is not a sanction.</strong>{" "}
        The fleet runs a fixed number of work slots and rotates them across
        many providers, so everyone gets a fair chance. Sessions end on a
        schedule; between sessions your node simply waits for its next turn.
        How often your node is picked, and how long it keeps a session,
        follows its measured results: efficient, reliable nodes work most of
        the time, while new nodes start with short trial sessions so the
        fleet can measure them. Nothing is held against your node, and none
        of this affects your standing anywhere else on the Golem network.
      </>
    ),
  },
  {
    q: "How do I get more work from the fleet?",
    a: "Deliver good efficiency — hashes computed per GLM billed. That is the main thing the rotation looks at: nodes above the target get long sessions with hardly any gaps, nodes below it get shorter and less frequent ones. Price is the quickest lever; see the next answer.",
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
    a: "Short sessions are a normal part of the rotation: new or recently quiet nodes get brief trial sessions so the fleet can measure them, and every session ends on a schedule. The fleet's requestors also fully restart every 6 hours, which adds a few extra minutes-long agreements around those windows. Neither hurts your standing.",
  },
  {
    q: "When do I get paid?",
    a: "The fleet settles invoices in batches roughly every 6 hours, paying in GLM on Polygon. If an agreement just ended, its payment can therefore take a few hours to show up on-chain. Sessions are paid in full as long as the node delivered real work for what it billed; billing with essentially no measurable work is not paid out.",
  },
  {
    q: "What is the score?",
    a: "A 0–100 blend of measured efficiency, session reliability, work volume, speed, and data freshness. It decides how often and how long your node works in the rotation, and it improves on its own as you deliver good work.",
  },
  {
    q: "How fresh is this data?",
    a: "The fleet's monitoring collects agreement data every 30 seconds and this page refreshes itself every minute. The price list is scraped from stats.golem.network a few times per day, so recent price changes can take a while to appear here.",
  },
];

const HintAlert = ({
  hint,
  status,
}: {
  hint: PortalHint;
  status: PortalProviderReport["status"];
}) => {
  // The two ban-flavored hints from the API get friendlier client-side copy;
  // everything else passes through (with any stray "ban" wording softened).
  if (hint.id === "banned") {
    const until = status.activeBan
      ? ` — it clears in ${untilTime(status.activeBan.expiresAt)}`
      : "";
    const reason = status.activeBan?.reason;
    const execFail =
      isExecutionFailure(reason) && !isRequestorInterruption(reason);
    return (
      <Alert className="border-sky-500/50 [&>svg]:text-sky-500">
        <PauseCircle className="h-4 w-4" />
        <AlertTitle>Taking a short break</AlertTitle>
        <AlertDescription>
          The fleet has paused new work for this node for a little while
          {until}.{" "}
          {execFail
            ? "This pause was caused by a task that failed to run on your machine — see the notice below."
            : "Nothing to do on your side — work resumes automatically. The tips below show how to avoid the next pause."}
        </AlertDescription>
      </Alert>
    );
  }
  if (hint.id === "execution-interrupted") {
    return (
      <Alert className="border-sky-500/50 [&>svg]:text-sky-500">
        <Info className="h-4 w-4" />
        <AlertTitle>A task was interrupted — not your node's fault</AlertTitle>
        <AlertDescription>{softenReason(hint.message)}</AlertDescription>
      </Alert>
    );
  }
  if (hint.id === "execution-failure") {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Check your node — a task failed to run</AlertTitle>
        <AlertDescription>{softenReason(hint.message)}</AlertDescription>
      </Alert>
    );
  }
  if (hint.id === "ban-escalation") {
    return (
      <Alert className="border-sky-500/50 [&>svg]:text-sky-500">
        <Info className="h-4 w-4" />
        <AlertTitle>Recent pause</AlertTitle>
        <AlertDescription>
          Work with this node was paused recently. Pauses like this are
          temporary, clear on their own, and only affect work with this
          fleet.
        </AlertDescription>
      </Alert>
    );
  }
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
      <AlertDescription>{softenReason(hint.message)}</AlertDescription>
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
              {CATEGORY_LABEL[report.category] ?? report.category}
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
          <HintAlert key={`${h.id}-${i}`} hint={h} status={status} />
        ))}
        {status.banned || status.bansLast24h > 0 ? (
          <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              A pause only affects work with this fleet and clears on its
              own. See the FAQ below.
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
              <span className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
                <PauseCircle className="h-5 w-5" /> Paused
              </span>
            ) : (
              <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> OK
              </span>
            )
          }
          sub={
            status.banned && status.activeBan
              ? `resumes in ${untilTime(status.activeBan.expiresAt)}`
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
          label="Rotation"
          value={
            status.activeAgreements > 0 ? "working now" : "between sessions"
          }
          sub="work is shared in rotating sessions"
        />
      </div>

      {/* Enforced targets */}
      <Card>
        <CardHeader>
          <CardTitle>Performance targets</CardTitle>
          <CardDescription>
            Measured over the {windowLabel}. Results above target earn longer
            and more frequent sessions in the rotation; results below mean
            shorter, rarer ones.
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
              label="Efficiency"
              value={
                perf.efficiencyThPerGlm === null
                  ? "—"
                  : perf.efficiencyThPerGlm.toPrecision(3)
              }
              sub="TH per GLM"
            />
          </div>
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
            How the Vanity Market fleet measures, matches, and pays providers.
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
