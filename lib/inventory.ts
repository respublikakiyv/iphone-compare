import {categoryOf} from './apple-products.ts';
import type {Product} from './catalog.ts';
export type Inventory='new'|'used';
export const edition=(p:Product)=>p.edition||'Standard';
export const currentModel=(model:string)=>{const n=/^(\d+)/.exec(model);return n?Number(n[1])>=1:['Air','Air 2','Duo','X','XR','XS','XS Max','SE','SE 2020','SE 2022'].includes(model);};
export const isUsedAir=(model:string)=>/^(?:\d+\s+)?Air(?:\s+\d+)?$/i.test(model);
export const usedSimAllowed=(model:string,sim:string)=>isUsedAir(model)?sim==='esim':sim==='physical';
export const belongs=(p:Product,scope:Inventory)=>scope==='used'?edition(p)==='Used'&&p.store==='iPeople'&&usedSimAllowed(p.model,p.sim):(edition(p)==='Standard'||edition(p)==='OpenBox'&&categoryOf(p)==='mac'&&!!p.stock_id)&&(categoryOf(p)!=='iphone'||currentModel(p.model));
export const keepProduct=(p:Product)=>belongs(p,'new')||belongs(p,'used');
