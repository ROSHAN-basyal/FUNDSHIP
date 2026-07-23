declare module '@sbmdkl/nepali-date-converter' {
  export function adToBs(adDate:string): string;
  export function bsToAd(bsDate:string): string;
  export function calculateAge(bsDate:string): { years:number; months:number; days:number };
}
