import fs from 'node:fs';
export async function resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__testCloudflareEnv;',shortCircuit:true};
 if(specifier.startsWith('.')&&context.parentURL){const u=new URL(specifier,context.parentURL);if(!/\.[a-z]+$/.test(u.pathname)&&fs.existsSync(u.pathname+'.ts'))return next(u.href+'.ts',context);}
 return next(specifier,context);
}
