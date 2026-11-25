import {AsyncLocalStorage} from 'node:async_hooks';
const contexts=new AsyncLocalStorage<{waitUntil(task:Promise<unknown>):void}>();
export const runWithBackground=<T>(ctx:{waitUntil(task:Promise<unknown>):void},run:()=>T)=>contexts.run(ctx,run);
export function background(task:()=>Promise<unknown>){const ctx=contexts.getStore();if(!ctx)throw Error('Background context unavailable');ctx.waitUntil(task().catch(e=>console.error('Stock background update failed',e instanceof Error?e.message:'unknown')));}
