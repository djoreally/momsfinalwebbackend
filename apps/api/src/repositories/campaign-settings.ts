import { getSql } from "../../../../packages/db/src/index.js";

export type ExitIntentSettings = {
  enabled: boolean; delaySeconds: number; exitIntent: boolean; frequency: "session" | "day" | "always";
  eyebrow: string; headline: string; body: string; primaryLabel: string; primaryUrl: string;
  secondaryLabel: string; secondaryUrl: string; imageUrl: string | null;
};
export const DEFAULT_EXIT_INTENT: ExitIntentSettings = {
  enabled:true,delaySeconds:45,exitIntent:true,frequency:"session",eyebrow:"Before you go",
  headline:"Need an oil change without the shop wait?",
  body:"MOMS comes to you. Check service options or call us and we’ll help you figure out the right next step.",
  primaryLabel:"View Oil Change Service",primaryUrl:"/services/oil-change",secondaryLabel:"Call MOMS",
  secondaryUrl:"tel:+12674604077",imageUrl:null
};
export async function getExitIntentSettings(){
 const sql=getSql(); const rows=await sql`SELECT config FROM moms_ops.campaign_settings WHERE campaign_id='exit-intent-v1' LIMIT 1`;
 return {...DEFAULT_EXIT_INTENT,...((rows[0]?.config as Partial<ExitIntentSettings>|undefined)||{})};
}
export async function saveExitIntentSettings(config:ExitIntentSettings){
 const sql=getSql(); await sql`INSERT INTO moms_ops.campaign_settings (campaign_id,config,updated_at) VALUES ('exit-intent-v1',${JSON.stringify(config)}::jsonb,now()) ON CONFLICT (campaign_id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()`;
 return config;
}