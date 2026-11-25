export const primaryStores=['iPeople','Jabko'];
export const optionalStores=['iSpace','YA','Foxtrot','Comfy'];
export const allStores=[...primaryStores,...optionalStores];
export const storeHosts:Record<string,string>={iPeople:'ipeople.ua',Jabko:'jabko.ua',iSpace:'ispace.ua',YA:'ya.ua',Foxtrot:'www.foxtrot.com.ua',Comfy:'comfy.ua'};
export const storeLabels:Record<string,string>={iPeople:'ipeople',Jabko:'jabko',iSpace:'ispace',YA:'ya.ua',Foxtrot:'foxtrot',Comfy:'comfy'};
export const catalogRoots:Record<string,string>={iPeople:'https://ipeople.ua/apple-ua/iphone/',Jabko:'https://jabko.ua/iphone/',iSpace:'https://ispace.ua/category/iphone',YA:'https://ya.ua/smartfony/apple/',Foxtrot:'https://www.foxtrot.com.ua/uk/shop/mobilnye_telefony_apple.html',Comfy:'https://comfy.ua/ua/smartfon/brand__apple/'};
export function safeStoreUrl(raw:string,store:string,base?:string){const u=new URL(raw,base);if(store==='Foxtrot'&&u.hostname==='foxtrot.com.ua')u.hostname='www.foxtrot.com.ua';if(!storeHosts[store]||u.protocol!=='https:'||u.hostname!==storeHosts[store]||u.port||u.username||u.password)throw new Error('foreign_url');u.hash='';if(store==='Comfy'&&/^\/(?:ua\/)?smartfon-[^/]+\.html$/.test(u.pathname))u.pathname='/ua/'+u.pathname.split('/').pop();if((store==='iSpace'||store==='YA')&&u.pathname.startsWith('/product/')||store==='Comfy'&&/^\/(?:ua\/)?smartfon-.*\.html$/.test(u.pathname))u.search='';return u.href;}
export function cleanOptionalStores(value:unknown){if(!Array.isArray(value)||value.length>optionalStores.length||value.some(s=>typeof s!=='string'||!optionalStores.includes(s))||new Set(value).size!==value.length)throw Error('Некорректный список магазинов.');return optionalStores.filter(s=>value.includes(s));}

export function comparisonStores(base:unknown,extras:unknown){return [...primaryStores.filter(s=>Array.isArray(base)&&base.includes(s)),...optionalStores.filter(s=>Array.isArray(extras)&&extras.includes(s))];}
