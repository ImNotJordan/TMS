/**
 * A settings control for the addresses Resend actually sends to.
 *
 * A bare text input hid the fact that this is an address book. Showing the
 * parsed list under the box is what lets an admin confirm "these are the
 * emails the next digest / test send will fetch" before they hit Save.
 */
import { Mail } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseDigestEmails } from "@/lib/digest-emails";
import { t } from "@/lib/i18n/t";
import { Textarea } from "@/components/ui/textarea";

export function EmailListField({
  value,
  onChange,
  label,
  help,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  help?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const emails = parseDigestEmails(value);

  return (
    <label className={cn("space-y-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{t(label)}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ? t(placeholder) : undefined}
        rows={4}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      {emails.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-0.5" aria-label={t("Resend will email")}>
          {emails.map((email) => (
            <li
              key={email.toLowerCase()}
              className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-foreground"
            >
              <Mail className="h-3 w-3 text-primary" aria-hidden />
              {email}
            </li>
          ))}
        </ul>
      ) : value.trim() ? (
        <p className="text-xs font-medium text-destructive">
          {t("No valid email addresses yet. Use commas or one address per line.")}
        </p>
      ) : help ? (
        <p className="text-xs text-muted-foreground">{t(help)}</p>
      ) : null}
      {emails.length > 0 && help ? (
        <p className="text-xs text-muted-foreground">
          {t("Save this page for the list to take effect.")}
        </p>
      ) : null}
    </label>
  );
}
