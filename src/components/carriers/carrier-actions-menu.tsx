import * as React from "react";
import { toast } from "sonner";
import {
  Award,
  Ban,
  CheckCircle2,
  FileSignature,
  Loader2,
  MoreHorizontal,
  Send,
  ShieldCheck,
  ShieldOff,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  grantAutoAwardOverride,
  hasActiveAutoAwardOverride,
  inviteCarrierToPortal,
  isManagerRole,
  revokeAutoAwardOverride,
  sendCarrierRateConfirmation,
  setCarrierBlacklisted,
  setCarrierTier,
  verifyCarrierInsurance,
  type CarrierRecord,
  type CarrierTier,
} from "@/lib/carriers-store";
import { TIER_LABELS } from "@/lib/carriers-display";

const TIERS: CarrierTier[] = ["none", "preferred", "core", "strategic"];

export function CarrierActionsMenu({
  carrier,
  role,
  onChanged,
}: {
  carrier: CarrierRecord;
  /** Current user's role (e.g. from profile permissions) — controls Manager-only override actions. */
  role?: string;
  onChanged: (updated: CarrierRecord) => void;
}) {
  const { user } = useAuth();
  const [pending, setPending] = React.useState<string | null>(null);
  const [blacklistDialogOpen, setBlacklistDialogOpen] = React.useState(false);
  const [blacklistReason, setBlacklistReason] = React.useState("");
  const [overrideDialogOpen, setOverrideDialogOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");

  const isManager = isManagerRole(role);
  const isBlacklisted = Boolean(carrier.blacklisted);
  const hasOverride = hasActiveAutoAwardOverride(carrier);

  const run = async (key: string, fn: () => Promise<CarrierRecord>, successMessage: string) => {
    setPending(key);
    try {
      const updated = await fn();
      onChanged(updated);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  };

  const handleTier = (tier: CarrierTier) =>
    run("tier", () => setCarrierTier(carrier.carrierId, tier, user), `Tier set to ${TIER_LABELS[tier].label}`);

  const handleInvite = () =>
    run("invite", () => inviteCarrierToPortal(carrier.carrierId, user), "Portal invite sent");

  const handleVerifyInsurance = () =>
    run("verify", () => verifyCarrierInsurance(carrier.carrierId, user), "Insurance verification checked");

  const handleRateConfirmation = () =>
    run(
      "rate-con",
      () => sendCarrierRateConfirmation(carrier.carrierId, user),
      "Rate confirmation sent",
    );

  const submitBlacklist = async () => {
    await run(
      "blacklist",
      () => setCarrierBlacklisted(carrier.carrierId, true, user, blacklistReason.trim() || undefined),
      "Carrier blacklisted",
    );
    setBlacklistDialogOpen(false);
    setBlacklistReason("");
  };

  const handleUnblacklist = () =>
    run("unblacklist", () => setCarrierBlacklisted(carrier.carrierId, false, user), "Carrier reinstated");

  const submitOverride = async () => {
    await run(
      "override",
      () => grantAutoAwardOverride(carrier.carrierId, user, overrideReason.trim() || "Manager override"),
      "Auto-award override granted",
    );
    setOverrideDialogOpen(false);
    setOverrideReason("");
  };

  const handleRevokeOverride = () =>
    run("revoke-override", () => revokeAutoAwardOverride(carrier.carrierId, user), "Override revoked");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${carrier.companyName}`}
            disabled={pending !== null}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Routing guide</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Award className="mr-0" />
              Set tier
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TIERS.map((tier) => (
                <DropdownMenuItem key={tier} onSelect={() => handleTier(tier)}>
                  {TIER_LABELS[tier].label}
                  {carrier.tier === tier ? " ✓" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Portal & compliance</DropdownMenuLabel>
          <DropdownMenuItem onSelect={handleInvite} disabled={carrier.portalInviteStatus !== "not-invited"}>
            <UserPlus className="mr-0" />
            Invite to portal
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleVerifyInsurance}>
            <ShieldCheck className="mr-0" />
            Verify insurance (API)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleRateConfirmation}>
            <Send className="mr-0" />
            Send rate confirmation
          </DropdownMenuItem>

          {isManager && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Manager override</DropdownMenuLabel>
              {hasOverride ? (
                <DropdownMenuItem onSelect={handleRevokeOverride}>
                  <ShieldOff className="mr-0" />
                  Revoke auto-award override
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setOverrideDialogOpen(true)}>
                  <FileSignature className="mr-0" />
                  Grant auto-award override
                </DropdownMenuItem>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          {isBlacklisted ? (
            <DropdownMenuItem onSelect={handleUnblacklist}>
              <CheckCircle2 className="mr-0" />
              Remove from blacklist
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => setBlacklistDialogOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Ban className="mr-0" />
              Blacklist carrier
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={blacklistDialogOpen} onOpenChange={setBlacklistDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Blacklist {carrier.companyName}?</DialogTitle>
            <DialogDescription>
              Blacklisted carriers are blocked from auto-award and new tenders. This can be reversed later.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={blacklistReason}
            onChange={(e) => setBlacklistReason(e.target.value)}
            placeholder="Reason (e.g. cargo claim, safety violation)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlacklistDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending === "blacklist"} onClick={() => void submitBlacklist()}>
              {pending === "blacklist" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Blacklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant auto-award override</DialogTitle>
            <DialogDescription>
              This carrier's insurance has expired. Granting an override allows auto-award to proceed
              despite the expired policy. Only Managers can do this.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Reason for override"
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending === "override"} onClick={() => void submitOverride()}>
              {pending === "override" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
