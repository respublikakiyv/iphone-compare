import {stockCategory,type StockRow} from './warehouse-stock.ts';
const base='https://api.moysklad.ru/api/remap/1.2/';
// The user's Apple folders, including used phones. Quantities come exclusively
// from the short per-warehouse report; assortment is only a daily identity map.
const folders=['2a1b0ff5-4d41-11e8-9ff4-3150002666c8','4730d7dd-edaf-11e3-ae1a-002590a28eca','a1702cfb-327b-11f1-0a80-09e50010d221','40cfbdce-ae4d-11f0-0a80-16bd0005a42a','a105582c-b017-11f0-0a80-0d700025b1a9','2413cbc6-193b-11f1-0a80-1a860008bfe4','1da2b6bb-22e7-11f1-0a80-141800148eda','d810ffa8-b005-11f0-0a80-0c0d00226a29','98c29589-2ce3-11f1-0a80-023e000bd628','63c3b70c-088f-11ea-0a80-02480004d6eb'];
export async function readStockMetadata(read:(url:string)=>Promise<any>){
 const filter=folders.map(id=>'productFolder='+base+'entity/productfolder/'+id).join(';')+';type=product;type=variant;withSubFolders=true';
 const page=async(offset:number)=>{const data=await read(base+'entity/assortment?'+new URLSearchParams({filter,limit:'1000',offset:String(offset)}));if(!Array.isArray(data.rows)||!Number.isInteger(data.meta?.size)||data.meta.size>20000||data.rows.length!==Math.min(1000,Math.max(0,data.meta.size-offset)))throw Error('Incomplete stock metadata');return data;};
 const first=await page(0),all=[...first.rows];
 for(let offset=1000;offset<first.meta.size;offset+=3000){const pages=await Promise.all([offset,offset+1000,offset+2000].filter(n=>n<first.meta.size).map(page));for(const p of pages){if(p.meta.size!==first.meta.size)throw Error('Stock metadata changed during discovery');all.push(...p.rows);}}
 const rows:StockRow[]=[];
 for(const r of all){if(!stockCategory(r.name||''))continue;const id=r.meta?.href?.split('?')[0];if(typeof id!=='string')throw Error('Invalid stock metadata');rows.push({id,name:r.name,article:r.article,folder:r.pathName||r.product?.pathName||'',stock:0});}
 return {rows,checkedAt:new Date().toISOString()};
}
