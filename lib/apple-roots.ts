import type {AppleCategory} from './apple-products.ts';
import {catalogRoots} from './stores.ts';
export const appleRoots:Record<string,Partial<Record<AppleCategory,string[]>>>={
 iPeople:{ipad:['https://ipeople.ua/apple-ua/ipad'],mac:['https://ipeople.ua/apple-ua/mac'],watch:['https://ipeople.ua/apple-ua/watch'],airpods:['https://ipeople.ua/apple-ua/airpods-ua'],other:['https://ipeople.ua/apple-ua/pereferiya']},
 Jabko:{ipad:['https://jabko.ua/ipad/'],mac:['https://jabko.ua/mac/'],watch:['https://jabko.ua/apple-watch/'],airpods:['https://jabko.ua/apple-airpods/'],other:['https://jabko.ua/gadzheti-i-drugoe/gadzheti-apple/','https://jabko.ua/gadzheti-i-drugoe/apple-airtag212/','https://jabko.ua/aksessuari/aksessuari-dlja-ipad/apple-pencil/']},
 iSpace:{ipad:['https://ispace.ua/category/ipad'],mac:['https://ispace.ua/category/macbook-air','https://ispace.ua/category/macbook-pro','https://ispace.ua/category/macbook-neo','https://ispace.ua/category/imac','https://ispace.ua/category/mac-mini'],watch:['https://ispace.ua/category/apple-watch-series-12','https://ispace.ua/category/apple-watch-series-11','https://ispace.ua/category/apple-watch-ultra','https://ispace.ua/category/apple-watch-se'],airpods:['https://ispace.ua/category/airpods'],other:['https://ispace.ua/category/tv-4k','https://ispace.ua/category/acessories-for-airtag']},
 YA:{ipad:['https://ya.ua/planshety/apple/'],mac:['https://ya.ua/noutbuky/apple/','https://ya.ua/gotovi-zbirki-pk/apple/'],watch:['https://ya.ua/smart-watch/apple/'],airpods:['https://ya.ua/navushnyky/apple/'],other:['https://ya.ua/gadzeti-dlia-domu/apple/']},
 Comfy:{mac:['https://comfy.ua/ua/notebook/brand__apple/'],ipad:['https://comfy.ua/ua/plane-table-computer/brand__apple/'],watch:['https://comfy.ua/ua/smart-watches/brand__apple/'],airpods:['https://comfy.ua/ua/nayshniki/brand__apple__nayshniki__airpods/']},
 Foxtrot:{ipad:['https://www.foxtrot.com.ua/uk/shop/planshety_apple.html'],mac:['https://www.foxtrot.com.ua/uk/shop/noutbuki_apple.html'],watch:['https://www.foxtrot.com.ua/uk/shop/smart_chasi_apple.html'],airpods:['https://www.foxtrot.com.ua/uk/shop/naushniki_apple.html']}
};
export function rootCategory(store:string,url:string):AppleCategory|null{
 const path=new URL(url).pathname.replace(/\/$/,'');
 for(const [category,urls]of Object.entries({...appleRoots[store],iphone:[catalogRoots[store]]}))for(const root of urls||[]){const r=new URL(root).pathname.replace(/\/$/,'');if(path===r||path.startsWith(r+'/'))return category as AppleCategory;}
 return null;
}
export function rootsFor(store:string,category:AppleCategory|'all'='all'){
 if(category==='iphone')return [catalogRoots[store]];
 if(category!=='all')return appleRoots[store]?.[category]||[catalogRoots[store]];
 return [...new Set([catalogRoots[store],...Object.values(appleRoots[store]||{}).flat()])];
}
