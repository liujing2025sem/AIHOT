/** Set only after the operator confirms U2. Empty means ownership is unknown. */
export const editorialOwnedDomains: readonly string[] = ['chipshow.com','chipshow.eu','chipshowledusa.com','unishineled.com'];
export function pageOwnership(url:string,domains:readonly string[]=editorialOwnedDomains):'own'|'competitor'|'unknown'{
  if(!domains.length)return 'unknown';
  try{const host=new URL(url).hostname.toLowerCase();return domains.some(d=>{const domain=d.toLowerCase().replace(/^www\./,'');return host===domain||host.endsWith('.'+domain);})?'own':'competitor';}catch{return 'unknown';}
}
