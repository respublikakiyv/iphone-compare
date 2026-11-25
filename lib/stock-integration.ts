import {env} from 'cloudflare:workers';
import {AsyncLocalStorage} from 'node:async_hooks';
const manualContext=new AsyncLocalStorage<boolean>();
export const stockManualOnly=()=>['manual','on-open'].includes(String((env as any).MOYSKLAD_MODE).toLowerCase());
export const stockIntegrationPaused=()=>String((env as any).MOYSKLAD_DISABLED).toLowerCase()==='true';
export const stockOnOpenEnabled=()=>!stockIntegrationPaused()&&String((env as any).MOYSKLAD_MODE).toLowerCase()==='on-open';
export const stockRealtimeEnabled=()=>!stockIntegrationPaused()&&String((env as any).MOYSKLAD_MODE).toLowerCase()==='realtime';
export const stockAutomaticPaused=()=>stockIntegrationPaused()||stockManualOnly();
export const stockPausedMessage='МойСклад временно отключён. Показаны сохранённые остатки.';
export const stockManualMessage='Остатки обновляются только кнопкой внизу карточки или «Обновить все остатки».';
export const isManualStockUpdate=()=>manualContext.getStore()===true;
export function requireStockIntegration(){if(stockIntegrationPaused()||stockManualOnly()&&!manualContext.getStore())throw Error(stockManualOnly()?stockManualMessage:stockPausedMessage);}
// Only explicit stock POST actions may enter this request-scoped context.
export function withManualStockUpdate<T>(action:()=>Promise<T>){return manualContext.run(true,action);}
