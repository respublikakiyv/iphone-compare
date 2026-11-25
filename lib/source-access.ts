// Distinguish a retailer's challenge page from product HTML; never parse it as stock data.
export function isSourceChallenge(headers:Pick<Headers,'get'>,html=''){
 return headers.get('cf-mitigated')?.toLowerCase()==='challenge'||/<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(html)&&/cdn-cgi\/challenge-platform|challenges\.cloudflare\.com/i.test(html);
}
