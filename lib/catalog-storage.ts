// Lossless compression keeps a large Apple catalog below the database row limit.
export async function packCatalog(catalog:any){
 const raw=JSON.stringify(catalog);if(new TextEncoder().encode(raw).length<700000)return raw;
 const bytes=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const payload=JSON.stringify({encoding:'gzip-base64-v1',data:btoa(binary)});if(payload.length>1800000)throw Error('catalog_storage_limit');return payload;
}
export async function unpackCatalog(payload:string){
 const value=JSON.parse(payload);if(value.encoding!=='gzip-base64-v1')return value;
 const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000000){await reader.cancel();throw Error('catalog_storage_limit');}chunks.push(value);}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(out));
}
