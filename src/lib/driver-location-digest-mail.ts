export type DigestGps = {
  lat: number;
  lng: number;
  lastPingAt: string;
  fresh: boolean;
};

export type DigestLoadRow = {
  loadId: string;
  driverName: string;
  customer: string;
  lane: string;
  status: string;
  gps: DigestGps | null;
};

export type DigestMail = {
  subject: string;
  html: string;
  text: string;
};

function mapsUrl(gps: DigestGps): string {
  return `https://maps.google.com/?q=${gps.lat},${gps.lng}`;
}

function formatWhen(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(at));
}

function coords(gps: DigestGps): string {
  return `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
}

/**
 * The email a dispatcher actually reads: where each truck is, or that it is
 * not sharing. Pure so the cron and the tests share one renderer.
 */
export function renderDriverLocationDigest(
  companyName: string,
  generatedAt: string,
  rows: DigestLoadRow[],
): DigestMail {
  const tracked = rows.filter((row) => row.gps).length;
  const subject = `${companyName}: ${tracked} of ${rows.length} loads reporting location`;

  const textLines = [
    `${companyName} — driver location update`,
    `As of ${formatWhen(generatedAt)}`,
    "",
  ];
  if (rows.length === 0) {
    textLines.push("No active loads right now.");
  } else {
    for (const row of rows) {
      textLines.push(`${row.loadId} · ${row.driverName} · ${row.lane}`);
      textLines.push(`  ${row.status} · ${row.customer}`);
      if (row.gps) {
        textLines.push(
          `  ${row.gps.fresh ? "Live" : "Last known"} ${coords(row.gps)} at ${formatWhen(row.gps.lastPingAt)}`,
        );
        textLines.push(`  ${mapsUrl(row.gps)}`);
      } else {
        textLines.push("  No live GPS from the driver.");
      }
      textLines.push("");
    }
  }

  const bodyRows =
    rows.length === 0
      ? `<tr><td colspan="4" style="padding:12px;color:#64748b">No active loads right now.</td></tr>`
      : rows
          .map((row) => {
            const location = row.gps
              ? `<a href="${mapsUrl(row.gps)}">${row.gps.fresh ? "Live" : "Last known"} ${coords(row.gps)}</a><br/><span style="color:#64748b;font-size:12px">${formatWhen(row.gps.lastPingAt)}</span>`
              : `<span style="color:#64748b">No live GPS</span>`;
            return `<tr>
              <td style="padding:10px 12px;border-top:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:13px">${escapeHtml(row.loadId)}<br/><span style="color:#64748b;font-size:12px">${escapeHtml(row.driverName)}</span></td>
              <td style="padding:10px 12px;border-top:1px solid #e2e8f0;font-size:13px">${escapeHtml(row.lane)}<br/><span style="color:#64748b;font-size:12px">${escapeHtml(row.status)}</span></td>
              <td style="padding:10px 12px;border-top:1px solid #e2e8f0;font-size:13px">${escapeHtml(row.customer)}</td>
              <td style="padding:10px 12px;border-top:1px solid #e2e8f0;font-size:13px">${location}</td>
            </tr>`;
          })
          .join("");

  const html = `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <tr><td style="padding:20px 24px;background:#0f172a;color:#f8fafc">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Titan Freight</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${escapeHtml(companyName)}</div>
          <div style="font-size:13px;margin-top:6px;opacity:.8">Driver locations as of ${escapeHtml(formatWhen(generatedAt))}</div>
        </td></tr>
        <tr><td style="padding:0">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">Load</th>
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">Lane</th>
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">Customer</th>
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">Where</th>
            </tr>
            ${bodyRows}
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text: textLines.join("\n") };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
