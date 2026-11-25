import type {load} from 'cheerio/slim';
import {norm} from './product-facts.ts';
// A stock sticker alone can be wrong. Require the selected product's explicit
// zero or empty selected offer, no visible amount, and the store's notification-only action.
export function iPeopleNoOffer($:ReturnType<typeof load>,product:any){
 const offer=product?.offers,hidden=$('input[type="hidden"][name="product_price"]');
 const zeroSchema=!!offer&&!Array.isArray(offer)&&offer.priceCurrency==='UAH'&&['string','number'].includes(typeof offer.price)&&String(offer.price).trim()!==''&&Number(offer.price)===0;
 const emptyForm=!offer&&hidden.length===1&&['','0'].includes(norm(hidden.attr('value')||''))&&$('#product').length===1;
 const notifications=zeroSchema?$('button.sc-product-one-click-btn'):$('#product button.sc-product-one-click-btn');
 if(!(zeroSchema||emptyForm)||!$('.sc-module-price.uah').toArray().every(e=>!/[0-9]/.test($(e).text())))return null;
 const labels=notifications.toArray().map(e=>norm($(e).text()));
 if(labels.includes('Сповістити про наявність'))return 'unavailable';
 return labels.some(label=>['Передзамовлення','Під замовлення'].includes(label))?'unpriced':null;
}
