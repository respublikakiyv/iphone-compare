// Decode only the selected public Nuxt product; never execute page scripts.
export function decodeNuxtProduct(text:string,slug:string):any{
 try{
  const entries=JSON.parse(text);if(!Array.isArray(entries)||entries.length>40000)return null;
  const memo=new Map<number,any>();let count=0;
  function read(i:number,depth=0):any{
   if(i<0)return null;if(!Number.isInteger(i)||i>=entries.length||depth>80||++count>100000)throw Error('invalid_graph');
   if(memo.has(i))return memo.get(i);const value=entries[i];
   if(Array.isArray(value)){
    if(typeof value[0]==='string'){if(!['ShallowReactive','Reactive','Ref','ShallowRef'].includes(value[0]))return null;return read(value[1],depth+1);}
    const result:any[]=[];memo.set(i,result);for(const ref of value)result.push(read(ref,depth+1));return result;
   }
   if(value&&typeof value==='object'){const result=Object.create(null);memo.set(i,result);for(const [key,ref]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))continue;result[key]=read(ref as number,depth+1);}return result;}
   return value;
  }
  // Find the selected PDP payload by its route key, not another product's price.
  const refs=entries.flatMap((e:any)=>e&&!Array.isArray(e)&&typeof e==='object'?Object.entries(e).filter(([k])=>(k.startsWith('pdp-v2-product-'+slug+'-')||k.startsWith('product-page-'+slug+'-'))).map(([,v])=>v):[]);
  const products=refs.map(ref=>{const data=read(ref as number);return data?.product||data;}).filter(p=>p&&p.slug===slug&&typeof p.sku==='string');if(products.length!==1)return null;return products[0];
 }catch{return null;}
}
