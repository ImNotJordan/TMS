import { useCallback, useEffect, useRef, useState } from "react";

import "./route-loader.css";
import { t } from "@/lib/i18n/t";

/* ═══════════════════════════════════════════════════════════════════════════
   RouteLoader
   A dispatch lane that draws itself. Three stop nodes light as the comet
   passes them. Indeterminate but seamless — no fake percentage, and the only
   number on screen is real elapsed time.

   Colors come from the repo's semantic tokens (--foreground, --muted-foreground,
   --primary, --border, --background). SVG paint needs resolved values rather
   than utility classes, so the wrapper publishes --rl-ink / --rl-accent and the
   shapes reference those. Stalled drains both to --muted-foreground; nothing
   here ever turns red, because a session check that timed out is not the user's
   error.
   ═══════════════════════════════════════════════════════════════════════════ */

/** One full pass of the lane, in ms. Mirrored into CSS as --rl-cycle. */
const CYCLE = 2000;

const PATH = "M 18 50 C 74 50 96 20 132 20 C 168 20 182 14 206 14";

/**
 * `delay` is a fraction of CYCLE, tuned so each node flares as the comet
 * reaches it. Retune these if PATH changes or the effect desynchronizes.
 */
const NODES = [
  { cx: 18, cy: 50, delay: 0.02 },
  { cx: 132, cy: 20, delay: 0.46 },
  { cx: 206, cy: 14, delay: 0.92 },
] as const;

/** CSS custom properties are not part of csstype's Properties map. */
type CSSVars = React.CSSProperties & Record<`--${string}`, string>;

function Lane({ stalled }: { stalled: boolean }) {
  return (
    <svg
      width="224"
      height="64"
      viewBox="0 0 224 64"
      aria-hidden="true"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id="rl-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "var(--rl-accent)" }} stopOpacity="0" />
          <stop offset="55%" style={{ stopColor: "var(--rl-accent)" }} stopOpacity=".9" />
          <stop offset="100%" style={{ stopColor: "var(--rl-accent)" }} stopOpacity="1" />
        </linearGradient>
        <filter id="rl-glow" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* pavement */}
      <path
        d={PATH}
        pathLength="100"
        fill="none"
        style={{ stroke: "var(--color-border)" }}
        strokeWidth="2"
        strokeLinecap="round"
      />

      {!stalled && (
        <>
          {/* glow underlay */}
          <path
            className="rl-comet"
            d={PATH}
            pathLength="100"
            fill="none"
            style={{ stroke: "var(--rl-accent)" }}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="16 84"
            filter="url(#rl-glow)"
            opacity=".35"
          />
          {/* comet */}
          <path
            className="rl-comet"
            d={PATH}
            pathLength="100"
            fill="none"
            stroke="url(#rl-grad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="16 84"
          />
        </>
      )}

      {NODES.map((n, i) => {
        const isDestination = i === NODES.length - 1;
        const delayStyle = { animationDelay: `${n.delay * CYCLE}ms` };

        return (
          <g key={n.cx}>
            {!stalled && (
              <circle
                className="rl-halo"
                cx={n.cx}
                cy={n.cy}
                fill="none"
                strokeWidth="1.25"
                style={{ ...delayStyle, stroke: "var(--rl-accent)" }}
              />
            )}
            {isDestination ? (
              <circle
                className={stalled ? undefined : "rl-node"}
                cx={n.cx}
                cy={n.cy}
                r="4.5"
                strokeWidth="1.75"
                style={{
                  ...delayStyle,
                  fill: "var(--color-background)",
                  stroke: "var(--rl-ink)",
                }}
              />
            ) : (
              <circle
                className={stalled ? undefined : "rl-node"}
                cx={n.cx}
                cy={n.cy}
                r={i === 0 ? 4 : 3}
                style={{
                  ...delayStyle,
                  fill: i === 0 ? "var(--rl-ink)" : "var(--rl-accent)",
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export type RouteLoaderProps = {
  eyebrow?: string;
  message: string;
  detail?: string;
  elapsed?: number | null;
  stalled?: boolean;
  onRetry?: () => void;
  onSignIn?: () => void;
  /**
   * The gate mounts as a direct child of <body> (see `src/routes/__root.tsx`),
   * so it owns the viewport and defaults to `min-h-dvh`. Pass `min-h-full` if
   * it is ever nested inside a shell that sizes it.
   */
  className?: string;
};

export function RouteLoader({
  eyebrow = "Dispatch",
  message,
  detail,
  elapsed,
  stalled = false,
  onRetry,
  onSignIn,
  className = "min-h-dvh",
}: RouteLoaderProps) {
  const vars: CSSVars = {
    "--rl-cycle": `${CYCLE}ms`,
    "--rl-ink": stalled ? "var(--color-muted-foreground)" : "var(--color-foreground)",
    "--rl-accent": stalled ? "var(--color-muted-foreground)" : "var(--color-primary)",
  };

  return (
    <div
      role="status"
      aria-busy={!stalled}
      aria-live="polite"
      style={vars}
      className={`relative grid place-items-center overflow-hidden bg-background px-6 ${className}`}
    >
      {/* Grid field, faded to the center.
          Hazard: Safari can drop masks on composited layers inside a transformed
          overflow:hidden parent. If this ever renders as a hard-edged square,
          move it to a ::before on the outer element. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--color-foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--color-foreground) 5%, transparent) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(circle at 50% 46%, #000 0%, transparent 62%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 46%, #000 0%, transparent 62%)",
        }}
      />
      {!stalled && (
        <div
          aria-hidden="true"
          className="rl-scan pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-8 bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        />
      )}

      <div className="rl-rise relative flex flex-col items-center">
        <p className="mb-6 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </p>

        <Lane stalled={stalled} />

        <p className="mt-6 text-[15px] font-medium tracking-tight text-foreground">{message}</p>

        <div className="mt-1.5 flex h-4 items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {detail && <span>{detail}</span>}
          {/* The elapsed readout updates ten times a second. It sits inside the
              aria-live subtree, so it is hidden from assistive tech — otherwise
              the region re-announces on every tick instead of once per phase. */}
          {detail && elapsed != null && (
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
          )}
          {elapsed != null && (
            <span aria-hidden="true" className="tabular-nums">
              {elapsed.toFixed(1)}s
            </span>
          )}
        </div>

        {stalled && (
          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition-all hover:border-muted-foreground/40 hover:shadow active:scale-[.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t("Try again")}
            </button>
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t("Sign in manually")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AuthGate — staging. Nothing under 200ms. Elapsed time only once it's slow.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `resolving` is the only status that renders anything. `authed` and `anon` both
 * fall through to `children` untouched — swallowing `anon` would mean the app
 * never reaches the login route.
 */
export type AuthGateStatus = "resolving" | "authed" | "anon";

type Phase = {
  /** ms since resolution began. */
  at: number;
  message: string;
  detail?: string;
  stalled?: boolean;
  showElapsed?: boolean;
};

const PHASES: readonly Phase[] = [
  { at: 200, message: "Checking your session" },
  { at: 1500, message: "Taking longer than usual", detail: "Still connecting", showElapsed: true },
  {
    at: 8000,
    message: "Can't reach the server",
    detail: "Connection timed out",
    stalled: true,
    showElapsed: true,
  },
];

/** The phase index at which the elapsed ticker needs to start running. */
const FIRST_ELAPSED_PHASE = PHASES.findIndex((p) => p.showElapsed);

export type AuthGateProps = {
  status: AuthGateStatus;
  children?: React.ReactNode;
  /**
   * Overrides only the first phase's message. Use it where the thing being
   * resolved is specific and nameable ("Checking your workspace"); leave it
   * unset otherwise. Never describe work the code is not doing.
   */
  message?: string;
  /** Re-runs the real auth check. Must not merely reset the timer. */
  onRetry?: () => void;
  /** Navigates to the login route. */
  onSignIn?: () => void;
  className?: string;
};

export function AuthGate({
  status,
  children,
  message,
  onRetry,
  onSignIn,
  className,
}: AuthGateProps) {
  const [phase, setPhase] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  // Bumped by "Try again" so the staging clock restarts alongside the real
  // auth call. Without it a retry would fire the request but leave the UI
  // stuck on the stalled screen forever.
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status !== "resolving") {
      setPhase(-1);
      return;
    }

    startedAt.current = performance.now();
    setPhase(-1);
    setElapsed(0);

    const tick = () => setElapsed((performance.now() - startedAt.current) / 1000);

    // `tick()` runs in the same task as the phase change that first reveals the
    // readout, so React batches them. Leaving it to the interval below would
    // paint one frame of "0.0s" before the first real value lands.
    const timers = PHASES.map((p, i) =>
      window.setTimeout(() => {
        setPhase(i);
        if (p.showElapsed) tick();
      }, p.at),
    );

    // Started late on purpose: before the readout is visible, a 10Hz setState
    // is a re-render per 100ms that nothing on screen reflects.
    let ticker: number | undefined;
    const tickerStart = window.setTimeout(() => {
      ticker = window.setInterval(tick, 100);
    }, PHASES[FIRST_ELAPSED_PHASE].at);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(tickerStart);
      if (ticker !== undefined) window.clearInterval(ticker);
    };
  }, [status, attempt]);

  const handleRetry = useCallback(() => {
    setAttempt((n) => n + 1);
    onRetry?.();
  }, [onRetry]);

  const handleSignIn = useCallback(() => {
    // Navigating to the login route is what clears the resolving state: /login
    // is a public route, so the gate stops rendering once it lands.
    setAttempt((n) => n + 1);
    onSignIn?.();
  }, [onSignIn]);

  if (status !== "resolving") return children ?? null;
  // Under 200ms nothing is drawn at all. Local-persistence sessions usually
  // resolve inside that window, and drawing anything there is what creates the
  // flash the loader exists to avoid.
  if (phase < 0) return null;

  const p = PHASES[phase];

  return (
    <RouteLoader
      message={phase === 0 && message ? message : p.message}
      detail={p.detail}
      elapsed={p.showElapsed ? elapsed : null}
      stalled={!!p.stalled}
      onRetry={handleRetry}
      onSignIn={handleSignIn}
      className={className}
    />
  );
}
