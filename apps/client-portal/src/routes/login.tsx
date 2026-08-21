import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, Lock, Mail, KeyRound } from "lucide-react";
import { confirmResetPassword, confirmSignIn, resetPassword } from "aws-amplify/auth";
import { toast } from "sonner";

import { AppLogoMark } from "@/components/app-logo-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { DISPATCH_APP_URL } from "@/lib/external-links";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Step = "signIn" | "newPassword" | "forgotRequest" | "forgotConfirm";

const LAST_EMAIL_KEY = "client-portal.last-email";

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastEmail(value: string) {
  try {
    if (value.trim()) localStorage.setItem(LAST_EMAIL_KEY, value.trim());
  } catch {
    /* ignore */
  }
}

function LoginPage() {
  useEffect(() => {
    document.title = "Sign in — Titan Freight Client";
  }, []);

  const navigate = useNavigate();
  const { signIn, refresh, status, cancelSignInChallenge } = useAuth();
  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      void navigate({ to: "/", replace: true });
    }
  }, [status, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter your email and password");
      return;
    }
    writeLastEmail(email);
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.isSignedIn) {
        toast.success("Signed in");
        void navigate({ to: "/", replace: true });
        return;
      }
      const nextStep = result.nextStep?.signInStep;
      if (nextStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setStep("newPassword");
        toast.message("Set a new permanent password to finish signing in.");
        return;
      }
      if (nextStep && nextStep !== "DONE") {
        toast.error("Additional sign-in steps required", {
          description: nextStep.replaceAll("_", " "),
        });
        return;
      }
      toast.error("Sign-in incomplete");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Check your email and password.";
      toast.error("Sign-in failed", { description: message });
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
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (result.isSignedIn) {
        await refresh();
        toast.success("Password updated. Signed in.");
        void navigate({ to: "/", replace: true });
        return;
      }
      toast.error(`Additional step required: ${result.nextStep?.signInStep ?? "unknown"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set new password");
    } finally {
      setLoading(false);
    }
  };

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
      toast.success("Reset code sent", { description: `Check ${dest} for a verification code.` });
    } catch (err) {
      toast.error("Couldn’t send reset email", {
        description: err instanceof Error ? err.message : "Ask your broker to reset the password.",
      });
    } finally {
      setLoading(false);
    }
  };

  const onForgotConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetCode.trim() || newPassword.length < 8 || newPassword !== confirmPassword) {
      toast.error("Enter the code and matching passwords (8+ characters).");
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

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #0369a1 0%, transparent 42%), radial-gradient(circle at 80% 80%, #e85d04 0%, transparent 36%)",
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <AppLogoMark className="h-10 w-10 rounded-md bg-white/10 p-1" />
          <div>
            <div className="text-sm font-bold">Titan Freight</div>
            <div className="text-xs text-white/70">Client portal</div>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky">Live freight</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
            Watch the truck. See the tax.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/75">
            One screen for every active shipment your broker assigned to you — map, status, and the
            tax on the move.
          </p>
        </div>
        <p className="relative z-10 text-xs text-white/50">
          © {new Date().getFullYear()} Titan Freight, Inc.
        </p>
      </aside>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <AppLogoMark className="h-9 w-9 rounded-md" />
          <div className="font-heading text-sm font-bold">Titan Freight</div>
          <Badge variant="sky" className="ml-auto">
            Client
          </Badge>
        </div>

        <h2 className="text-2xl font-bold tracking-tight">
          {step === "signIn"
            ? "Sign in"
            : step === "newPassword"
              ? "Set a new password"
              : step === "forgotRequest"
                ? "Forgot password"
                : "Enter reset code"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {step === "signIn"
            ? "Use the account your broker created for your company."
            : step === "newPassword"
              ? "Your temporary password must be replaced before you can continue."
              : step === "forgotRequest"
                ? "We’ll email a verification code to reset your password."
                : `Enter the code sent to ${email}, then choose a new password.`}
        </p>

        {step === "signIn" ? (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="h-11 pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  className="cursor-pointer text-xs font-medium text-sky hover:underline"
                  onClick={() => setStep("forgotRequest")}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="h-11 px-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? (
                "Signing in…"
              ) : (
                <>
                  Sign in <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        ) : null}

        {step === "newPassword" ? (
          <form onSubmit={onConfirmNewPassword} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className="h-11"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                className="h-11"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Saving…" : "Save password & continue"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={loading}
              onClick={() => {
                void cancelSignInChallenge();
                setStep("signIn");
              }}
            >
              Back to sign in
            </Button>
          </form>
        ) : null}

        {step === "forgotRequest" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendResetCode();
            }}
            className="mt-8 space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">Work email</Label>
              <Input
                id="forgot-email"
                type="email"
                className="h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep("signIn")}
            >
              Back to sign in
            </Button>
          </form>
        ) : null}

        {step === "forgotConfirm" ? (
          <form onSubmit={onForgotConfirm} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-code">Verification code</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reset-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-11 pl-9 font-mono"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-new-password">New password</Label>
              <Input
                id="forgot-new-password"
                type="password"
                className="h-11"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-confirm-password">Confirm password</Label>
              <Input
                id="forgot-confirm-password"
                type="password"
                className="h-11"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Updating…" : "Update password"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => void sendResetCode()}
            >
              Resend code
            </Button>
          </form>
        ) : null}

        <Separator className="my-8" />
        <a
          href={DISPATCH_APP_URL}
          className="text-center text-xs font-medium text-sky hover:underline"
        >
          Broker or ops team? Sign in to the operations console →
        </a>
      </div>
    </div>
  );
}
