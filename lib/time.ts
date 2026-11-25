const options:Intl.DateTimeFormatOptions={day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
let displayDate:Intl.DateTimeFormat;
try{displayDate=new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Kyiv'});}
catch{displayDate=new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Kiev'});}
export function timestampMillis(value?:string|null){
 if(!value||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return NaN;
 // Python snapshots can contain microseconds; Safari expects milliseconds.
 return Date.parse(value.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i,'$1'));
}
export function futureTimestamp(value?:string|null,now=Date.now()){return timestampMillis(value)>now+5*60*1000;}
export function formatKyivDate(value?:string|null,now=Date.now()){
 const timestamp=timestampMillis(value);
 return Number.isFinite(timestamp)&&!futureTimestamp(value,now)?displayDate.format(timestamp):null;
}

let priceDate:Intl.DateTimeFormat;
try{priceDate=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Kyiv'});}
catch{priceDate=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Kiev'});}
export function formatPriceDate(value?:string|null,now=Date.now()){
 const stamp=timestampMillis(value);if(!Number.isFinite(stamp)||futureTimestamp(value,now))return null;
 const parts=priceDate.formatToParts(stamp),get=(name:string)=>parts.find(p=>p.type===name)!.value;
 return `${get('day')}.${get('month')} ${Number(get('hour'))}:${get('minute')}`;
}
