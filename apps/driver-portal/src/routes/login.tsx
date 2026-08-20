import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, Lock, Mail, KeyRound } from "lucide-react";
import {
  confirmResetPassword,
  confirmSignIn,
  resetPassword,
} from "aws-amplify/auth";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { AppLogoMark } from "@/components/app-logo-mark";
import { PhoneFrame } from "@/components/shell/phone-frame";
import { InstallAppBanner } from "@/components/shell/install-app-banner";
import { useAuth } from "@/lib/auth";
import { DISPATCH_APP_URL } from "@/lib/external-links";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Step = "signIn" | "newPassword" | "forgotRequest" | "forgotConfirm";

const LAST_EMAIL_KEY = "driver-portal.last-email";

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
    /* ignore quota */
  }
}

function LoginPage() {
  useEffect(() => {
    document.title = "Sign in — Titan Freight Driver";
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
      const message = err instanceof Error ? err.message : "Check your email and password and try again.";
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
      const message = err instanceof Error ? err.message : "Could not set new password";
      toast.error(message);
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
      toast.success("Reset code sent", {
        description: `Check ${dest} for a verification code.`,
      });
    } catch (err) {
      toast.error("Couldn’t send reset email", {
        description: err instanceof Error ? err.message : "Try again or ask an admin to reset.",
      });
    } finally {
      setLoading(false);
    }
  };

  const onForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendResetCode();
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

  const title =
    step === "signIn"
      ? "Welcome back"
      : step === "newPassword"
        ? "Set a new password"
        : step === "forgotRequest"
          ? "Forgot password"
          : "Enter reset code";

  const subtitle =
    step === "signIn"
      ? "Sign in to see your live loads and get started."
      : step === "newPassword"
        ? "Your temporary password must be replaced before you can continue."
        : step === "forgotRequest"
          ? "We’ll email you a verification code to reset your password."
          : `Enter the code sent to ${email}, then choose a new password.`;

  return (
    <PhoneFrame>
      <InstallAppBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        <div className="flex items-center gap-2">
          <AppLogoMark className="h-9 w-9 rounded-md" />
          <div className="font-heading text-sm font-bold text-foreground">Titan Freight</div>
          <Badge className="ml-auto bg-amber font-heading text-[10px] font-bold tracking-wide text-ink">
            Driver
          </Badge>
        </div>

        <div className="flex flex-1 flex-col justify-center py-8">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

          {step === "signIn" ? (
            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@titanfreight.com"
                    className="h-12 pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-amber-dim hover:underline"
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
                    placeholder="********"
                    className="h-12 px-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="h-12 w-full text-sm font-medium" disabled={loading}>
                {loading ? (
                  "Signing in…"
                ) : (
                  <>
                    Sign in <ArrowRight className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="relative py-1">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-[11px] text-muted-foreground">
                  or
                </span>
              </div>

              <Button type="button" variant="outline" className="h-11 w-full" disabled>
                Sign in with company SSO
              </Button>
            </form>
          ) : null}

          {step === "newPassword" ? (
            <form onSubmit={onConfirmNewPassword} className="mt-7 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  className="h-12"
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
                  className="h-12"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="h-12 w-full text-sm font-medium" disabled={loading}>
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
                Back to sign in
              </Button>
            </form>
          ) : null}

          {step === "forgotRequest" ? (
            <form onSubmit={onForgotRequest} className="mt-7 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Work email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    className="h-12 pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <Button type="submit" className="h-12 w-full text-sm font-medium" disabled={loading}>
                {loading ? "Sending…" : "Send reset code"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading}
                onClick={() => setStep("signIn")}
              >
                Back to sign in
              </Button>
            </form>
          ) : null}

          {step === "forgotConfirm" ? (
            <form onSubmit={onForgotConfirm} className="mt-7 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-code">Verification code</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="h-12 pl-9 font-mono"
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
                  autoComplete="new-password"
                  className="h-12"
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
                  autoComplete="new-password"
                  className="h-12"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="h-12 w-full text-sm font-medium" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading}
                onClick={() => void sendResetCode()}
              >
                Resend code
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading}
                onClick={() => {
                  setStep("signIn");
                  setResetCode("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
              >
                Back to sign in
              </Button>
            </form>
          ) : null}
        </div>

        <div className="space-y-3 text-center text-xs text-muted-foreground">
          <a
            href={DISPATCH_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="block font-medium text-amber-dim hover:underline"
          >
            Dispatcher or ops team? Sign in to the operations console →
          </a>
          <p>© {new Date().getFullYear()} Titan Freight, Inc.</p>
        </div>
      </div>
    </PhoneFrame>
  );
}
