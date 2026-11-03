/** Small literal matcher for bilingual editorial terms; no model and no semantic score. */
type Terms={keywords?:string[];keywords_zh?:string[];keywords_en?:string[]};
export const questionKeywords=(q:Terms)=>[...new Set([...(q.keywords??[]),...(q.keywords_zh??[]),...(q.keywords_en??[])])];
export const hasEnglishKeyword=(q:Terms)=>questionKeywords(q).some(term=>/[a-z]{2}/i.test(term));
function singular(word:string){
  if(word.length>4&&word.endsWith('ies'))return word.slice(0,-3)+'y';
  if(/(?:xes|ches|shes|sses|zes)$/.test(word))return word.slice(0,-2);
  return word.length>3&&word.endsWith('s')&&!/(ss|us|is)$/.test(word)?word.slice(0,-1):word;
}
const english=(text:string)=>text.toLowerCase().match(/[a-z0-9]+/g)?.map(singular)??[];
export function keywordMatch(q:Terms,text:string){
  const words=english(text).join(' '),lower=text.toLowerCase();
  return questionKeywords(q).filter(term=>{
    if(/^[a-z0-9\s-]+$/i.test(term)){const phrase=english(term).join(' ');return phrase!==''&&(` ${words} `).includes(` ${phrase} `);}
    return lower.includes(term.toLowerCase());
  }).length;
}
