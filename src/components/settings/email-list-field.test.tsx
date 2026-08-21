import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailListField } from "./email-list-field";

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("EmailListField", () => {
  it("shows the addresses Resend will fetch from the field", () => {
    const text = textOf(
      renderToStaticMarkup(
        <EmailListField
          label="Resend recipient emails"
          value="ops@oakwell.com, dispatch@oakwell.com"
          onChange={() => {}}
        />,
      ),
    );
    expect(text).toContain("ops@oakwell.com");
    expect(text).toContain("dispatch@oakwell.com");
  });

  it("says so when the box has text but no real email", () => {
    const text = textOf(
      renderToStaticMarkup(
        <EmailListField label="Resend recipient emails" value="Ops Managers" onChange={() => {}} />,
      ),
    );
    expect(text).toContain("No valid email addresses yet");
  });
});
