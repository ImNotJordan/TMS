import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BellRing,
  Clock3,
  Globe2,
  Lock,
  Mail,
  Route as RouteIcon,
  ShieldCheck,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import { confirmResetPassword, confirmSignIn, resetPassword } from "aws-amplify/auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AppLogoMark } from "@/components/app-logo-mark";
import { useAuth } from "@/lib/auth";
import { DRIVER_APP_URL } from "@/lib/external-links";
import { toast } from "sonner";
import { t } from "@/lib/i18n/t";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in - Logistics Software" },
      { name: "description", content: "Sign in to your Logistics Software operations console." },
    ],
  }),
  component: LoginPage,
});

type Step = "signIn" | "newPassword" | "forgotRequest" | "forgotConfirm";

const networkStats = [
  { icon: <Activity className="h-4 w-4" />, value: "12,480", label: "Active loads" },
  { icon: <Globe2 className="h-4 w-4" />, value: "48", label: "Countries" },
  { icon: <ShieldCheck className="h-4 w-4" />, value: "99.99%", label: "Uptime SLA" },
];

const watchlistLanes = [
  { lane: "Chicago -> Dallas", eta: "2h 14m", status: "On time", accent: "bg-success" },
  { lane: "Savannah -> Atlanta", eta: "46m", status: "Docking", accent: "bg-info" },
  { lane: "Ontario -> Phoenix", eta: "11h 08m", status: "Weather watch", accent: "bg-warning" },
];

const workflowMoments = [
  {
    icon: <BellRing className="h-4 w-4" />,
    title: "Exception detected",
    detail: "Load TF-284 needs carrier reassignment before 11:30 AM.",
  },
  {
    icon: <RouteIcon className="h-4 w-4" />,
    title: "Lane utilization up",
    detail: "Southwest reefer network is running 18% above last Tuesday.",
  },
  {
    icon: <Warehouse className="h-4 w-4" />,
    title: "Yard sync complete",
    detail: "Memphis, Joliet, and Laredo terminals reconciled in real time.",
  },
];

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, refresh, cancelSignInChallenge } = useAuth();

  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [loading, setLoading] = useState(false);

  const sendResetCode = async () => {
    if (!email.trim()) {
      toast.error("Enter your work email");
      return;
    }
    setLoading(true);
    try {
      const result = await resetPassword({ username: email.trim().toLowerCase() });
      const dest =
        result.nextStep?.codeDeliveryDetails?.destination ??
        result.nextStep?.codeDeliveryDetails?.deliveryMedium ??
        email;
      setStep("forgotConfirm");
      toast.success("Reset code sent", {
        description: `Check ${dest} for a verification code from Cognito.`,
      });
    } catch (err) {
      toast.error("Couldn’t send reset email", {
        description: err instanceof Error ? err.message : "Ask an admin to reset your password.",
      });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.isSignedIn) {
        toast.success("Signed in successfully");
        navigate({ to: "/" });
        return;
      }

      const nextStep = result.nextStep?.signInStep;
      if (nextStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setStep("newPassword");
        toast.message("Set a new password to finish signing in.");
        return;
      }

      toast.error(`Additional step required: ${nextStep ?? "unknown"}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onConfirmNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (result.isSignedIn) {
        await refresh();
        toast.success("Password updated. Signed in.");
        navigate({ to: "/" });
      } else {
        toast.error(`Additional step required: ${result.nextStep?.signInStep ?? "unknown"}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not set new password";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onForgotConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetCode.trim()) {
      toast.error("Enter the code from your email");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await confirmResetPassword({
        username: email.trim().toLowerCase(),
        confirmationCode: resetCode.trim(),
        newPassword,
      });
      toast.success("Password updated. Sign in with your new password.");
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setResetCode("");
      setStep("signIn");
    } catch (err) {
      toast.error("Couldn’t reset password", {
        description: err instanceof Error ? err.message : "Check the code and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const heading =
    step === "signIn"
      ? "Welcome back"
      : step === "newPassword"
        ? "Set a new password"
        : step === "forgotRequest"
          ? "Forgot password"
          : "Enter reset code";

  const subheading =
    step === "signIn"
      ? "Sign in to manage loads, carriers, and shipments across your network."
      : step === "newPassword"
        ? "Your account requires a new password before continuing."
        : step === "forgotRequest"
          ? "We’ll email a Cognito verification code so you can choose a new password."
          : `Enter the code sent to ${email}, then choose a new password.`;

  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-2">
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="flex items-center gap-2">
          <AppLogoMark className="h-9 w-9 rounded-md" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-foreground">
              {t("Logistics Software")}
            </div>
            <div className="text-[11px] text-muted-foreground">{t("Operations Console")}</div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{heading}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>

          {step === "signIn" ? (
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">{t("Work email")}</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="h-11 pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("Password")}</Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setStep("forgotRequest")}
                  >
                    {t("Forgot password?")}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="********"
                    className="h-11 pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                  {t("Keep me signed in for 30 days")}
                </Label>
              </div>

              <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={loading}>
                {loading ? (
                  "Signing in..."
                ) : (
                  <>
                    {t("Sign in")}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="relative py-2">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {t("or continue with")}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button type="button" variant="outline" className="h-11">
                  {t("SSO / SAML")}
                </Button>
                <Button type="button" variant="outline" className="h-11">
                  {t("Google")}
                </Button>
              </div>

              <p className="pt-2 text-center text-sm text-muted-foreground">
                New to the platform?{" "}
                <Link to="/" className="font-medium text-primary hover:underline">
                  {t("Request access")}
                </Link>
              </p>
              <p className="text-center text-sm text-muted-foreground">
                Driver?{" "}
                <a
                  href={DRIVER_APP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {t("Open the driver app →")}
                </a>
              </p>
            </form>
          ) : null}

          {step === "newPassword" ? (
            <form onSubmit={onConfirmNewPassword} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t("New password")}</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("At least 8 characters")}
                    className="h-11 pl-9"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t("Confirm password")}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  className="h-11"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? "Saving…" : "Save password & continue"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading}
                onClick={() => {
                  void cancelSignInChallenge();
                  setStep("signIn");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
              >
                {t("Back to sign in")}
              </Button>
            </form>
          ) : null}

          {step === "forgotRequest" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendResetCode();
              }}
              className="mt-8 space-y-5"
            >
              <div className="space-y-2">
                <Label htmlFor="forgotEmail">{t("Work email")}</Label>
                <Input
                  id="forgotEmail"
                  type="email"
                  autoComplete="email"
                  className="h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset code"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                onClick={() => setStep("signIn")}
              >
                {t("Back to sign in")}
              </Button>
            </form>
          ) : null}

          {step === "forgotConfirm" ? (
            <form onSubmit={onForgotConfirm} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="resetCode">{t("Verification code")}</Label>
                <Input
                  id="resetCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-11 font-mono"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgotNewPassword">{t("New password")}</Label>
                <Input
                  id="forgotNewPassword"
                  type="password"
                  autoComplete="new-password"
                  className="h-11"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgotConfirmPassword">{t("Confirm password")}</Label>
                <Input
                  id="forgotConfirmPassword"
                  type="password"
                  autoComplete="new-password"
                  className="h-11"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading}
                onClick={() => void sendResetCode()}
              >
                {t("Resend code")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                onClick={() => {
                  setStep("signIn");
                  setResetCode("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
              >
                {t("Back to sign in")}
              </Button>
            </form>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>(c) {new Date().getFullYear()} Logistics Software, Inc.</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-foreground">
              {t("Privacy")}
            </a>
            <a href="#" className="hover:text-foreground">
              {t("Terms")}
            </a>
            <a href="#" className="hover:text-foreground">
              {t("Status")}
            </a>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-sidebar p-14 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
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
          className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/30 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-info/20 blur-3xl"
        />

        <div className="relative z-10 w-full max-w-none">
          <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border/40 bg-sidebar-accent/40 px-3 py-1 text-xs font-medium backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            {t("All systems operational")}
          </div>
          <h2 className="mt-8 max-w-2xl text-4xl font-semibold leading-tight tracking-tight">
            {t("One operating system for your entire freight network.")}
          </h2>
          <p className="mt-4 max-w-2xl text-sm text-sidebar-foreground/70">
            {t(
              "Dispatch, brokerage, tracking, accounting, and analytics - unified in a single command\r\n            center built for modern logistics teams.",
            )}
          </p>

          <div className="mt-8 grid w-full gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-sidebar-border/40 bg-[linear-gradient(180deg,oklch(1_0_0_/_0.08),oklch(1_0_0_/_0.03))] p-5 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] backdrop-blur-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.24em] text-sidebar-foreground/55">
                    {t("Live command center")}
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-white">
                    {t("Morning network pulse")}
                  </div>
                  <div className="mt-1 text-sm text-sidebar-foreground/65">
                    {t("Prioritized signals across dispatch, ETA health, and facility flow.")}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/45">
                    {t("Today's margin")}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-white">
                    <TrendingUp className="h-4 w-4 text-success" />
                    +6.4%
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <MetricTile label={t("On-time")} value="96.8%" hint={t("+1.2 vs avg")} />
                <MetricTile label={t("Tracked now")} value="1,284" hint={t("312 high-priority")} />
                <MetricTile label={t("Exceptions")} value="19" hint={t("7 need action")} />
              </div>

              <div className="mt-5 rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">{t("Lane watchlist")}</div>
                  <div className="flex items-center gap-1 text-xs text-sidebar-foreground/55">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t("Updated 2 min ago")}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {watchlistLanes.map((lane) => (
                    <div
                      key={lane.lane}
                      className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 rounded-full ${lane.accent}`} />
                        <div>
                          <div className="text-sm font-medium text-white">{lane.lane}</div>
                          <div className="text-xs text-sidebar-foreground/55">{lane.status}</div>
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-sidebar-foreground">
                        {lane.eta}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex h-full flex-col gap-4">
              <div className="rounded-[24px] border border-sidebar-border/40 bg-sidebar-accent/35 p-5 backdrop-blur-md">
                <div className="text-xs font-medium uppercase tracking-[0.24em] text-sidebar-foreground/55">
                  {t("Why teams switch")}
                </div>
                <div className="mt-4 space-y-4">
                  {workflowMoments.map((moment) => (
                    <div key={moment.title} className="flex gap-3">
                      <div className="mt-0.5 rounded-xl border border-white/8 bg-white/5 p-2 text-sidebar-foreground/80">
                        {moment.icon}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{moment.title}</div>
                        <div className="mt-1 text-xs leading-5 text-sidebar-foreground/60">
                          {moment.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 rounded-[24px] border border-primary/25 bg-primary/10 p-5 backdrop-blur-md">
                <div className="text-xs font-medium uppercase tracking-[0.24em] text-primary-foreground/70">
                  {t("Connected stack")}
                </div>
                <div className="mt-3 text-2xl font-semibold tracking-tight text-white">
                  {t("TMS, ELD, accounting, and customer comms in one flow.")}
                </div>
                <div className="mt-3 text-sm leading-6 text-sidebar-foreground/65">
                  {t(
                    "Teams stop chasing updates across tabs and start making decisions from one shared\r\n                  operating picture.",
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4">
          {networkStats.map((stat) => (
            <Stat key={stat.label} icon={stat.icon} value={stat.value} label={stat.label} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
      <div className="text-[11px] uppercase tracking-[0.22em] text-sidebar-foreground/50">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs text-sidebar-foreground/55">{hint}</div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-lg border border-sidebar-border/40 bg-sidebar-accent/30 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-sidebar-foreground/70">
        {icon}
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
