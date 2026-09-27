export const EMAIL_FROM_DEFAULT = "MOMS Mobile Oil Change <bookings@momsoilchange.com>";
export const RESEND_EMAIL_API = "https://api.resend.com/emails";

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c));
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function emailShell(input: { eyebrow?: string; title: string; intro?: string; body: string; footerNote?: string }) {
  const eyebrow=input.eyebrow ? `<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;margin-bottom:10px">${escapeHtml(input.eyebrow)}</div>` : "";
  const intro=input.intro ? `<p style="margin:0 0 24px;color:#374151;font-size:16px;line-height:1.6">${escapeHtml(input.intro)}</p>` : "";
  const footer=input.footerNote ? `<p style="margin:0 0 8px">${escapeHtml(input.footerNote)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
      <tr><td style="padding:22px 28px;background:#111827;color:#ffffff">
        <div style="font-size:22px;font-weight:900;letter-spacing:-.02em">MOMS Mobile Oil Change</div>
        <div style="font-size:12px;color:#d1d5db;margin-top:4px">Mobile vehicle service · Established 2013</div>
      </td></tr>
      <tr><td style="padding:32px 28px">
        ${eyebrow}<h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;letter-spacing:-.025em">${escapeHtml(input.title)}</h1>
        ${intro}${input.body}
      </td></tr>
      <tr><td style="padding:20px 28px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.6">
        ${footer}<p style="margin:0">MOMS Mobile Oil Change · Philadelphia area mobile service</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function detailRow(label: string, value: unknown) {
  return `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:38%">${escapeHtml(label)}</td><td style="padding:8px 0;font-size:14px;font-weight:700">${escapeHtml(value)}</td></tr>`;
}

export async function sendResendEmail(input:{to:string[];subject:string;html:string;from?:string}) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)return {sent:false,reason:"not_configured"} as const;
  const response=await fetch(RESEND_EMAIL_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:input.from||process.env.BOOKING_EMAIL_FROM||EMAIL_FROM_DEFAULT,to:input.to,subject:input.subject,html:input.html})});
  if(!response.ok){const body=await response.text();throw new Error(`resend_email_failed:${response.status}:${body.slice(0,300)}`)}
  const payload=await response.json().catch(()=>null) as {id?:string}|null;
  return {sent:true,providerMessageId:payload?.id??null} as const;
}
