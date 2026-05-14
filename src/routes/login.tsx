import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Truck, Mail, Lock, ArrowRight, ShieldCheck, Activity, Globe2 } from "lucide-react";
import { confirmSignIn } from "aws-amplify/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Logistics Software" },
      { name: "description", content: "Sign in to your Logistics Software operations console." },
    ],
  }),
  component: LoginPage,
});

type Step = "signIn" | "newPassword";

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, refresh } = useAuth();

  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="min-h-screen w-full bg-background grid lg:grid-cols-2">
      {/* Left: form */}
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-foreground">Logistics Software</div>
            <div className="text-[11px] text-muted-foreground">Operations Console</div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {step === "signIn" ? "Welcome back" : "Set a new password"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "signIn"
              ? "Sign in to manage loads, carriers, and shipments across your network."
              : "Your account requires a new password before continuing."}
          </p>

          {step === "signIn" ? (
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="pl-9 h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a href="#" className="text-xs font-medium text-primary hover:underline">
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pl-9 h-11"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                  Keep me signed in for 30 days
                </Label>
              </div>

              <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={loading}>
                {loading ? "Signing in…" : (<>Sign in<ArrowRight className="ml-1 h-4 w-4" /></>)}
              </Button>

              <div className="relative py-2">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
                  or continue with
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button type="button" variant="outline" className="h-11">SSO / SAML</Button>
                <Button type="button" variant="outline" className="h-11">Google</Button>
              </div>

              <p className="pt-2 text-center text-sm text-muted-foreground">
                New to the platform?{" "}
                <Link to="/" className="font-medium text-primary hover:underline">
                  Request access
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={onConfirmNewPassword} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    className="pl-9 h-11"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={loading}>
                {loading ? "Updating…" : (<>Set password & continue<ArrowRight className="ml-1 h-4 w-4" /></>)}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full text-sm"
                onClick={() => {
                  setStep("signIn");
                  setNewPassword("");
                }}
              >
                Back to sign in
              </Button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Logistics Software, Inc.</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Status</a>
          </div>
        </div>
      </div>

      {/* Right: brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar text-sidebar-foreground p-14">
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

        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border/40 bg-sidebar-accent/40 px-3 py-1 text-xs font-medium backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            All systems operational
          </div>
          <h2 className="mt-8 text-4xl font-semibold leading-tight tracking-tight">
            One operating system for your entire freight network.
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Dispatch, brokerage, tracking, accounting, and analytics — unified
            in a single command center built for modern logistics teams.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4">
          <Stat icon={<Activity className="h-4 w-4" />} value="12,480" label="Active loads" />
          <Stat icon={<Globe2 className="h-4 w-4" />} value="48" label="Countries" />
          <Stat icon={<ShieldCheck className="h-4 w-4" />} value="99.99%" label="Uptime SLA" />
        </div>
      </div>
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
