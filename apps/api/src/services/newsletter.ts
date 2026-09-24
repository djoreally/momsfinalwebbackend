import { getSql } from "../../../../packages/db/src/index.js";

const SITE_URL = "https://momsoilchange.com";
const FROM = "MOMS Mobile Oil Change® <support@momsoilchange.com>";
const RESEND_API = "https://api.resend.com/emails";

type SendResult={success:boolean;messageId?:string;error?:string};

async function sendEmail(to:string,subject:string,html:string):Promise<SendResult>{
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)return {success:false,error:"RESEND_API_KEY is not configured"};
  try{
    const response=await fetch(RESEND_API,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({from:FROM,to:[to],subject,html})});
    const body=await response.json().catch(()=>({})) as {id?:string;message?:string};
    if(!response.ok)return {success:false,error:body.message||`Resend HTTP ${response.status}`};
    return {success:true,messageId:body.id};
  }catch(error){return {success:false,error:error instanceof Error?error.message:"Unknown send error"};}
}

function unsubscribeUrl(token:string){return `${SITE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;}
function welcomeHtml(token:string){return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a"><h1>Welcome to MOMS Weekly Car Care</h1><p>Once a week, we’ll send practical maintenance education, safety reminders, seasonal tips and occasional MOMS offers.</p><p><a href="https://momsoilchange.servicewriter.xyz">Book Mobile Service</a></p><p style="font-size:12px;color:#64748b">MOMS Mobile Oil Change® · Serving the Philadelphia area · <a href="${unsubscribeUrl(token)}">Unsubscribe</a></p></body></html>`;}
function campaignHtml(c:any,token:string){const cta=c.cta_label&&c.cta_url?`<p><a href="${c.cta_url}">${c.cta_label}</a></p>`:"";return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a"><p>MOMS Mobile Oil Change® · Week ${c.week_number}</p><h1>${c.headline}</h1><p>${c.body_html}</p>${cta}<p style="font-size:12px;color:#64748b">You subscribed to MOMS maintenance updates. <a href="${unsubscribeUrl(token)}">Unsubscribe</a>.</p></body></html>`;}

export async function subscribeNewsletter(email:string,source="website_footer"){
  const sql=getSql(),normalized=email.trim().toLowerCase();
  const rows=await sql`INSERT INTO newsletter_subscribers(email,source,status,unsubscribed_at,updated_at) VALUES(${normalized},${source},'active',NULL,now()) ON CONFLICT(lower(email)) DO UPDATE SET status='active',unsubscribed_at=NULL,source=EXCLUDED.source,updated_at=now() RETURNING id,email,unsubscribe_token::text`;
  const s=rows[0] as any;if(!s)throw new Error("newsletter_subscriber_create_failed");
  const result=await sendEmail(s.email,"Welcome to MOMS Weekly Car Care",welcomeHtml(s.unsubscribe_token));
  await sql`UPDATE newsletter_subscribers SET welcome_last_attempt_at=now(),welcome_sent_at=${result.success?new Date():null},welcome_message_id=${result.success?result.messageId||null:null},welcome_error=${result.success?null:result.error||"Unknown send error"},updated_at=now() WHERE id=${s.id}::uuid`;
  return {subscriber:{id:s.id,email:s.email},welcomeSent:result.success,welcomeMessageId:result.messageId??null,welcomeError:result.error??null};
}

export async function unsubscribeNewsletter(token:string){
  const sql=getSql();const rows=await sql`UPDATE newsletter_subscribers SET status='unsubscribed',unsubscribed_at=now(),updated_at=now() WHERE unsubscribe_token=${token}::uuid RETURNING id`;return rows.length>0;
}

export async function runWeeklyNewsletter(){
  const sql=getSql();
  await sql`UPDATE newsletter_campaigns SET status='ready',updated_at=now() WHERE status='sending' AND updated_at < now()-interval '15 minutes'`;
  const claimed=await sql`UPDATE newsletter_campaigns SET status='sending',updated_at=now() WHERE id=(SELECT id FROM newsletter_campaigns WHERE status IN ('ready','failed') AND scheduled_for<=now() ORDER BY scheduled_for ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,week_number,subject,preheader,headline,body_html,cta_label,cta_url`;
  const c=claimed[0] as any;if(!c)return {ok:true,sent:0,failed:0,message:"No newsletter due."};
  const subscribers=await sql`SELECT s.id,s.email,s.unsubscribe_token::text FROM newsletter_subscribers s WHERE s.status='active' AND NOT EXISTS(SELECT 1 FROM newsletter_deliveries d WHERE d.campaign_id=${c.id}::uuid AND d.subscriber_id=s.id AND d.status='sent') ORDER BY s.subscribed_at ASC`;
  let sent=0,failed=0;
  for(const s0 of subscribers as any[]){const result=await sendEmail(s0.email,c.subject,campaignHtml(c,s0.unsubscribe_token));if(result.success){sent++;await sql`INSERT INTO newsletter_deliveries(campaign_id,subscriber_id,provider_message_id,status,sent_at) VALUES(${c.id}::uuid,${s0.id}::uuid,${result.messageId||null},'sent',now()) ON CONFLICT(campaign_id,subscriber_id) DO UPDATE SET provider_message_id=EXCLUDED.provider_message_id,status='sent',sent_at=now(),error_message=NULL`;}else{failed++;await sql`INSERT INTO newsletter_deliveries(campaign_id,subscriber_id,status,error_message) VALUES(${c.id}::uuid,${s0.id}::uuid,'failed',${result.error||"Unknown send error"}) ON CONFLICT(campaign_id,subscriber_id) DO UPDATE SET status='failed',error_message=EXCLUDED.error_message`;}}
  const remaining=await sql`SELECT count(*)::int AS count FROM newsletter_subscribers s WHERE s.status='active' AND NOT EXISTS(SELECT 1 FROM newsletter_deliveries d WHERE d.campaign_id=${c.id}::uuid AND d.subscriber_id=s.id AND d.status='sent')`;
  const complete=Number((remaining[0] as any)?.count??0)===0;
  await sql`UPDATE newsletter_campaigns SET status=${complete?'sent':'failed'},sent_at=CASE WHEN ${complete} THEN now() ELSE sent_at END,updated_at=now() WHERE id=${c.id}::uuid`;
  return {ok:complete,campaignWeek:c.week_number,subject:c.subject,sent,failed,remaining:Number((remaining[0] as any)?.count??0)};
}
