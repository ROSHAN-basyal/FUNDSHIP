import { adToBs, bsToAd } from '@sbmdkl/nepali-date-converter';

const BS_MONTHS = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];

function pad(value:number) { return String(value).padStart(2,'0'); }

export function localAdDate(date:Date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

export function bsFromDate(date:Date) {
  return String(adToBs(localAdDate(date)));
}

export function adFromBs(value:string) {
  return bsToAd(value);
}

export function formatBs(value:string) {
  const [year,month,day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${BS_MONTHS[month-1]} ${year} BS`;
}

export function bsDateTime(dateString:string) {
  const date = new Date(dateString);
  return `${formatBs(bsFromDate(date))} · ${date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
}

export function relativeDateChoices(now = new Date()) {
  return Array.from({length:7},(_,offset) => {
    const date = new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
    const label = offset===0 ? 'Today' : offset===1 ? 'Tomorrow' : `Coming ${date.toLocaleDateString('en-US',{weekday:'long'})}`;
    return { value:String(offset), label, date, bsDate:bsFromDate(date) };
  });
}

export function bsMonthLength(year:number,month:number) {
  for (let day=32;day>=28;day--) {
    try { bsToAd(`${year}-${pad(month)}-${pad(day)}`); return day; } catch { /* try the previous day */ }
  }
  return 30;
}

export function eventIsoFromSelection(dayOffset:string,time:string,manualBs:string) {
  const adDate = dayOffset === 'manual'
    ? adFromBs(manualBs)
    : localAdDate(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+Number(dayOffset)));
  return new Date(`${adDate}T${time}:00`).toISOString();
}
