import { Temporal } from "@js-temporal/polyfill";
import { getService } from "../repositories/services.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { getSql } from "../../../../packages/db/src/index.js";

type DayHours={day:number;enabled:boolean;open:string;close:string};
type AvailabilitySettings={timezone:string;slotIntervalMinutes:number;weeklyHours:DayHours[];blackoutDates:string[]};
const defaults:AvailabilitySettings={timezone:"America/New_York",slotIntervalMinutes:30,weeklyHours:[
 {day:0,enabled:false,open:"08:00",close:"17:00"},{day:1,enabled:true,open:"08:00",close:"17:00"},{day:2,enabled:true,open:"08:00",close:"17:00"},{day:3,enabled:true,open:"08:00",close:"17:00"},{day:4,enabled:true,open:"08:00",close:"17:00"},{day:5,enabled:true,open:"08:00",close:"17:00"},{day:6,enabled:true,open:"08:00",close:"17:00"}],blackoutDates:[]};

async function settings():Promise<AvailabilitySettings>{const sql=getSql();const rows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='availability' LIMIT 1`;return {...defaults,...(rows[0]?.value as Partial<AvailabilitySettings>|undefined)}}
function atLocalTime(date:string,time:string,zone:string){return Temporal.ZonedDateTime.from(`${date}T${time}:00[${zone}]`)}

export async function getAvailability(input:{serviceId:string;date:string}){
 const service=await getService(input.serviceId); if(!service||!service.active)return null;
 const config=await settings();
 if(config.blackoutDates.includes(input.date))return {serviceId:service.id,date:input.date,durationMinutes:service.defaultDurationMinutes,timezone:config.timezone,slots:[]};
 const midday=Temporal.ZonedDateTime.from(`${input.date}T12:00:00[${config.timezone}]`);
 const hours=config.weeklyHours.find(x=>x.day===midday.dayOfWeek%7);
 if(!hours?.enabled)return {serviceId:service.id,date:input.date,durationMinutes:service.defaultDurationMinutes,timezone:config.timezone,slots:[]};
 const open=atLocalTime(input.date,hours.open,config.timezone),close=atLocalTime(input.date,hours.close,config.timezone),slots=[];
 for(let cursor=open;Temporal.ZonedDateTime.compare(cursor.add({minutes:service.defaultDurationMinutes}),close)<=0;cursor=cursor.add({minutes:config.slotIntervalMinutes})){
  const end=cursor.add({minutes:service.defaultDurationMinutes}),startDate=new Date(cursor.epochMilliseconds),endDate=new Date(end.epochMilliseconds);
  if(!(await hasAppointmentConflict(startDate,endDate)))slots.push({start:startDate.toISOString(),end:endDate.toISOString()});
 }
 return {serviceId:service.id,date:input.date,durationMinutes:service.defaultDurationMinutes,timezone:config.timezone,slots};
}
