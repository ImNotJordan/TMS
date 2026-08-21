import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Truck,
  Menu,
  X,
  ArrowRight,
  Check,
  Star,
  ShieldCheck,
  Activity,
  Gauge,
  Gavel,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  Package,
  MapPin,
  BarChart3,
  Building2,
  Radar,
  MessagesSquare,
  Receipt,
  Users,
  Sparkles,
  Plug,
  Lock,
  KeyRound,
  ScrollText,
  ClipboardCheck,
  CircleCheck,
  CircleDot,
  AlertTriangle,
  Clock,
  Phone,
  Mail,
  CalendarDays,
  Cpu,
  Cloud,
  Database,
  Globe2,
  Smartphone,
  CreditCard,
  Navigation,
  Route as RouteIcon,
  TrendingUp,
  Zap,
  Boxes,
  Headphones,
  Banknote,
  PackageCheck,
  Send,
  Moon,
  Sun,
  Linkedin,
  Twitter,
  Github,
  Youtube,
  Quote,
  Workflow,
  Play,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { AppLogoMark } from "@/components/app-logo-mark";
import { t } from "@/lib/i18n/t";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Logistics Software — The Operating System for Modern Freight" },
      {
        name: "description",
        content:
          "Logistics Software unifies dispatching, brokerage, tracking, RFPs, quotes, accounting, and analytics into one premium operations platform for freight teams.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  useThemeFromStorage();

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t("Skip to content")}
      </a>
      <BackgroundGlow />
      <Navbar />
      <main id="main-content" className="relative" tabIndex={-1}>
        <Hero />
        <LogosStrip />
        <Stats />
        <Features />
        <WorkflowSection />
        <TrackingPreview />
        <AnalyticsPreview />
        <Benefits />
        <Solutions />
        <Integrations />
        <Security />
        <Testimonials />
        <Pricing />
        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Theme + ambient background
 * ------------------------------------------------------------------------ */

function useThemeFromStorage() {
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("ls-theme") : null;
    if (stored === "dark") {
      document.documentElement.classList.add("dark");
    } else if (stored === "light") {
      document.documentElement.classList.remove("dark");
    }
  }, []);
}

function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-32 left-1/2 h-[360px] w-[720px] -translate-x-1/2 rounded-full bg-primary/12 blur-[80px] motion-reduce:hidden" />
      <div className="absolute top-[45%] -right-24 h-[280px] w-[480px] rounded-full bg-info/8 blur-[80px] motion-reduce:hidden" />
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Navbar
 * ------------------------------------------------------------------------ */

const NAV_LINKS = [
  { label: "Product", href: "#features" },
  { label: "Solutions", href: "#solutions" },
  { label: "Pricing", href: "#pricing" },
  { label: "Customers", href: "#testimonials" },
  { label: "Resources", href: "#faq" },
] as const;

function Navbar() {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ls-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all ${
        scrolled ? "border-b border-border/60 bg-background/80 backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <AppLogoMark className="h-9 w-9 shrink-0 rounded-xl shadow-sm shadow-primary/20" />
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight">
              {t("Logistics Software")}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("Freight OS")}
            </span>
          </div>
        </a>

        <nav className="hidden items-center gap-1 lg:flex" aria-label={t("Primary")}>
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-lg"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Link
            to="/login"
            className="hidden h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
          >
            {t("Login")}
          </Link>

          <Button
            asChild
            size="sm"
            className="hidden h-11 gap-1.5 rounded-lg bg-foreground text-background shadow-sm hover:bg-foreground/90 sm:inline-flex"
          >
            <a href="#cta">
              {t("Get started")} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-lg lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          id="landing-mobile-nav"
          className="border-t border-border/60 bg-background/95 backdrop-blur-xl lg:hidden"
        >
          <nav
            className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6"
            aria-label={t("Mobile")}
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="h-11">
                <Link to="/login">{t("Login")}</Link>
              </Button>
              <Button asChild className="h-11 bg-foreground text-background hover:bg-foreground/90">
                <a href="#cta" onClick={() => setOpen(false)}>
                  {t("Get started")}
                </a>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Hero
 * ------------------------------------------------------------------------ */

function Hero() {
  return (
    <section id="top" className="relative px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pt-24">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <a
            href="#features"
            className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
            <span>{t("New · AI Bidding Copilot & smart load matching")}</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            The operating system for{" "}
            <span className="relative inline sm:whitespace-nowrap">
              <span className="text-primary">{t("modern freight")}</span>
              <svg
                aria-hidden
                viewBox="0 0 200 12"
                className="absolute -bottom-1 left-0 h-3 w-full text-primary/50"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 8 C 60 0, 140 0, 198 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t(
              "Dispatch faster, bid smarter, and track every shipment in real time. Logistics Software\r\n            unifies your loads, carriers, quotes, RFPs, accounting, and analytics into a single\r\n            premium command center built for brokers, carriers, shippers, and 3PLs.",
            )}
          </p>

          <div className="mt-8 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="h-12 w-full gap-1.5 rounded-xl px-5 text-[15px] shadow-lg shadow-primary/20 sm:w-auto"
            >
              <a href="#cta">
                {t("Start free trial")} <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 w-full gap-1.5 rounded-xl border-border/70 bg-card/40 px-5 text-[15px] backdrop-blur sm:w-auto"
            >
              <a href="#features">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Play className="h-3 w-3 fill-current" aria-hidden />
                </span>
                Explore the product
              </a>
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <TrustItem icon={<ShieldCheck className="h-3.5 w-3.5 text-success" />}>
              {t("SOC 2 Type II")}
            </TrustItem>
            <TrustItem icon={<Star className="h-3.5 w-3.5 fill-warning text-warning" />}>
              {t("4.9 / 5 on G2")}
            </TrustItem>
            <TrustItem icon={<Users className="h-3.5 w-3.5 text-info" />}>
              {t("1,800+ logistics teams")}
            </TrustItem>
            <TrustItem icon={<CircleCheck className="h-3.5 w-3.5 text-success" />}>
              {t("No credit card required")}
            </TrustItem>
          </div>
        </div>

        <HeroDashboardPreview />
      </div>
    </section>
  );
}

function TrustItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {children}
    </span>
  );
}

function HeroDashboardPreview() {
  return (
    <div className="relative mx-auto mt-14 max-w-6xl sm:mt-20">
      <div
        aria-hidden
        className="absolute -inset-x-10 -top-10 -bottom-10 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/20 via-info/10 to-success/15 opacity-60 blur-3xl"
      />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/60 shadow-2xl shadow-primary/10 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/5">
        {/* Window chrome */}
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
          </div>
          <div className="hidden items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
            <Globe2 className="h-3 w-3" />
            app.logistics.software/dashboard
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
            {t("Live")}
          </div>
        </div>

        {/* App body */}
        <div className="grid grid-cols-12 bg-background">
          {/* Mini sidebar */}
          <aside className="col-span-2 hidden flex-col gap-1 border-r border-border/60 bg-muted/30 p-3 lg:flex">
            {[
              { label: "Dashboard", icon: Gauge, active: true },
              { label: "Loads", icon: Package },
              { label: "Bidding", icon: Gavel },
              { label: "Quotes", icon: FileSpreadsheet },
              { label: "Tracking", icon: MapPin },
              { label: "Carriers", icon: Building2 },
              { label: "Analytics", icon: BarChart3 },
              { label: "Accounting", icon: Receipt },
            ].map((it) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.label}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    it.active ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {it.label}
                </div>
              );
            })}
          </aside>

          {/* Main content */}
          <div className="col-span-12 space-y-4 p-4 sm:p-5 lg:col-span-10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t("Operations Dashboard")}
                </div>
                <div className="text-sm font-semibold sm:text-base">
                  {t("Welcome back, Jordan")}
                </div>
              </div>
              <div className="hidden gap-1.5 sm:flex">
                <span className="rounded-md border border-border/70 bg-card px-2 py-1 text-[11px] text-muted-foreground">
                  {t("Last 7 days")}
                </span>
                <span className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
                  {t("+ New Load")}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniKpi label={t("Active loads")} value="248" delta="+12.4%" tone="success" />
              <MiniKpi label={t("Open bids")} value="36" delta="+4.1%" tone="info" />
              <MiniKpi label={t("Revenue MTD")} value="$2.41M" delta="+8.7%" tone="success" />
              <MiniKpi label={t("On-time")} value="96.8%" delta="+0.6%" tone="primary" />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-card p-3 sm:p-4 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium">{t("Revenue vs target")}</div>
                  <Badge variant="secondary" className="h-5 gap-1 bg-success/15 text-success">
                    <TrendingUp className="h-3 w-3" /> +18.2%
                  </Badge>
                </div>
                <div className="h-32 sm:h-40">
                  <MiniAreaChart />
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-3 sm:p-4">
                <div className="mb-2 text-xs font-medium">{t("Live shipments")}</div>
                <MiniMap />
              </div>
            </div>

            <div className="hidden rounded-xl border border-border/70 bg-card sm:block">
              <div className="grid grid-cols-12 border-b border-border/60 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="col-span-2">{t("Load")}</div>
                <div className="col-span-4">{t("Lane")}</div>
                <div className="col-span-3">{t("Carrier")}</div>
                <div className="col-span-2">{t("Status")}</div>
                <div className="col-span-1 text-right">{t("Rev")}</div>
              </div>
              {[
                {
                  id: "L-2841",
                  lane: "Atlanta → Dallas",
                  carrier: "Bluepeak Freight",
                  status: "On time",
                  tone: "success",
                  rev: "$3,420",
                },
                {
                  id: "L-2839",
                  lane: "Long Beach → Phoenix",
                  carrier: "Sundial Trucking",
                  status: "At risk",
                  tone: "warning",
                  rev: "$2,180",
                },
                {
                  id: "L-2832",
                  lane: "Chicago → Indianapolis",
                  carrier: "Ironline Logistics",
                  status: "On time",
                  tone: "success",
                  rev: "$1,640",
                },
              ].map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-12 items-center border-b border-border/40 px-4 py-2 text-xs last:border-0"
                >
                  <div className="col-span-2 font-medium">{r.id}</div>
                  <div className="col-span-4 text-muted-foreground">{r.lane}</div>
                  <div className="col-span-3">{r.carrier}</div>
                  <div className="col-span-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.tone === "success"
                          ? "bg-success/15 text-success"
                          : "bg-warning/20 text-warning-foreground"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="col-span-1 text-right font-semibold">{r.rev}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating accents */}
      <FloatingChip
        className="left-2 top-10 hidden sm:flex"
        icon={<Activity className="h-4 w-4 text-success" />}
        title={t("ETA on track")}
        subtitle={t("L-2841 · Atlanta → Dallas")}
      />
      <FloatingChip
        className="right-2 top-1/2 hidden -translate-y-1/2 sm:flex"
        icon={<ShieldAlert className="h-4 w-4 text-warning-foreground" />}
        title={t("Risk score 72")}
        subtitle={t("Weather alert · I-40")}
      />
      <FloatingChip
        className="bottom-6 left-12 hidden sm:flex"
        icon={<Banknote className="h-4 w-4 text-primary" />}
        title={t("Invoice paid")}
        subtitle={t("INV-7741 · $4,210")}
      />
    </div>
  );
}

function MiniKpi({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "success" | "info" | "primary" | "warning";
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: "bg-success/12 text-success",
    info: "bg-info/12 text-info",
    primary: "bg-primary/12 text-primary",
    warning: "bg-warning/20 text-warning-foreground",
  };
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-end justify-between">
        <div className="text-base font-semibold tabular-nums sm:text-lg">{value}</div>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${toneClasses[tone]}`}
        >
          {delta}
        </span>
      </div>
    </div>
  );
}

function MiniAreaChart() {
  const data = [
    { x: "W1", a: 38, b: 32 },
    { x: "W2", a: 42, b: 36 },
    { x: "W3", a: 48, b: 40 },
    { x: "W4", a: 46, b: 44 },
    { x: "W5", a: 58, b: 48 },
    { x: "W6", a: 64, b: 52 },
    { x: "W7", a: 72, b: 56 },
    { x: "W8", a: 84, b: 62 },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="x"
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--color-muted-foreground)"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <RTooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="b"
          stroke="var(--color-chart-3)"
          strokeWidth={2}
          fill="url(#gb)"
        />
        <Area
          type="monotone"
          dataKey="a"
          stroke="var(--color-chart-1)"
          strokeWidth={2.5}
          fill="url(#ga)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MiniMap() {
  return (
    <div className="relative h-32 overflow-hidden rounded-lg border border-border/60 bg-gradient-to-br from-info/10 via-background to-primary/10 sm:h-40">
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          color: "var(--color-border)",
        }}
      />
      {/* fake route */}
      <svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path
          d="M 15 80 Q 60 20 110 50 T 188 25"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </svg>
      {/* pins */}
      <Pin className="left-[7%] top-[72%]" tone="success" />
      <Pin className="left-[52%] top-[44%]" tone="primary" pulsing />
      <Pin className="left-[90%] top-[20%]" tone="info" />
      <div className="absolute bottom-2 right-2 rounded-md border border-border/60 bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
        {t("12 in transit")}
      </div>
    </div>
  );
}

function Pin({
  className = "",
  tone,
  pulsing,
}: {
  className?: string;
  tone: "success" | "primary" | "info" | "destructive";
  pulsing?: boolean;
}) {
  const colors: Record<typeof tone, string> = {
    success: "bg-success",
    primary: "bg-primary",
    info: "bg-info",
    destructive: "bg-destructive",
  };
  return (
    <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${className}`}>
      {pulsing && (
        <span
          className={`absolute inset-0 -m-1 animate-ping motion-reduce:animate-none rounded-full ${colors[tone]} opacity-40`}
        />
      )}
      <span className={`block h-2.5 w-2.5 rounded-full ring-2 ring-background ${colors[tone]}`} />
    </div>
  );
}

function FloatingChip({
  className = "",
  icon,
  title,
  subtitle,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      className={`absolute z-10 items-center gap-2.5 rounded-xl border border-border/70 bg-card/90 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur transition-transform hover:-translate-y-0.5 ${className}`}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60">{icon}</div>
      <div className="leading-tight">
        <div className="text-xs font-semibold">{title}</div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Logos strip
 * ------------------------------------------------------------------------ */

const LOGO_NAMES = [
  "NORTHSTAR",
  "TRANSOCEAN",
  "BLUEPEAK",
  "IRONLINE",
  "GULFSTREAM",
  "SUNDIAL",
  "MERIDIAN",
  "VANGUARD",
] as const;

function LogosStrip() {
  return (
    <section className="px-4 pt-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("Trusted by freight teams moving 12M+ loads per year")}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 opacity-70 sm:grid-cols-4 lg:grid-cols-8">
          {LOGO_NAMES.map((name) => (
            <div
              key={name}
              className="flex items-center justify-center gap-1.5 text-sm font-bold tracking-[0.18em] text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              <span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground/50" />
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Stats
 * ------------------------------------------------------------------------ */

const STATS = [
  { value: "12M+", label: "Loads moved", icon: Package },
  { value: "8,200+", label: "Carriers onboarded", icon: Building2 },
  { value: "99.99%", label: "Platform uptime", icon: ShieldCheck },
  { value: "$2.4B", label: "Freight under management", icon: Banknote },
  { value: "37%", label: "Faster dispatching", icon: Zap },
  { value: "96.8%", label: "On-time delivery", icon: PackageCheck },
] as const;

function Stats() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="By the numbers"
          title={t("The most reliable platform in freight")}
          description={t(
            "Built for scale and uptime — Logistics Software powers brokers, carriers, and shippers across every mode and lane in North America.",
          )}
        />

        <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-6">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {s.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
                <div
                  aria-hidden
                  className="absolute -bottom-10 -right-10 h-24 w-24 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={`mx-auto max-w-3xl ${align === "center" ? "text-center" : "text-left"}`}>
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </div>
      )}
      <h2
        className={`text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1] ${
          eyebrow ? "mt-3" : ""
        }`}
      >
        {title}
      </h2>
      {description && (
        <p
          className={`mt-3 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg ${
            align === "center" ? "sm:mx-auto" : ""
          }`}
        >
          {description}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Features
 * ------------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: Gauge,
    title: "Operations Dashboard",
    description:
      "A single command center with live KPIs, exceptions, and revenue health across every load.",
    accent: "primary",
  },
  {
    icon: Gavel,
    title: "Bidding Engine",
    description: "Win more freight with AI-assisted bids, lane history, and win/loss analytics.",
    accent: "info",
  },
  {
    icon: ShieldAlert,
    title: "Risk Models",
    description:
      "Score every shipment for weather, lane, carrier, and detention risk before you dispatch.",
    accent: "destructive",
  },
  {
    icon: FileText,
    title: "RFP Manager",
    description:
      "Run enterprise RFPs end-to-end — invitations, awards, exceptions, and contract uploads.",
    accent: "warning",
  },
  {
    icon: FileSpreadsheet,
    title: "Smart Quotes",
    description:
      "Generate accurate, branded quotes in seconds with live rates and margin guardrails.",
    accent: "primary",
  },
  {
    icon: Package,
    title: "Loads",
    description:
      "Plan, dispatch, and update every shipment with stops, docs, and references in one record.",
    accent: "info",
  },
  {
    icon: Truck,
    title: "TruckBoard",
    description:
      "See available capacity instantly with carrier-shared trucks, lanes, and home bases.",
    accent: "success",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    description:
      "Slice revenue, margin, lanes, dwell, and carrier performance with board-ready reporting.",
    accent: "primary",
  },
  {
    icon: Building2,
    title: "Carriers & Brokers",
    description: "Centralize onboarding, insurance, contacts, scorecards, and lane preferences.",
    accent: "info",
  },
  {
    icon: Radar,
    title: "Live Tracking",
    description: "GPS + ELD + driver app tracking with ETA, geofence stops, and exception alerts.",
    accent: "success",
  },
  {
    icon: MessagesSquare,
    title: "Communications",
    description: "Email, SMS, and driver chat unified per load, with templates and audit history.",
    accent: "warning",
  },
  {
    icon: Receipt,
    title: "Accounting",
    description:
      "Auto-build invoices from PODs, reconcile carrier pay, and sync to your GL in real time.",
    accent: "primary",
  },
  {
    icon: Users,
    title: "CRM & Sales",
    description:
      "Manage shippers, deals, contacts, and pipeline alongside the operations they drive.",
    accent: "info",
  },
] as const;

type AccentTone = "primary" | "info" | "success" | "warning" | "destructive";

const ACCENT_BG: Record<AccentTone, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/12 text-destructive",
};

function Features() {
  return (
    <section id="features" className="relative px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Platform"
          title={t("One platform. Every workflow in freight.")}
          description={t(
            "Replace 6+ disconnected tools with a unified system designed for operations, sales, and finance teams alike.",
          )}
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            const accent = f.accent as AccentTone;
            return (
              <div
                key={f.title}
                className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-xl hover:shadow-primary/5"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${ACCENT_BG[accent]}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                <div className="mt-auto flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t("Learn more")} <ArrowRight className="h-3 w-3" />
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Workflow
 * ------------------------------------------------------------------------ */

const WORKFLOW_STEPS = [
  { label: "Create Load", icon: Package, tone: "primary" },
  { label: "Match Carrier", icon: Building2, tone: "info" },
  { label: "Send Quote", icon: Send, tone: "info" },
  { label: "Dispatch Driver", icon: Truck, tone: "primary" },
  { label: "Track Shipment", icon: MapPin, tone: "success" },
  { label: "Upload POD", icon: ClipboardCheck, tone: "success" },
  { label: "Invoice", icon: Receipt, tone: "warning" },
  { label: "Analyze", icon: BarChart3, tone: "primary" },
] as const;

function WorkflowSection() {
  return (
    <section className="relative px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full bg-gradient-to-b from-muted/40 via-transparent to-transparent"
      />
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="End-to-end workflow"
          title={t("From booked to billed — automated")}
          description={t(
            "Eight steps. One platform. Every handoff is tracked, time-stamped, and audit-ready.",
          )}
        />

        <div className="mt-14 hidden lg:block">
          <div className="relative">
            <div className="absolute left-0 right-0 top-7 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <div className="relative grid grid-cols-8 gap-3">
              {WORKFLOW_STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="flex flex-col items-center text-center">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm ${
                        ACCENT_BG[s.tone as AccentTone]
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Step {i + 1}
                    </div>
                    <div className="mt-1 text-sm font-medium">{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile + tablet vertical */}
        <div className="mt-12 grid grid-cols-2 gap-3 lg:hidden">
          {WORKFLOW_STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    ACCENT_BG[s.tone as AccentTone]
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="leading-tight">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Step {i + 1}
                  </div>
                  <div className="text-sm font-medium">{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Badge variant="secondary" className="gap-1 bg-success/12 text-success">
            <Zap className="h-3 w-3" /> {t("37% faster dispatch")}
          </Badge>
          <Badge variant="secondary" className="gap-1 bg-info/12 text-info">
            <Workflow className="h-3 w-3" /> {t("Zero manual handoffs")}
          </Badge>
          <Badge variant="secondary" className="gap-1 bg-primary/12 text-primary">
            <ShieldCheck className="h-3 w-3" /> {t("Audit-ready every step")}
          </Badge>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Live Tracking Preview
 * ------------------------------------------------------------------------ */

function TrackingPreview() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader
              eyebrow="Live Tracking"
              title={t("Know exactly where every shipment is — always")}
              description={t(
                "GPS, ELD, and driver-app pings unified on one map. Get proactive alerts for weather, dwell, and ETA drift before they become problems.",
              )}
              align="left"
            />
            <ul className="mt-8 space-y-3">
              {[
                {
                  title: "Real-time ETA confidence",
                  desc: "ML-powered ETA with confidence bands that update every minute.",
                  icon: Clock,
                },
                {
                  title: "Geofenced stops",
                  desc: "Auto-detect arrival, dwell, and departure at every facility.",
                  icon: MapPin,
                },
                {
                  title: "Exception playbooks",
                  desc: "Configure auto-actions when shipments drift beyond your SLAs.",
                  icon: AlertTriangle,
                },
                {
                  title: "Shareable tracking page",
                  desc: "Send branded, read-only tracking links to shippers and consignees.",
                  icon: Globe2,
                },
              ].map((b) => {
                const Icon = b.icon;
                return (
                  <li key={b.title} className="flex gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{b.title}</div>
                      <div className="text-sm text-muted-foreground">{b.desc}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-info/15 via-primary/10 to-success/10 blur-2xl"
            />
            <Card className="overflow-hidden border-border/70 shadow-xl shadow-primary/5">
              <CardContent className="p-0">
                {/* Map area */}
                <div className="relative h-72 overflow-hidden border-b border-border/70 bg-gradient-to-br from-info/10 via-background to-primary/10 sm:h-96">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-50"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                      backgroundSize: "32px 32px",
                      color: "var(--color-border)",
                    }}
                  />
                  <svg
                    viewBox="0 0 400 220"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                  >
                    <path
                      d="M 30 170 Q 120 60 220 110 T 380 50"
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 30 170 Q 120 60 220 110"
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      opacity="0.4"
                      strokeDasharray="5 5"
                    />
                  </svg>

                  <Pin className="left-[7%] top-[78%]" tone="success" />
                  <Pin className="left-[55%] top-[50%]" tone="primary" pulsing />
                  <Pin className="left-[95%] top-[22%]" tone="info" />

                  <div className="absolute left-3 top-3 rounded-lg border border-border/60 bg-card/90 px-2.5 py-1.5 text-[11px] font-medium backdrop-blur">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-success" />
                      {t("L-2841 · Live")}
                    </span>
                  </div>
                  <div className="absolute right-3 top-3 flex flex-col gap-1 text-[10px] text-muted-foreground">
                    <div className="rounded-md border border-border/60 bg-card/90 px-2 py-1 backdrop-blur">
                      + –
                    </div>
                    <div className="rounded-md border border-border/60 bg-card/90 px-2 py-1 backdrop-blur">
                      {t("Layers")}
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-3 rounded-lg border border-border/60 bg-card/95 px-3 py-2 text-xs backdrop-blur">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      ETA
                    </div>
                    <div className="text-sm font-semibold">{t("Today · 4:20 PM")}</div>
                    <div className="text-[11px] text-success">{t("On time · 96% confidence")}</div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="grid gap-0 sm:grid-cols-3">
                  <div className="border-r border-border/60 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t("Status timeline")}
                    </div>
                    <ul className="mt-3 space-y-2">
                      {[
                        { label: "Pickup · Atlanta, GA", time: "Mon 8:14 AM", tone: "success" },
                        { label: "In transit · Hwy 20", time: "Mon 11:02 AM", tone: "success" },
                        { label: "Fuel stop · Birmingham", time: "Mon 1:48 PM", tone: "info" },
                        { label: "ETA Dallas, TX", time: "Today 4:20 PM", tone: "primary" },
                      ].map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span
                            className={`mt-1 h-1.5 w-1.5 rounded-full ${
                              s.tone === "success"
                                ? "bg-success"
                                : s.tone === "info"
                                  ? "bg-info"
                                  : "bg-primary"
                            }`}
                          />
                          <div>
                            <div className="font-medium">{s.label}</div>
                            <div className="text-muted-foreground">{s.time}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-r border-border/60 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t("Exceptions")}
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning-foreground" />
                        <div className="text-xs">
                          <div className="font-medium">{t("Weather alert · I-40")}</div>
                          <div className="text-muted-foreground">{t("Reroute suggested")}</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-2">
                        <CircleDot className="mt-0.5 h-3.5 w-3.5 text-info" />
                        <div className="text-xs">
                          <div className="font-medium">{t("Dwell trending +20m")}</div>
                          <div className="text-muted-foreground">{t("Receiver historical")}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t("Shipment")}
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs">
                      <Row k="Carrier" v="Bluepeak Freight" />
                      <Row k="Driver" v="J. Mendoza" />
                      <Row k="Equipment" v="53' Dry Van" />
                      <Row k="Weight" v="42,300 lb" />
                      <Row k="Reference" v="PO-118203" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Analytics Preview
 * ------------------------------------------------------------------------ */

function AnalyticsPreview() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Analytics"
          title={t("Decisions backed by every shipment you've ever moved")}
          description={t(
            "Board-ready dashboards across revenue, carrier health, load volume, and risk — built on real-time data, not yesterday's CSV.",
          )}
        />

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          <Card className="border-border/70 lg:col-span-2">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("Revenue & margin")}
                  </div>
                  <div className="text-base font-semibold">$2.41M · MTD</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="gap-1 bg-success/12 text-success">
                    <TrendingUp className="h-3 w-3" /> +18.2%
                  </Badge>
                  <span>{t("vs. last 8 weeks")}</span>
                </div>
              </div>
              <div className="mt-4 h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={[
                      { x: "W1", rev: 220, margin: 42 },
                      { x: "W2", rev: 260, margin: 50 },
                      { x: "W3", rev: 290, margin: 56 },
                      { x: "W4", rev: 280, margin: 58 },
                      { x: "W5", rev: 340, margin: 70 },
                      { x: "W6", rev: 380, margin: 78 },
                      { x: "W7", rev: 410, margin: 86 },
                      { x: "W8", rev: 470, margin: 102 },
                    ]}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="grev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gmar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="var(--color-border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="x"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <RTooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="rev"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2.5}
                      fill="url(#grev)"
                      name="Revenue (k)"
                    />
                    <Area
                      type="monotone"
                      dataKey="margin"
                      stroke="var(--color-chart-3)"
                      strokeWidth={2}
                      fill="url(#gmar)"
                      name="Margin (k)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardContent className="p-5 sm:p-6">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("On-time delivery")}
              </div>
              <div className="mt-1 text-base font-semibold">96.8%</div>
              <div className="mt-4 h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={[
                      { x: "Mo", v: 93 },
                      { x: "Tu", v: 95 },
                      { x: "We", v: 94 },
                      { x: "Th", v: 96 },
                      { x: "Fr", v: 97 },
                      { x: "Sa", v: 97 },
                      { x: "Su", v: 96.8 },
                    ]}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke="var(--color-border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="x"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <YAxis
                      domain={[85, 100]}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <RTooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke="var(--color-success)"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardContent className="p-5 sm:p-6">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("Load volume by lane")}
              </div>
              <div className="mt-1 text-base font-semibold">{t("4,820 loads · 30d")}</div>
              <div className="mt-4 h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { l: "ATL→DAL", v: 480 },
                      { l: "LBC→PHX", v: 410 },
                      { l: "CHI→IND", v: 360 },
                      { l: "MIA→ORL", v: 290 },
                      { l: "NRK→BOS", v: 240 },
                      { l: "SEA→PDX", v: 200 },
                    ]}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke="var(--color-border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="l"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--color-muted-foreground)"
                    />
                    <RTooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="v" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 lg:col-span-2">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("Carrier performance")}
                  </div>
                  <div className="text-base font-semibold">{t("Top carriers by score")}</div>
                </div>
                <Badge variant="secondary" className="gap-1 bg-info/12 text-info">
                  <Star className="h-3 w-3" /> {t("92.4 avg")}
                </Badge>
              </div>
              <div className="space-y-4">
                {[
                  { name: "Bluepeak Freight", score: 96, loads: "184" },
                  { name: "Ironline Logistics", score: 93, loads: "152" },
                  { name: "Gulfstream Express", score: 89, loads: "138" },
                  { name: "Sundial Trucking", score: 78, loads: "121" },
                  { name: "Northbay Carriers", score: 74, loads: "94" },
                ].map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[11px] font-semibold">
                          {c.name
                            .split(" ")
                            .slice(0, 2)
                            .map((p) => p[0])
                            .join("")}
                        </span>
                        <span className="font-medium">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">{c.loads} loads</span>
                        <span className="tabular-nums font-semibold text-foreground">
                          {c.score}
                        </span>
                      </div>
                    </div>
                    <Progress value={c.score} className="h-1.5" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Benefits
 * ------------------------------------------------------------------------ */

const BENEFITS = [
  {
    icon: Zap,
    title: "Faster dispatching",
    description: "Cut dispatch time by 37% with smart matching, saved playbooks, and bulk actions.",
  },
  {
    icon: Radar,
    title: "Better tracking",
    description: "Unify GPS, ELD, and driver-app pings into one trusted source of shipment truth.",
  },
  {
    icon: Sparkles,
    title: "Smarter bidding",
    description: "Win more freight with AI-assisted bids based on your lane and carrier history.",
  },
  {
    icon: Boxes,
    title: "Centralized carriers",
    description: "All onboarding, contracts, insurance, and scorecards in a single carrier record.",
  },
  {
    icon: Receipt,
    title: "Cleaner accounting",
    description: "Auto-build invoices from PODs, reconcile carrier pay, and sync to your GL.",
  },
] as const;

function Benefits() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Why teams switch"
          title={t("Outcomes you can measure in weeks, not quarters")}
          description={t(
            "From new brokerages to enterprise 3PLs, teams move faster on Logistics Software.",
          )}
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-5">
          {BENEFITS.map((b, i) => {
            const Icon = b.icon;
            return (
              <div
                key={b.title}
                className={`group relative flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                  i === 0 ? "lg:col-span-1" : ""
                }`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-info/15 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{b.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{b.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Solutions
 * ------------------------------------------------------------------------ */

const SOLUTIONS = [
  {
    id: "brokers",
    label: "Brokers",
    icon: Gavel,
    headline: "Win, dispatch, and bill more loads — with fewer people.",
    bullets: [
      "AI-assisted quoting and bidding",
      "Live carrier matching",
      "Auto-invoicing and reconciliation",
    ],
  },
  {
    id: "carriers",
    label: "Carriers",
    icon: Truck,
    headline: "Keep trucks moving and drivers paid on time.",
    bullets: [
      "Driver app with check-calls and PODs",
      "TruckBoard for available capacity",
      "Settlement-ready accounting",
    ],
  },
  {
    id: "shippers",
    label: "Shippers",
    icon: Boxes,
    headline: "Predictable freight performance across every lane.",
    bullets: [
      "Tendering and RFP workflows",
      "Real-time tracking + branded portal",
      "Spend and lane analytics",
    ],
  },
  {
    id: "dispatchers",
    label: "Dispatchers",
    icon: Headphones,
    headline: "Manage 10x more loads without the chaos.",
    bullets: [
      "Unified inbox + call/SMS history",
      "Smart load board and assignment",
      "Real-time exceptions and ETAs",
    ],
  },
  {
    id: "3pls",
    label: "3PLs",
    icon: Building2,
    headline: "Scale managed services across every customer.",
    bullets: [
      "Multi-tenant org and permissions",
      "White-labeled tracking portals",
      "Customer-specific SLAs and rates",
    ],
  },
  {
    id: "fleets",
    label: "Fleet ops",
    icon: Navigation,
    headline: "Plan, dispatch, and track your private fleet.",
    bullets: [
      "Asset and driver utilization",
      "Geofenced yards and stops",
      "Maintenance and DOT compliance",
    ],
  },
] as const;

function Solutions() {
  return (
    <section id="solutions" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Solutions"
          title={t("Built for every role on the freight floor")}
          description={t(
            "Configure Logistics Software for your team — brokers, carriers, shippers, dispatchers, 3PLs, and private fleets.",
          )}
        />

        <Tabs defaultValue="brokers" className="mt-14">
          <div className="overflow-x-auto pb-2">
            <TabsList className="mx-auto inline-flex h-auto flex-wrap justify-center gap-1 rounded-xl border border-border/70 bg-card p-1">
              {SOLUTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    className="gap-1.5 rounded-lg px-3 py-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {SOLUTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <TabsContent key={s.id} value={s.id} className="mt-10">
                <div className="grid items-center gap-8 rounded-3xl border border-border/70 bg-card p-6 sm:p-10 lg:grid-cols-2 lg:gap-12">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Icon className="h-3.5 w-3.5" /> For {s.label.toLowerCase()}
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                      {s.headline}
                    </h3>
                    <ul className="mt-6 space-y-2.5">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                            <Check className="h-3 w-3" />
                          </span>
                          <span className="text-sm text-muted-foreground">{b}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-8 flex gap-2">
                      <Button asChild className="h-10 gap-1.5">
                        <a href="#cta">
                          {t("See it in action")} <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button asChild variant="outline" className="h-10">
                        <a href="#pricing">{t("Compare plans")}</a>
                      </Button>
                    </div>
                  </div>

                  <SolutionVisual />
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </section>
  );
}

function SolutionVisual() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/15 via-info/10 to-success/10 blur-2xl"
      />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive/60" />
            <span className="h-2 w-2 rounded-full bg-warning/80" />
            <span className="h-2 w-2 rounded-full bg-success/80" />
          </div>
          <span className="ml-2 text-[11px] text-muted-foreground">
            {t("Operations · workspace")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 p-4 sm:p-5">
          <MiniKpi label={t("Loads")} value="248" delta="+12%" tone="success" />
          <MiniKpi label={t("Bids")} value="36" delta="+4%" tone="info" />
          <MiniKpi label={t("On-time")} value="96.8%" delta="+0.6%" tone="primary" />
          <div className="col-span-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
            <div className="mb-2 text-xs font-medium">{t("Daily volume")}</div>
            <div className="h-28 sm:h-32">
              <MiniAreaChart />
            </div>
          </div>
          <div className="col-span-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
            <div className="mb-2 text-xs font-medium">{t("Live shipments")}</div>
            <MiniMap />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Integrations
 * ------------------------------------------------------------------------ */

const INTEGRATIONS = [
  { name: "Email & Inbox", icon: Mail, desc: "Gmail, Outlook, IMAP" },
  { name: "Calendar", icon: CalendarDays, desc: "Google, Outlook" },
  { name: "ELD", icon: Cpu, desc: "Samsara, Motive, Geotab" },
  { name: "GPS", icon: Navigation, desc: "Fleet tracking & telematics" },
  { name: "Maps", icon: RouteIcon, desc: "Mapbox, HERE, Google Maps" },
  { name: "Accounting", icon: Receipt, desc: "QuickBooks, NetSuite, Xero" },
  { name: "CRM", icon: Users, desc: "Salesforce, HubSpot" },
  { name: "SMS & Voice", icon: Phone, desc: "Twilio, RingCentral" },
  { name: "Public API", icon: Plug, desc: "REST + Webhooks" },
  { name: "Doc storage", icon: Cloud, desc: "S3, Google Drive, SharePoint" },
  { name: "Data warehouse", icon: Database, desc: "Snowflake, BigQuery" },
  { name: "Mobile apps", icon: Smartphone, desc: "iOS + Android driver app" },
] as const;

function Integrations() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Integrations"
          title={t("Connects to your stack in minutes")}
          description={t(
            "Pre-built connectors plus a developer-friendly API so your data flows wherever it needs to.",
          )}
        />

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {INTEGRATIONS.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.name}
                className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{it.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{it.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>{t("Need something custom?")}</span>
          <Button asChild variant="outline" className="h-9 gap-1.5">
            <a href="#cta">
              {t("Talk to engineering")} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Security & Compliance
 * ------------------------------------------------------------------------ */

const SECURITY = [
  {
    icon: KeyRound,
    title: "Role-based access",
    desc: "Granular roles for ops, sales, finance, and execs.",
  },
  {
    icon: ScrollText,
    title: "Audit logs",
    desc: "Every change traced to a user, time, and source.",
  },
  {
    icon: Lock,
    title: "2FA & SSO",
    desc: "TOTP, SAML, and SCIM for enterprise identity providers.",
  },
  {
    icon: ShieldCheck,
    title: "Permissions",
    desc: "Object-level rules across loads, carriers, and finance.",
  },
  {
    icon: Building2,
    title: "Insurance verification",
    desc: "Automated COI checks with expiry monitoring.",
  },
  {
    icon: ShieldAlert,
    title: "Risk & MC checks",
    desc: "Live MC, DOT, and risk scoring before you book.",
  },
] as const;

function Security() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-start gap-10 lg:grid-cols-5 lg:gap-12">
          <div className="lg:col-span-2">
            <SectionHeader
              eyebrow="Security & Compliance"
              title={t("Enterprise-grade by default")}
              description={t(
                "SOC 2 Type II certified. GDPR & CCPA ready. Built for the audit, configured for the operator.",
              )}
              align="left"
            />
            <div className="mt-8 flex flex-wrap gap-2">
              {["SOC 2 Type II", "GDPR", "CCPA", "ISO 27001", "HIPAA-ready"].map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  <ShieldCheck className="h-3 w-3 text-success" />
                  {b}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
            {SECURITY.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  className="group rounded-xl border border-border/70 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/12 text-success">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold">{s.title}</h3>
                  </div>
                  <p className="mt-2.5 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Testimonials
 * ------------------------------------------------------------------------ */

const TESTIMONIALS = [
  {
    quote:
      "We replaced four tools with Logistics Software. Dispatch is 40% faster and our brokers finally have one source of truth.",
    name: "Maria Alvarez",
    role: "VP Operations",
    company: "Bluepeak Freight",
    initials: "MA",
  },
  {
    quote:
      "The bidding engine alone paid for the platform in three months. Win rates are up double-digits on our top lanes.",
    name: "Devon Walsh",
    role: "Head of Brokerage",
    company: "Northstar Logistics",
    initials: "DW",
  },
  {
    quote:
      "Tracking and exception alerts mean we stop fires before they start. Our shippers actually trust the ETAs now.",
    name: "Priya Sharma",
    role: "Director of 3PL Services",
    company: "Meridian Supply Chain",
    initials: "PS",
  },
] as const;

function Testimonials() {
  return (
    <section id="testimonials" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Loved by freight teams"
          title={t("Operators on Logistics Software say it best")}
          description={t("Real teams. Real lanes. Real outcomes — measured in weeks.")}
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3 lg:gap-5">
          {TESTIMONIALS.map((testimonial, i) => (
            <div
              key={i}
              className="group relative flex flex-col rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-xl"
            >
              <div
                className="flex items-center gap-1 text-warning"
                aria-label={t("5 out of 5 stars")}
              >
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-warning text-warning" aria-hidden />
                ))}
              </div>
              <Quote className="absolute right-5 top-5 h-8 w-8 text-primary/15" />
              <blockquote className="mt-4 text-[15px] leading-relaxed text-foreground">
                "{testimonial.quote}"
              </blockquote>
              <div className="mt-6 flex items-center gap-3 border-t border-border/60 pt-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-info text-sm font-semibold text-primary-foreground">
                  {testimonial.initials}
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">{testimonial.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {testimonial.role} · {testimonial.company}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Pricing
 * ------------------------------------------------------------------------ */

const PLANS = [
  {
    name: "Starter",
    description: "For new brokerages and small carriers getting organized.",
    price: "$249",
    suffix: "/ user / month",
    cta: "Start free trial",
    accent: "muted",
    features: [
      "Up to 5 users",
      "Loads, quotes, and dispatch",
      "Basic tracking & ETAs",
      "Email + SMS communications",
      "Standard reporting",
    ],
  },
  {
    name: "Professional",
    description: "Growing teams that need automation, analytics, and roles.",
    price: "$499",
    suffix: "/ user / month",
    cta: "Start free trial",
    accent: "primary",
    popular: true,
    features: [
      "Unlimited users",
      "AI bidding + smart matching",
      "Advanced analytics & dashboards",
      "Risk models + exception playbooks",
      "Custom roles & audit logs",
      "Accounting + GL sync",
    ],
  },
  {
    name: "Enterprise",
    description: "Multi-tenant 3PLs and enterprise shippers at scale.",
    price: "Custom",
    suffix: "annual contract",
    cta: "Contact sales",
    accent: "dark",
    features: [
      "Everything in Professional",
      "Multi-tenant org & SSO/SCIM",
      "Dedicated CSM + onboarding",
      "Custom integrations & SLAs",
      "White-labeled tracking portals",
      "24/7 priority support",
    ],
  },
] as const;

function Pricing() {
  return (
    <section id="pricing" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Pricing"
          title={t("Simple, transparent plans that scale with you")}
          description={t(
            "Start free for 14 days. No credit card required. Switch plans or cancel anytime.",
          )}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => {
            const popular = "popular" in p && p.popular;
            const isDark = p.accent === "dark";
            const isPrimary = p.accent === "primary";
            return (
              <div
                key={p.name}
                className={`relative flex flex-col rounded-2xl border p-6 sm:p-8 ${
                  isDark
                    ? "border-sidebar-border bg-sidebar text-sidebar-foreground"
                    : isPrimary
                      ? "border-primary/30 bg-card shadow-xl shadow-primary/10"
                      : "border-border/70 bg-card"
                }`}
              >
                {popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground shadow-sm">
                    {t("Most popular")}
                  </div>
                )}
                <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
                <p
                  className={`mt-2 text-sm ${
                    isDark ? "text-sidebar-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {p.description}
                </p>
                <div className="mt-6 flex items-end gap-1">
                  <div className="text-4xl font-semibold tracking-tight sm:text-5xl">{p.price}</div>
                  <div
                    className={`pb-1.5 text-xs ${
                      isDark ? "text-sidebar-foreground/60" : "text-muted-foreground"
                    }`}
                  >
                    {p.suffix}
                  </div>
                </div>

                <Button
                  asChild
                  className={`mt-6 h-11 w-full ${
                    isPrimary
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : isDark
                        ? "bg-sidebar-foreground text-sidebar hover:bg-sidebar-foreground/90"
                        : "bg-foreground text-background hover:bg-foreground/90"
                  }`}
                >
                  <a href="#cta">{p.cta}</a>
                </Button>

                <ul className="mt-8 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          isDark ? "bg-success/25 text-success" : "bg-success/15 text-success"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span
                        className={isDark ? "text-sidebar-foreground/80" : "text-foreground/90"}
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> {t("No credit card required")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-success" /> {t("SOC 2 Type II")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Headphones className="h-3.5 w-3.5" /> {t("Onboarding included")}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: FAQ
 * ------------------------------------------------------------------------ */

const FAQS = [
  {
    q: "How long does implementation take?",
    a: "Most teams are live in 2–4 weeks. We import your carriers, customers, and historical loads, train your team, and stand up integrations alongside your operations.",
  },
  {
    q: "Can I migrate from my current TMS?",
    a: "Yes. We support migrations from McLeod, MercuryGate, Aljex, AscendTMS, Tai, Turvo, and many homegrown systems with structured imports and a dedicated migration engineer.",
  },
  {
    q: "Do you support multi-tenant organizations?",
    a: "Absolutely. Enterprise customers can run multiple brands or business units in a single workspace with isolated data, custom permissions, and per-tenant SLAs.",
  },
  {
    q: "What integrations are included out of the box?",
    a: "Email, calendar, GPS, ELD, mapping, accounting (QuickBooks, NetSuite, Xero), CRM (Salesforce, HubSpot), SMS/voice, and our public REST API + webhooks.",
  },
  {
    q: "How is pricing structured?",
    a: "We charge per active user per month. Enterprise plans are negotiated annually and can include volume tiers, white labeling, and dedicated infrastructure.",
  },
  {
    q: "Is my data secure?",
    a: "We're SOC 2 Type II certified with encryption at rest and in transit, role-based access, audit logs, optional SSO/SCIM, and regional data residency options.",
  },
] as const;

function FAQSection() {
  return (
    <section id="faq" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <SectionHeader
          eyebrow="FAQ"
          title={t("Questions, answered")}
          description={t("Can't find what you're looking for? Our team is one click away.")}
        />

        <Accordion type="single" collapsible className="mt-12 w-full">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-border/70 last:border-b">
              <AccordionTrigger className="py-5 text-left text-base font-medium hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild className="h-10 gap-1.5">
            <a href="#cta">
              {t("Talk to sales")} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button asChild variant="outline" className="h-10">
            <a href="#features">{t("Explore features")}</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Final CTA
 * ------------------------------------------------------------------------ */

function FinalCTA() {
  return (
    <section id="cta" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-sidebar text-sidebar-foreground shadow-2xl">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div
            aria-hidden
            className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-2xl motion-reduce:hidden"
          />
          <div
            aria-hidden
            className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-info/20 blur-2xl motion-reduce:hidden"
          />

          <div className="relative z-10 grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-2 lg:gap-12 lg:p-16">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border/40 bg-sidebar-accent/40 px-3 py-1 text-xs font-medium backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
                {t("Free 14-day trial · no credit card")}
              </div>
              <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
                {t("Ready to run your freight on Logistics Software?")}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/70 sm:text-base">
                {t(
                  "Join hundreds of brokers, carriers, and 3PLs running their operations on the\r\n                modern logistics OS. We'll have you live in weeks — not quarters.",
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-sidebar-border/40 bg-sidebar-accent/30 p-5 backdrop-blur sm:p-6">
              <div className="text-sm font-semibold">{t("Start your free trial")}</div>
              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => e.preventDefault()}
              >
                <label htmlFor="landing-cta-email" className="sr-only">
                  {t("Work email")}
                </label>
                <Input
                  id="landing-cta-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="h-11 min-w-0 flex-1 border-sidebar-border/40 bg-sidebar/50 text-sidebar-foreground placeholder:text-sidebar-foreground/50"
                />
                <Button
                  type="submit"
                  className="h-11 shrink-0 gap-1.5 bg-primary px-5 text-primary-foreground hover:bg-primary/90"
                >
                  {t("Get started")} <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniBadge icon={<ShieldCheck className="h-3 w-3" />} label={t("SOC 2")} />
                <MiniBadge icon={<Star className="h-3 w-3" />} label="4.9 / 5" />
                <MiniBadge icon={<Users className="h-3 w-3" />} label={t("1.8k+ teams")} />
              </div>
              <p className="mt-3 text-[11px] text-sidebar-foreground/60">
                {t("By starting a trial you agree to our Terms and Privacy Policy.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-md border border-sidebar-border/40 bg-sidebar/40 py-1.5 text-[11px] text-sidebar-foreground/80 backdrop-blur">
      <span className="text-success">{icon}</span>
      {label}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section: Footer
 * ------------------------------------------------------------------------ */

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: ["Dashboard", "Loads", "Bidding", "Quotes", "Tracking", "Analytics", "Accounting"],
  },
  {
    title: "Solutions",
    links: ["Brokers", "Carriers", "Shippers", "Dispatchers", "3PLs", "Fleet operators"],
  },
  {
    title: "Resources",
    links: ["Docs", "API reference", "Changelog", "Webinars", "Customer stories", "Status"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Press", "Partners", "Contact", "Security"],
  },
  {
    title: "Legal",
    links: ["Privacy", "Terms", "DPA", "Cookies", "Subprocessors", "Compliance"],
  },
] as const;

function Footer() {
  return (
    <footer className="border-t border-border/70 bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <a href="#top" className="flex items-center gap-2.5">
              <AppLogoMark className="h-9 w-9 shrink-0 rounded-xl shadow-sm" />
              <div className="flex flex-col leading-tight">
                <span className="text-[15px] font-semibold tracking-tight">
                  {t("Logistics Software")}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("Freight OS")}
                </span>
              </div>
            </a>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {t(
                "The operating system for modern freight — dispatch, brokerage, tracking, accounting,\r\n              and analytics in one premium platform.",
              )}
            </p>

            <div className="mt-5 flex max-w-sm gap-2">
              <label htmlFor="landing-footer-email" className="sr-only">
                {t("Email for product updates")}
              </label>
              <Input
                id="landing-footer-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder={t("Subscribe to product updates")}
                className="h-11 min-w-0 flex-1 border-border/70 bg-card"
              />
              <Button type="button" className="h-11 shrink-0 gap-1.5">
                <Send className="h-3.5 w-3.5" aria-hidden /> {t("Subscribe")}
              </Button>
            </div>

            <div className="mt-6 flex items-center gap-2">
              {(
                [
                  { Icon: Twitter, label: "Twitter" },
                  { Icon: Linkedin, label: "LinkedIn" },
                  { Icon: Github, label: "GitHub" },
                  { Icon: Youtube, label: "YouTube" },
                ] as const
              ).map(({ Icon, label }) => (
                <a
                  key={label}
                  href="#"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={label}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-5 lg:col-span-8 lg:gap-6">
            {FOOTER_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  {g.title}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {g.links.map((l) => (
                    <li key={l}>
                      <a
                        href="#"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col-reverse items-start gap-4 border-t border-border/60 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Logistics Software, Inc. All rights reserved.
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-success" />
              {t("All systems operational")}
            </span>
            <a href="#" className="hover:text-foreground">
              {t("Status")}
            </a>
            <a href="#" className="hover:text-foreground">
              {t("Sitemap")}
            </a>
            <a href="#" className="hover:text-foreground">
              {t("Accessibility")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
