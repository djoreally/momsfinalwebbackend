import { getSql } from "../../../../packages/db/src/index.js";

export type BookingPolicy={
  bookingEnabled:boolean;
  allowSameDay:boolean;
  minimumLeadMinutes:number;
  maximumAdvanceDays:number;
  maxVehiclesPerBooking:number;
  timezone:string;
};

const defaults:BookingPolicy={
  bookingEnabled:true,
  allowSameDay:false,
  minimumLeadMinutes:0,
  maximumAdvanceDays:90,
  maxVehiclesPerBooking:10,
  timezone:"America/New_York",
};

export async function getBookingPolicy():Promise<BookingPolicy>{
  const sql=getSql();
  const [bookingRows,businessRows]=await Promise.all([
    sql`SELECT value FROM moms_ops.operational_settings WHERE key='booking' LIMIT 1`,
    sql`SELECT value FROM moms_ops.operational_settings WHERE key='business' LIMIT 1`,
  ]);
  const booking=(bookingRows[0]?.value as Partial<BookingPolicy>|undefined)??{};
  const business=(businessRows[0]?.value as {timezone?:string}|undefined)??{};
  return {...defaults,...booking,timezone:business.timezone||defaults.timezone};
}

function localDay(date:Date,timeZone:string){
  return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}

export function bookingTimingError(start:Date,policy:BookingPolicy,now=new Date()):string|null{
  if(!policy.bookingEnabled)return "booking_disabled";
  if(start.getTime()<now.getTime()+policy.minimumLeadMinutes*60_000)return "booking_lead_time";
  if(start.getTime()>now.getTime()+policy.maximumAdvanceDays*86_400_000)return "booking_too_far_ahead";
  if(!policy.allowSameDay&&localDay(start,policy.timezone)===localDay(now,policy.timezone))return "same_day_booking_disabled";
  return null;
}
