import {stockCategory,stockWarehouses,type StockRow} from './warehouse-stock.ts';
const base='https://api.moysklad.ru/api/remap/1.2/';
export const usedStockSearch='used-iphone-folder';
// Read every page, including zero stock. Never commit a partially fetched report.
export async function readStockRows(search:string,index:number,read:(url:string)=>Promise<any>,products?:string[]){
 const rows:StockRow[]=[];let offset=0,total=Infinity;
 while(offset<total){
  if(offset>=20000)throw Error('Stock report too large');
  const filter='store='+base+'entity/store/'+stockWarehouses[index].id+';stockMode=all;quantityMode=all'+(products?.length?';'+products.map(href=>href.includes('/variant/')?'variant='+href:'product='+href).join(';'):search===usedStockSearch?';productFolder='+base+'entity/productfolder/4730d7dd-edaf-11e3-ae1a-002590a28eca':search?';search='+search:'');
  const query=new URLSearchParams({filter,limit:'1000',offset:String(offset),groupBy:'variant'}),data=await read(base+'report/stock/all?'+query);
  if(!Array.isArray(data.rows)||!Number.isInteger(data.meta?.size)||data.meta.size<0)throw Error('Invalid stock report');
  total=data.meta.size;if(offset<total&&!data.rows.length)throw Error('Incomplete stock report');
  for(const row of data.rows){if(!stockCategory(row.name||''))continue;const href=row.meta?.href;if(typeof href!=='string'||typeof row.stock!=='number'||!Number.isFinite(row.stock))throw Error('Invalid stock row');rows.push({id:href.split('?')[0],name:row.name,article:row.article,stock:row.stock,folder:[row.folder?.pathName,row.folder?.name].filter(Boolean).join('/')});}
  offset+=data.rows.length;
 }
 return rows;
}
