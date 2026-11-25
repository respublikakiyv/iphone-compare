'use client';
import {appleCategories,categoryLabels,categoryOf,searchText,searchTokens,type AppleCategory} from '../lib/apple-products';
import {startVisibleStockSync} from '../lib/visible-stock-sync';
import {startVisibleCatalogSync} from '../lib/visible-catalog-sync';
import {readLatestCatalog,rememberCatalogUser} from '../lib/catalog-cache';
import {emptySelection,readSelectionMemory,rememberSelection,type RememberedSelection} from '../lib/selection-memory';
import {buildConfigurationRegistry,applyConfigurationRegistry,configurationRevision,type ConfigurationRegistry} from '../lib/configuration-registry';
import {readRegistry,saveRegistry,readRegistryMode,saveRegistryMode} from '../lib/registry-cache';
import {priceCardRows} from '../lib/comparison-view';
import {selectHardware,hardwareKeys,emptyHardwareChoice,watchBandType,type HardwareKey} from '../lib/configuration-filters';
import {selectionModel,macbookRam,hardwareCatalog,colorHex} from '../lib/product-selection';
import {priceOpenBoxes} from '../lib/open-box-pricing';
import {optionalStores,storeLabels,comparisonStores} from '../lib/stores';
import dynamic from 'next/dynamic';
import {defaultSettings,priceRefreshStatus,type AppSettings} from '../lib/app-settings';
import {useEffect,useMemo,useState,useRef} from 'react';
import {ArrowUpRight,RefreshCw,ChevronDown,Database,Check,Coins,X,Search,Smartphone,ArrowRight,Copy,Send} from 'lucide-react';
import {canonicalColor,hasPrice,priceLabel,missingPriceReason,type Product} from '../lib/catalog';
import {readDevice,saveDevice,migrateDevice} from '../lib/device-catalog';
import {formatKyivDate,formatPriceDate} from '../lib/time';
import {belongs,type Inventory} from '../lib/inventory';
import {availableUsedOffers} from '../lib/used-offers';
import {rowStockDetails,stockWarehouses,type CardStock} from '../lib/warehouse-stock';
import {openBossDraft,priceMessage} from '../lib/boss-draft';
const PriceHistory=dynamic(()=>import('../components/price-history').then(module=>module.PriceHistory),{ssr:false});
const ShopPanel=dynamic(()=>import('../components/shop-panel').then(module=>module.ShopPanel),{ssr:false});
const AdminPanel=dynamic(()=>import('../components/admin-panel').then(module=>module.AdminPanel),{ssr:false});
type State={catalogVersion?:string;cachedAt?:string;catalog:{products:Product[];stores:Record<string,any>;updated_at?:string};rate:string|null;job:any;rateSource?:string;rateCheckedAt?:string;rateError?:string;extraStores?:string[]};
declare global{interface Window{Telegram?:any}}
const money=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(v);
const getTheme=()=>window.Telegram?.WebApp?.colorScheme==='dark'||(!window.Telegram?.WebApp&&matchMedia('(prefers-color-scheme: dark)').matches);
export default function Home(){
 const [settings,setSettings]=useState<AppSettings>(defaultSettings),[isOwner,setIsOwner]=useState(false),[ownerConfigured,setOwnerConfigured]=useState(true),[adminOpen,setAdminOpen]=useState(false),[clock,setClock]=useState(Date.now());
 const [cacheStatus,setCacheStatus]=useState<'checking'|'current'|'offline'>('checking'),[selectionReady,setSelectionReady]=useState(false);
 const [registryEnabled,setRegistryEnabled]=useState(false),[registry,setRegistry]=useState<ConfigurationRegistry|null>(null),[registryLoading,setRegistryLoading]=useState(false);
 const initialRequestRef=useRef<AbortController|null>(null),bootstrapReadyRef=useRef(false),cachedMemoryUserRef=useRef('');
 const personalRef=useRef<string[]|null>(null);
 const [openBoxLoading,setOpenBoxLoading]=useState(false);
 async function refreshOpenBox(){if(openBoxLoading)return;setOpenBoxLoading(true);try{await api('/api/stock/open-box',{});const state=await api('/api/state');commit(cloudState(state));setStockReload(n=>n+1);}catch(e:any){setError(e.message);}finally{setOpenBoxLoading(false);}}
 const [historyProduct,setHistoryProduct]=useState<Product|null>(null),[macCondition,setMacCondition]=useState('Standard');
 const selectable=(p:Product)=>hasPrice(p)||p.edition==='OpenBox'||p.edition==='Used';
 const [watchBand,setWatchBand]=useState('');
 const [category,setCategory]=useState<AppleCategory>('iphone');
 const [hardwareChoice,setHardwareChoice]=useState(emptyHardwareChoice);
 const [session,setSession]=useState<{user:string;provider:string}|null>(null);
 const [stockPaused,setStockPaused]=useState(true),[stockLive,setStockLive]=useState(false),[stockOnOpen,setStockOnOpen]=useState(false),[stockViewPending,setStockViewPending]=useState(false),[stockViewPartial,setStockViewPartial]=useState(false),[stockSyncedAt,setStockSyncedAt]=useState<string|null>(null);
 const [stockRefreshingAll,setStockRefreshingAll]=useState(false),[stockNotice,setStockNotice]=useState(''),[stockReload,setStockReload]=useState(0);
 const stockAllRef=useRef(false);
 const [stockLoading,setStockLoading]=useState(false),[stockFailed,setStockFailed]=useState(false);
 const [usedModel,setUsedModel]=useState(''),[usedStorage,setUsedStorage]=useState(''),[stockPendingCards,setStockPendingCards]=useState<string[]>([]),[stockUpdatedAt,setStockUpdatedAt]=useState<string|null>(null);
 const [stockValues,setStockValues]=useState<Record<string,CardStock>>({});
 const [stockVerifiedAt,setStockVerifiedAt]=useState<Record<string,(string|null)[]>>({});
 const stockSequence=useRef(0);
 const [pendingCards,setPendingCards]=useState<string[]>([]);
 const [personalSaving,setPersonalSaving]=useState(false);
 const settingsRef=useRef(defaultSettings);
 const [rateRefreshing,setRateRefreshing]=useState(false);
 const rateSequence=useRef(0),manualPublicRate=useRef<string|null>(null);
 function cloudState(seed:State){return session?.provider==='public'&&manualPublicRate.current?{...seed,rate:manualPublicRate.current,rateSource:undefined,rateCheckedAt:undefined}:seed;}
 const userRef=useRef(''),currentRef=useRef<State|null>(null);
 function commit(value:State){
  const before=currentRef.current,catalogChanged=before?.catalog!==value.catalog;
  if(catalogChanged)value=migrateDevice(value);
  if(personalRef.current!==null)value={...value,extraStores:personalRef.current};
  if(!value.rate&&settingsRef.current.defaultRate)value={...value,rate:settingsRef.current.defaultRate};
  if(catalogChanged)value={...value,cachedAt:new Date().toISOString()};
  currentRef.current=value;setData(value);
  if(catalogChanged||before?.rate!==value.rate||before?.rateSource!==value.rateSource||before?.rateCheckedAt!==value.rateCheckedAt||JSON.stringify(before?.extraStores)!==JSON.stringify(value.extraStores)){
   saveDevice(userRef.current,value);rememberCatalogUser(userRef.current);
  }
 }
 function applyMetadata(value:any){if(!currentRef.current)return;const patch:any={};for(const key of ['job','rate','rateSource','rateCheckedAt'])if(Object.hasOwn(value,key))patch[key]=value[key];commit({...currentRef.current,...cloudState({...currentRef.current,...patch})});}
 function applyRemoteState(value:any){if(value.catalog)commit({...currentRef.current,...cloudState(value)});else applyMetadata(value);}
 function restoreSelection(value:RememberedSelection){setMacCondition(value.macCondition||'Standard');setModel(value.model);setStorage(value.storage);setSim(value.sim||'physical');setRam(value.ram);setWatchBand(value.watchBand);setHardwareChoice(value.hardwareChoice);setUsedModel(value.usedModel);setUsedStorage(value.usedStorage);}
 function loadRemembered(user:string){const memory=readSelectionMemory(user);setCategory(memory.category);setActiveTab(memory.used?'used':'compare');restoreSelection(memory.selections[memory.used?'used':memory.category]||emptySelection);setRegistryEnabled(readRegistryMode(user));setSelectionReady(true);}

 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[model,setModel]=useState(''),[storage,setStorage]=useState(''),[sim,setSim]=useState('physical'),[ram,setRam]=useState(''),[query,setQuery]=useState(''),[rateOpen,setRateOpen]=useState(false),[rateDraft,setRateDraft]=useState(''),[saving,setSaving]=useState(false),[syncing,setSyncing]=useState(false),[activeTab,setActiveTab]=useState('compare'),[copied,setCopied]=useState('');
 async function api(path:string,body?:any,signal?:AbortSignal){const headers:Record<string,string>={};const init=window.Telegram?.WebApp?.initData;if(init)headers['X-Telegram-Init-Data']=init;if(body)headers['Content-Type']='application/json';const r=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal,cache:'no-store'});const j:any=await r.json();if(!r.ok)throw new Error(j.error||'Не удалось выполнить запрос');return j;}
 function applySettings(result:any){settingsRef.current=result.settings;setSettings(result.settings);if(typeof result.isOwner==='boolean')setIsOwner(result.isOwner);if(typeof result.ownerConfigured==='boolean')setOwnerConfigured(result.ownerConfigured);if(currentRef.current&&!currentRef.current.rate&&result.settings.defaultRate)commit({...currentRef.current,rate:result.settings.defaultRate});}
 async function updateRate(signal?:AbortSignal){
  const sequence=++rateSequence.current;manualPublicRate.current=null;
  try{
   const response=await fetch('/api/rate',{headers:{'X-Telegram-Init-Data':window.Telegram?.WebApp?.initData||''},signal,cache:'no-store'});
   const result:any=await response.json();if(!response.ok)throw Error(result.error||'Не удалось обновить курс iPeople.');
   const rate=Number(result.rate);if(!Number.isFinite(rate)||rate<1||rate>1000||result.source!=='https://www.ipeople.in.ua/'||!Number.isFinite(Date.parse(result.checked_at)))throw Error('Не удалось подтвердить курс iPeople.');
   if(signal?.aborted||sequence!==rateSequence.current||!currentRef.current)return;
   commit({...currentRef.current,rate:String(rate),rateSource:result.source,rateCheckedAt:result.checked_at,rateError:undefined});
  }catch{if(!signal?.aborted&&sequence===rateSequence.current&&currentRef.current)commit({...currentRef.current,rateError:'Курс iPeople не обновился. '+(currentRef.current.rate?'Используется сохранённый курс.':'Укажите курс вручную или повторите обновление.')});}
 }
 async function refreshRateNow(){if(rateRefreshing||!session||!currentRef.current)return;setRateRefreshing(true);try{await updateRate();}finally{setRateRefreshing(false);}}
 async function reload(){
  if(document.visibilityState==='hidden'||initialRequestRef.current)return;
  const controller=new AbortController();initialRequestRef.current=controller;let account:any=null;setCacheStatus('checking');
  try{
   account=await api('/api/session',undefined,controller.signal);userRef.current=account.user;
   const cached=readDevice(account.user);if(cached?.catalog.products.length&&(!currentRef.current||cached.catalogVersion!==currentRef.current.catalogVersion)){currentRef.current={...cached,job:null};setData(currentRef.current);setLoading(false);}
   loadRemembered(account.user);
   const version=currentRef.current?.catalogVersion;
   const [seed,preferences,config]=await Promise.all([api('/api/state'+(version?'?version='+encodeURIComponent(version):''),undefined,controller.signal),api('/api/my-stores',undefined,controller.signal),api('/api/settings',undefined,controller.signal)]);
   const extras=account.provider==='public'?(cached?.extraStores||[]):preferences.extraStores;personalRef.current=extras;applySettings(config);applyRemoteState(seed);bootstrapReadyRef.current=true;setCacheStatus('current');setError('');
   if(account.user.startsWith('telegram:')){
    const legacy=readDevice(account.user.slice(9)),marker='apple-compare:legacy-import:'+account.user;let imported=false;try{imported=localStorage.getItem(marker)==='done';}catch{}
    if(!imported&&legacy?.catalog.products.length){await api('/api/device/import',{items:legacy.catalog.products.map(p=>({store:p.store,url:p.url,scope:p.edition==='Used'?'used':'new'}))},controller.signal);const revision=currentRef.current?.catalogVersion;applyRemoteState(await api('/api/state'+(revision?'?version='+encodeURIComponent(revision):''),undefined,controller.signal));try{localStorage.setItem(marker,'done');}catch{}}
   }
  }catch(e:any){if(e.name!=='AbortError'){setCacheStatus('offline');if(!currentRef.current)setError(e.message);}}
  finally{if(initialRequestRef.current===controller)initialRequestRef.current=null;if(account)setSession(account);if(currentRef.current||!controller.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  const saved=readLatestCatalog();if(saved){const {cacheUser,...catalog}=saved;cachedMemoryUserRef.current=cacheUser;const cached:State={...catalog,rate:null,job:null};currentRef.current=cached;setData(cached);setLoading(false);loadRemembered(cacheUser);}
  const visibility=()=>{if(document.visibilityState==='hidden')initialRequestRef.current?.abort();else if(!bootstrapReadyRef.current)void reload();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visibility);
  return()=>{initialRequestRef.current?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);};
 },[]);
 useEffect(()=>{if(!/tgWebAppData=/.test(window.location.hash)&&!window.Telegram?.WebApp?.initData){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';void reload();return;}const timeout=setTimeout(()=>void reload(),8000);const script=document.createElement('script');script.src='https://telegram.org/js/telegram-web-app.js';script.onload=()=>{clearTimeout(timeout);const t=window.Telegram?.WebApp;t?.ready();t?.expand();const theme=()=>{document.documentElement.dataset.theme=getTheme()?'dark':'light';try{t?.setHeaderColor(getTheme()?'#000000':'#f5f5f7');t?.setBackgroundColor(getTheme()?'#000000':'#f5f5f7');}catch{}};theme();t?.onEvent('themeChanged',theme);void reload();};script.onerror=()=>{clearTimeout(timeout);void reload();};document.head.appendChild(script);document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';return()=>{clearTimeout(timeout);script.remove();};},[]);
 useEffect(()=>{const tick=()=>setClock(Date.now());const id=setInterval(tick,60000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(id);document.removeEventListener('visibilitychange',tick);};},[]);
 useEffect(()=>{if(!settings.showUsed&&activeTab==='used')setActiveTab('compare');},[settings.showUsed,activeTab]);
 useEffect(()=>{
  if(!session)return;
  return startVisibleCatalogSync({request:(path,body,signal)=>api(path,body,signal),getVersion:()=>currentRef.current?.catalogVersion,getJob:()=>currentRef.current?.job,onMetadata:applyMetadata,onCatalog:applyRemoteState,onStatus:setCacheStatus,visible:()=>document.visibilityState!=='hidden',subscribe:listener=>{document.addEventListener('visibilitychange',listener);window.addEventListener('online',listener);return()=>{document.removeEventListener('visibilitychange',listener);window.removeEventListener('online',listener);};}});
 },[session?.user]);

 const busy=data?.job&&['queued','running'].includes(data.job.status);
 const usedScopeBusy=!!busy&&data?.job?.sources?.some((s:any)=>s.scope==='used'&&!s.complete);

 const used=activeTab==='used';
 const selectedCategory=used?'iphone':category;const phone=selectedCategory==='iphone';
 const sourceProducts=useMemo(()=>priceOpenBoxes(data?.catalog.products||[],data?.rate,data?.rateCheckedAt).map(p=>({...p,color:canonicalColor(p.model,p.color)})),[data?.catalog.products,data?.rate,data?.rateCheckedAt]);
 const registryVersion=useMemo(()=>registryEnabled?configurationRevision(sourceProducts):'', [registryEnabled,sourceProducts]);
 useEffect(()=>{let cancelled=false;if(!registryEnabled){setRegistryLoading(false);return;}const version=registryVersion;if(!version||!sourceProducts.length)return;
  setRegistryLoading(true);void (async()=>{let snapshot=await readRegistry(version);if(cancelled)return;if(!snapshot){snapshot=buildConfigurationRegistry(sourceProducts,version);await saveRegistry(snapshot);}if(!cancelled){setRegistry(snapshot);setRegistryLoading(false);}})();return()=>{cancelled=true;};
 },[registryEnabled,registryVersion]);
 const allProducts=useMemo(()=>registryEnabled&&registry?.catalogVersion===registryVersion?applyConfigurationRegistry(sourceProducts,registry):sourceProducts,[sourceProducts,registryEnabled,registry,registryVersion]);
 function toggleRegistry(enabled:boolean){setRegistryEnabled(enabled);saveRegistryMode(userRef.current||cachedMemoryUserRef.current,enabled);}

 const enabledStores=useMemo(()=>comparisonStores(settings.stores,data?.extraStores),[settings.stores,data?.extraStores]);
 const products=useMemo(()=>allProducts.filter(p=>belongs(p,used?'used':'new')&&categoryOf(p)===selectedCategory&&(used||enabledStores.includes(p.store))&&(selectedCategory!=='mac'||(p.edition||'Standard')===macCondition)),[allProducts,used,enabledStores,selectedCategory,macCondition]);
 const hardware=selectedCategory==='mac'||selectedCategory==='ipad';
 const hardwareFacts=useMemo(()=>hardware?hardwareCatalog(allProducts.filter(p=>categoryOf(p)===selectedCategory)):new Map(),[allProducts,selectedCategory,hardware]);
 const hardwareBase=useMemo(()=>selectedCategory==='mac'?products.filter(p=>{const f=hardwareFacts.get(p)!;return p.edition==='OpenBox'||/^M(?:[4-9]|[1-9]\d+)$/.test(f.generation)||f.deviceClass==='Neo'||/Display/.test(f.deviceClass);}):products,[products,selectedCategory,hardwareFacts]);
 const hardwareSelection=useMemo(()=>selectHardware(hardware?hardwareBase:[],hardwareFacts,selectedCategory,hardwareChoice),[hardware,hardwareBase,hardwareChoice,hardwareFacts,selectedCategory]);
 function chooseHardware(key:HardwareKey,value:string){const next={...hardwareSelection.values,[key]:value};for(const later of hardwareKeys.slice(hardwareKeys.indexOf(key)+1))next[later]='';setHardwareChoice(next);setRam('');}
 const watchModelProducts=useMemo(()=>products.filter(p=>selectionModel(p)===model),[products,model]);
 const watchBands=useMemo(()=>[...new Set(watchModelProducts.filter(hasPrice).map(watchBandType))].sort(),[watchModelProducts]);
 const selectedWatchBand=watchBands.includes(watchBand)?watchBand:watchBands[0]||'';
 const selectedProducts=useMemo(()=>hardware?hardwareSelection.products:selectedCategory==='watch'?products.filter(p=>watchBandType(p)===selectedWatchBand):products,[hardware,hardwareSelection.products,selectedCategory,products,selectedWatchBand]);
 const hf=hardwareSelection.values;
 const hardwareSummary=[selectedCategory==='mac'&&['Air','Pro','Neo'].includes(hf.deviceClass)?'MacBook '+hf.deviceClass:selectedCategory==='ipad'&&hf.deviceClass!=='iPad'?'iPad '+hf.deviceClass:hf.deviceClass,hf.generation==='Не указан'?'':hf.generation,hf.tier==='Базовый'?'':hf.tier,hf.screen&&hf.screen!=='Не указана'?hf.screen+'″':''].filter(Boolean).join(' ');
 const models=useMemo(()=>[...new Set((selectedCategory==='watch'?products:selectedProducts).filter(selectable).map(selectionModel))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})),[products,selectedProducts,selectedCategory]);
 const memories=useMemo(()=>[...new Set(selectedProducts.filter(p=>selectable(p)&&(hardware||selectionModel(p)===model)).map(p=>p.storage))].sort((a,b)=>(Number(a.replace(/\D/g,''))*(a.includes('TB')?1024:1))-(Number(b.replace(/\D/g,''))*(b.includes('TB')?1024:1))),[selectedProducts,hardware,model]);
 const macbook=selectedCategory==='mac'&&/^MacBook\b/i.test(model);
 const ramOptions=useMemo(()=>[...new Set(selectedProducts.filter(p=>selectable(p)&&(hardware||selectionModel(p)===model)&&p.storage===storage).map(p=>macbookRam(p)||'unknown'))].sort((a,b)=>a==='unknown'?1:b==='unknown'?-1:parseInt(a)-parseInt(b)),[selectedProducts,hardware,model,storage]);
 useEffect(()=>{if(!selectionReady||loading)return;if(!macbook||ram&&!ramOptions.includes(ram))setRam('');},[selectionReady,loading,macbook,ram,ramOptions]);
 const sims=useMemo(()=>{const known=[...new Set(selectedProducts.filter(p=>(hardware||selectionModel(p)===model)&&p.storage===storage).map(p=>p.sim).filter(s=>s!=='unknown'))];return known.length?known:['unknown'];},[selectedProducts,hardware,model,storage]);
 useEffect(()=>{if(!selectionReady||loading)return;if(!models.length)setModel('');else if(!models.includes(model))setModel(models.includes('17')?'17':models[0]);},[selectionReady,loading,models,model]);
 useEffect(()=>{if(!selectionReady||loading)return;if(!memories.length)setStorage('');else if(!memories.includes(storage))setStorage(memories.includes('256GB')?'256GB':memories[0]);},[selectionReady,loading,memories,storage]);
 useEffect(()=>{if(!selectionReady||loading)return;if(sims.length&&!sims.includes(sim))setSim(sims[0]);},[selectionReady,loading,sims,sim]);
 function currentSelection():RememberedSelection{return {macCondition,model,storage,sim,ram,watchBand:selectedWatchBand,hardwareChoice:hardware?hardwareSelection.values:hardwareChoice,usedModel,usedStorage};}
 function persistSelection(){const user=session?.user||cachedMemoryUserRef.current;if(user&&selectionReady)rememberSelection(user,used?'used':category,currentSelection(),category,used);}
 function changeCategory(next:AppleCategory){persistSelection();setCategory(next);const memory=readSelectionMemory(userRef.current||cachedMemoryUserRef.current);restoreSelection(memory.selections[next]||emptySelection);setQuery('');}
 function changeScope(nextUsed:boolean){persistSelection();const memory=readSelectionMemory(userRef.current||cachedMemoryUserRef.current);restoreSelection(memory.selections[nextUsed?'used':category]||emptySelection);setActiveTab(nextUsed?'used':'compare');setQuery('');}
 useEffect(()=>{if(!selectionReady||loading||(!session&&!cachedMemoryUserRef.current)||!used&&(!models.includes(model)||memories.length&&!memories.includes(storage)))return;persistSelection();},[session?.user,selectionReady,loading,category,used,macCondition,model,storage,sim,ram,selectedWatchBand,hf.deviceClass,hf.tier,hf.generation,hf.screen,hf.glass,hf.network,usedModel,usedStorage]);
 const rows=useMemo(()=>{
  const tokens=searchTokens(query),matches=(p:Product)=>tokens.every(t=>searchText(p).includes(t));
  if(used)return availableUsedOffers(products,stockValues,query,usedModel,usedStorage);
  const eligible=selectedProducts.filter(p=>(hardware||selectionModel(p)===model)&&p.storage===storage&&(!phone||p.sim===sim||p.sim==='unknown')&&(!macbook||!ram||(macbookRam(p)||'unknown')===ram));
  return priceCardRows(eligible,phone).filter(row=>row.offers.some(matches));
 },[selectedProducts,hardware,model,storage,sim,query,used,phone,macbook,ram,stockValues,usedModel,usedStorage]);


 const stockModel=used?'':model,stockSim=used?'physical':sim;
 async function updateStocks(){
  const sequence=++stockSequence.current;if(!used&&!model)return;
  setStockLoading(true);
  try{
   const result=await api('/api/stock?'+new URLSearchParams({category:selectedCategory,...(used?{all:'1'}:hardware?{}:{model}),scope:used?'used':'new',sim:used?'physical':sim}));
   if(sequence===stockSequence.current){setStockPaused(result.integrationPaused===true);setStockValues(result.values||{});setStockVerifiedAt(result.verifiedAt||{});setStockUpdatedAt(result.updatedAt||null);setStockFailed(false);}
  }catch{if(sequence===stockSequence.current)setStockFailed(true);}
  finally{if(sequence===stockSequence.current)setStockLoading(false);}
 }

 useEffect(()=>{
  const sequence=++stockSequence.current;setStockValues({});setStockVerifiedAt({});setStockFailed(false);setStockLoading(true);
  if(!session||!used&&!model){setStockLoading(false);return;}
  const params={category:selectedCategory,...(used?{all:'1'}:hardware?{}:{model}),scope:used?'used':'new',sim:used?'physical':sim};
  const stop=startVisibleStockSync({request:(version,signal)=>api('/api/stock?'+new URLSearchParams({...params,...(version?{version}:{})}),undefined,signal),
   onData:result=>{if(sequence!==stockSequence.current)return;setStockPaused(result.integrationPaused===true);setStockLive(result.realtime===true);setStockOnOpen(result.onOpen===true);if(!result.unchanged){setStockValues(result.values||{});setStockVerifiedAt(result.verifiedAt||{});setStockUpdatedAt(result.updatedAt||null);setStockSyncedAt(result.syncedAt||null);}setStockFailed(false);setStockLoading(false);},
   onError:()=>{if(sequence===stockSequence.current){setStockFailed(true);setStockLoading(false);}},visible:()=>document.visibilityState!=='hidden',subscribe:listener=>{document.addEventListener('visibilitychange',listener);window.addEventListener('online',listener);return()=>{document.removeEventListener('visibilitychange',listener);window.removeEventListener('online',listener);};}});
  return()=>{stockSequence.current++;stop();};
 },[session?.user,selectedCategory,stockModel,used,stockSim,stockReload]);

 function sendToBoss(row:any){
  try{
   const offers=stores.map(store=>row[store]).filter(Boolean),rate=data?.rate||null;
   const text=priceMessage(offers,rate);
   // Keep the native link opening synchronous with the tap (Telegram's gesture TTL).
   const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';input.style.fontSize='16px';input.readOnly=true;document.body.appendChild(input);input.select();input.setSelectionRange(0,text.length);
   let copied=false;try{copied=document.execCommand('copy');}catch{}finally{input.remove();}
   if(!copied&&navigator.clipboard?.writeText)void navigator.clipboard.writeText(text).catch(()=>{});
   openBossDraft(offers,rate,settings.bossRecipient,window.Telegram?.WebApp,url=>window.location.assign(url));
  }catch(e:any){setError(e.message);}
 }
 async function copyCard(row:any){
  try{
   const text=priceMessage(stores.map(store=>row[store]).filter(Boolean),data?.rate||null);
   let done=false;
   try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);done=true;}}catch{}
   if(!done){const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';input.style.fontSize='16px';input.readOnly=true;document.body.appendChild(input);input.select();input.setSelectionRange(0,text.length);try{done=document.execCommand('copy');}finally{input.remove();}}
   if(!done)throw new Error('Не удалось скопировать. Разрешите доступ к буферу обмена.');
   setCopied(row.key);setTimeout(()=>setCopied(value=>value===row.key?'':value),2000);
   window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  }catch(e:any){setError(e.message);}
 }
 async function saveRate(e:React.FormEvent){e.preventDefault();if(!session)return;setSaving(true);try{const rate=Number(rateDraft.trim().replace(',','.'));if(!Number.isFinite(rate)||rate<1||rate>1000)throw new Error('Введите курс от 1 до 1000.');if(!currentRef.current)throw new Error('Сначала загрузите базу.');await api('/api/rate',{rate});if(session?.provider==='public')manualPublicRate.current=String(rate);rateSequence.current++;commit({...currentRef.current,rate:String(rate),rateSource:undefined,rateCheckedAt:undefined,rateError:undefined});setRateOpen(false);window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');}catch(e:any){setError(e.message);}finally{setSaving(false);}}
 async function refresh(kind:string,scope:Inventory|'all'='new',onlyStores?:string[],category:AppleCategory|'all'='all',retryOnly=false,selectedModel='',dueHours=0){
  if(syncing||!session||!currentRef.current)return;manualPublicRate.current=null;setSyncing(true);setError('');
  try{const result=await api('/api/refresh',{kind,scope,stores:onlyStores||enabledStores,category,retryOnly,model:selectedModel,dueHours});if(currentRef.current)commit({...currentRef.current,job:result.job});}
  catch(e:any){setError(e.message);}finally{setSyncing(false);}
 }

 async function recheck(p:Product){await refresh('prices',p.edition==='Used'?'used':'new',[p.store]);}

 async function toggleStore(store:string,on:boolean){if(personalSaving||!currentRef.current)return;setPersonalSaving(true);try{const selected=currentRef.current.extraStores||[],next=optionalStores.filter(s=>s===store?on:selected.includes(s));const result=await api('/api/my-stores',{extraStores:next});personalRef.current=result.extraStores;if(currentRef.current)commit({...currentRef.current,extraStores:result.extraStores});}catch(e:any){setError(e.message);}finally{setPersonalSaving(false);}}
 const timestamp=data?.catalog.updated_at;const date=formatKyivDate(timestamp);
 const good=useMemo(()=>allProducts.filter(p=>p.status==='ok').length,[allProducts]);
 const stores=used||selectedCategory==='mac'&&macCondition==='OpenBox'?['iPeople']:enabledStores;
 const freshness=data?priceRefreshStatus({...data.catalog,products:data.catalog.products.filter(p=>!p.stock_id)},stores.filter(store=>allProducts.some(p=>p.store===store&&belongs(p,used?'used':'new'))),settings.staleHours,clock,used):null;
 function cardTargets(row:any,prices=false):{store:string;url:string}[]{
  return [...new Map((row.offers||stores.map(store=>row[store]).filter(Boolean)).filter((p:Product)=>stores.includes(p.store)&&(!prices||!p.stock_id)).map((p:Product)=>[p.store+'|'+p.url,{store:p.store,url:p.url}])).values()] as {store:string;url:string}[];
 }
 const targetKey=(targets:{store:string;url:string}[])=>JSON.stringify(targets.map(t=>t.store+'|'+t.url).sort());
 function cardRefreshing(row:any){
  const targets=cardTargets(row);
  return pendingCards.includes(targetKey(targets))||!!busy&&data?.job?.sources?.some((s:any)=>s.card&&!s.complete&&targets.some(t=>s.store===t.store&&s.targets?.includes(t.url)));
 }
 useEffect(()=>{
  if(!pendingCards.length)return;
  const complete=(key:string)=>JSON.parse(key).every((target:string)=>data?.job?.sources?.some((s:any)=>s.card&&s.complete&&s.targets?.some((url:string)=>s.store+'|'+url===target)));
  if(pendingCards.some(complete))setPendingCards(previous=>previous.filter(key=>!complete(key)));
 },[data?.job,pendingCards]);
 async function refreshCard(row:any){
  if(syncing||!session||!currentRef.current)return;
  const targets=cardTargets(row,true),key=targetKey(targets);if(!targets.length||cardRefreshing(row))return;
  setPendingCards(previous=>[...previous,key]);setSyncing(true);setError('');
  try{const result=await api('/api/refresh',{kind:'prices',scope:used?'used':'new',stores:[...new Set(targets.map(t=>t.store))],category:selectedCategory,model:used?selectionModel(row.iPeople):model,targets});if(currentRef.current)commit({...currentRef.current,job:result.job});}
  catch(e:any){setPendingCards(previous=>previous.filter(k=>k!==key));setError(e.message);}finally{setSyncing(false);}
 }
 const viewOffers=used?(usedModel?products.filter(p=>p.model===usedModel&&(!usedStorage||p.storage===usedStorage)):[]):rows.flatMap(row=>row.offers||[]);
 const viewTargets=[...new Map(viewOffers.filter(p=>stores.includes(p.store)).map(p=>[p.store+'|'+p.url,{store:p.store,url:p.url}])).values()].sort((a,b)=>(a.store+a.url).localeCompare(b.store+b.url));
 const stockViewIdentity=JSON.stringify({scope:used?'used':'new',sim:used?'physical':sim,targets:viewTargets});
 useEffect(()=>{
  if(!session||!selectionReady||!stockOnOpen)return;
  const body=JSON.parse(stockViewIdentity);if(!body.targets.length||body.targets.length>300)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|null=null;
  const wake=()=>{if(timer)clearTimeout(timer);controller?.abort();setStockViewPending(false);if(stopped||document.visibilityState==='hidden')return;
   timer=setTimeout(async()=>{controller=new AbortController();const signal=controller.signal;setStockViewPending(true);setStockViewPartial(false);
    try{const result=await api('/api/stock',{...body,view:true},signal);if(stopped||signal.aborted)return;if(result.busy){setStockViewPartial(true);return;}setStockValues(previous=>({...previous,...result.values}));setStockVerifiedAt(previous=>({...previous,...result.verifiedAt}));setStockUpdatedAt(result.updatedAt||null);setStockViewPartial(result.partial===true);setStockFailed(false);}
    catch{if(!stopped&&!signal.aborted){setStockViewPartial(true);}}
    finally{if(!stopped&&!signal.aborted)setStockViewPending(false);}
   },350);
  };
  wake();document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
  return()=>{stopped=true;if(timer)clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);};
 },[session?.user,selectionReady,stockOnOpen,stockViewIdentity]);
 async function refreshAllStocks(){
  if(stockPaused||!session||stockAllRef.current||stockPendingCards.length)return;
  stockAllRef.current=true;setStockRefreshingAll(true);setStockNotice('Обновляем остатки всей базы…');setError('');
  try{
   const result=await api('/api/stock',{all:true});
   if(result.busy){setStockNotice('Общее обновление уже запущено. Повторите проверку чуть позже.');return;}
   if(result.paused)throw Error('Обновление остатков сейчас отключено.');
   setStockReload(value=>value+1);
   setStockNotice(result.partial?'Часть остатков не обновилась. Последние проверенные данные сохранены.':'Остатки всей базы обновлены'+(result.unmapped?` · без сопоставления: ${result.unmapped}`:''));
  }catch(e:any){setStockNotice('');setError(e.message);}finally{stockAllRef.current=false;setStockRefreshingAll(false);}
 }
 async function refreshStockCard(row:any){
  if(stockPaused||stockAllRef.current)return;
  const targets=cardTargets(row),key=targetKey(targets),sequence=stockSequence.current;
  if(!targets.length||stockPendingCards.includes(key))return;
  setStockPendingCards(previous=>[...previous,key]);
  try{const result=await api('/api/stock',{scope:used?'used':'new',targets,sim:used?'physical':sim});if(sequence===stockSequence.current){setStockValues(previous=>({...previous,...result.values}));setStockVerifiedAt(previous=>({...previous,...result.verifiedAt}));setStockUpdatedAt(result.updatedAt||null);if(result.partial)setError('Не все остатки карточки обновились. Последние данные сохранены.');}}
  catch(e:any){if(sequence===stockSequence.current)setError(e.message);}finally{setStockPendingCards(previous=>previous.filter(k=>k!==key));}
 }
 const usedMemories=[...new Set(products.filter(p=>!usedModel||p.model===usedModel).map(p=>p.storage))].sort((a,b)=>parseInt(a)-parseInt(b));
 const stale=!!freshness?.stores.length;
 const partial=!!freshness?.failedStores.length;
 return <main className="shell">
  <header className="header"><a className="brand" href="#" aria-label="Apple Compare"><span className="brand-icon"><Smartphone size={19}/></span><span>Apple<span className="brand-light"> Compare</span></span></a><div className="rate-controls"><button title={data?.rateSource?`Курс iPeople · ${formatKyivDate(data.rateCheckedAt)||''}`:'Курс обновляется с iPeople вместе с ценами'} className="rate-button" onClick={()=>{setRateDraft(data?.rate||'');setRateOpen(true);}}><span className="dollar">$</span>{data?.rate?`${data.rate} ₴`:'Курс'}<ChevronDown size={14}/></button><button type="button" className="rate-refresh" onClick={()=>void refreshRateNow()} disabled={rateRefreshing||syncing||saving||!data||!session} aria-label="Обновить курс с iPeople" title="Обновить курс с iPeople" aria-busy={rateRefreshing}><RefreshCw size={16} className={rateRefreshing?'spin':''}/><span className="rate-refresh-label">{rateRefreshing?'Обновляем…':'Обновить'}</span></button><button type="button" className="stock-all-refresh" onClick={()=>void refreshAllStocks()} disabled={stockPaused||!session||stockRefreshingAll||stockPendingCards.length>0} aria-label="Обновить все остатки" aria-busy={stockRefreshingAll} title="Вручную обновить остатки всей базы: новая техника и Б/У"><RefreshCw size={16} className={stockRefreshingAll?'spin':''}/><span>{stockRefreshingAll?'Обновляем остатки…':'Обновить все остатки'}</span></button></div></header>
  <div className="cloud-account" role="status"><span>{data?`Сохранённая база${formatKyivDate(data.catalog.updated_at||data.cachedAt)?' · '+formatKyivDate(data.catalog.updated_at||data.cachedAt):''} · ${cacheStatus==='checking'?'проверяем обновления…':cacheStatus==='offline'?'нет связи, показана сохранённая копия':'версия проверена'}`:'Загружаем базу…'}</span></div>
  {stockNotice&&<div className="stock-notice" role="status"><span className={stockRefreshingAll?"status-dot pending":"status-dot"}/>{stockNotice}</div>}
  {stale&&!adminOpen&&!busy&&!syncing&&<button className={'stale-button'+(partial?' partial':'')} onClick={()=>refresh('prices',used?'used':'new',freshness?.stores,'all',false,'',settings.staleHours)}><RefreshCw size={24}/><span><strong>{freshness?.blockedStores.length?'Магазин ограничил проверку':partial?'Не все цены обновились':'Пора проверить цены'}</strong><small>{freshness?.blockedStores.length?`Доступ к проверке временно ограничен: ${freshness.blockedStores.map(s=>storeLabels[s]).join(', ')}. Последние подтверждённые цены сохранены. Нажмите, чтобы продолжить проверку после паузы.`:partial?`Не удалось подтвердить карточки: ${freshness?.failedCount}. Магазины: ${freshness?.failedStores.map(s=>storeLabels[s]).join(', ')}. Последние цены сохранены. Нажмите, чтобы повторить проверку.`:`Цены старше ${settings.staleHours} ч.: ${freshness?.staleCount}. Магазины: ${freshness?.staleStores.map(s=>storeLabels[s]).join(', ')}. Нажмите для проверки.`}{partial&&!!freshness?.staleStores.length?` Также требуют проверки: ${freshness.staleStores.map(s=>storeLabels[s]).join(', ')}.`:''}</small></span></button>}
  <nav className="tabs"><button className={activeTab==='compare'?'selected':''} onClick={()=>{changeScope(false);}}>Новые</button>{settings.showUsed&&<button className={used?'selected':''} onClick={()=>{changeScope(true);}}>Б/У iPhone</button>}<button className={activeTab==='catalog'?'selected':''} onClick={()=>setActiveTab('catalog')}>Моя база <span className="count">{allProducts.length}</span></button><button className={activeTab==='shops'?'selected':''} onClick={()=>{setAdminOpen(false);setActiveTab('shops');}}>Магазины</button></nav>
  {data?.rateError&&<div role="status" className="error"><span>{data.rateError}</span></div>}
  {error&&<div role="alert" className="error"><span>{error}{error.includes('Telegram')&&<a href='https://t.me/ipeoplePrice_bot' className='telegram-link'>Открыть бота ↗</a>}</span><button aria-label="Закрыть ошибку" onClick={()=>setError('')}><X size={16}/></button></div>}
  {adminOpen?<AdminPanel settings={settings} isOwner={isOwner} ownerConfigured={ownerConfigured} products={allProducts} storeStates={data?.catalog.stores||{}} api={api} onSettings={applySettings} onClose={()=>setAdminOpen(false)} onRecheck={recheck}/>:activeTab==='shops'?<ShopPanel enabled={data?.extraStores||[]} products={allProducts} states={data?.catalog.stores||{}} busy={!!busy||syncing||!data} saving={personalSaving} onToggle={(store,on)=>void toggleStore(store,on)} onLoad={store=>void refresh('catalog','new',[store])}/>:activeTab!=='catalog'?<>
   {used&&<section className="sync card used-sync"><h2>Б/У iPhone · iPeople</h2><p className="job-result">Все предложения видны; товары в наличии показаны первыми.</p><button className="sync-row" disabled={usedScopeBusy||syncing||!products.length} onClick={()=>refresh('prices','used')}><RefreshCw size={18}/><span><strong>Обновить цены Б/У</strong><small>Проверить сохранённые предложения iPeople</small></span></button><button className="sync-row" disabled={usedScopeBusy||syncing||!data} onClick={()=>refresh('catalog','used')}><Database size={18}/><span><strong>Загрузить каталог Б/У</strong><small>Только предложения iPeople</small></span></button></section>}
   {used&&<section className="selection card"><div className="section-heading"><h2>Б/У iPhone</h2></div><div className="select-grid"><label>Модель<div className="select-wrap"><select aria-label="Модель Б/У iPhone" value={usedModel} onChange={e=>{setUsedModel(e.target.value);setUsedStorage('');}}><option value="">Все модели</option>{models.map(m=><option key={m} value={m}>iPhone {m}</option>)}</select><ChevronDown size={16}/></div></label><label>Память<div className="select-wrap"><select aria-label="Память Б/У iPhone" value={usedStorage} onChange={e=>setUsedStorage(e.target.value)}><option value="">Любая память</option>{usedMemories.map(m=><option key={m}>{m}</option>)}</select><ChevronDown size={16}/></div></label></div></section>}
   {!used&&<section className="selection card"><div className="section-heading"><h2>{used?'Ваш Б/У iPhone':'Ваш '+categoryLabels[selectedCategory]}</h2><span className="tiny-label">01 — Выберите конфигурацию</span></div>{!used&&<label className="classic-category">Техника<div className="select-wrap"><select aria-label="Категория техники" value={category} onChange={e=>{changeCategory(e.target.value as AppleCategory);}}>{appleCategories.map(c=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select><ChevronDown size={16}/></div></label>}<div className="select-grid">{selectedCategory==='mac'&&<label>Состояние<div className="select-wrap"><select aria-label="Состояние Mac" value={macCondition} onChange={e=>{setMacCondition(e.target.value);setHardwareChoice({...emptyHardwareChoice});setRam('');}}><option value="Standard">Новые</option><option value="OpenBox">Open Box</option></select><ChevronDown size={16}/></div></label>}{hardware?<>{hardwareKeys.filter(key=>hardwareSelection.options[key].length&&(key!=='screen'||hardwareSelection.options.screen.some(value=>value&&value!=='Не указана'))).map(key=><label key={key}>{({deviceClass:'Класс',tier:'Вариант процессора',generation:'Процессор',screen:'Диагональ',glass:'Тип матрицы',network:'Подключение'})[key]}<div className="select-wrap"><select aria-label={({deviceClass:'Класс устройства',tier:'Вариант процессора',generation:'Поколение процессора',screen:'Диагональ экрана',glass:'Тип матрицы',network:'Подключение iPad'})[key]} value={hardwareSelection.values[key]} onChange={e=>chooseHardware(key,e.target.value)}>{hardwareSelection.options[key].map((value:string)=><option key={value} value={value}>{key==='screen'&&value!=='Не указана'?value+'″':key==='glass'?(value==='nano'?'Nano-texture':'Обычная'):key==='network'?(value==='wifi'?'Wi-Fi only':value==='cellular'?'Wi-Fi + Cellular':'Не указано'):value}</option>)}</select><ChevronDown size={16}/></div></label>)}</>:<label>Модель<div className="select-wrap"><select value={model} onChange={e=>{setModel(e.target.value);setWatchBand('');setRam('');}} aria-label="Модель устройства"><option value="" disabled>Выберите модель</option>{models.map(m=><option key={m} value={m}>{phone?'iPhone ':''}{m}</option>)}</select><ChevronDown size={16}/></div></label>}{selectedCategory==='watch'&&<label>Тип ремешка<div className="select-wrap"><select aria-label="Тип ремешка" value={selectedWatchBand} onChange={e=>setWatchBand(e.target.value)}>{watchBands.map(value=><option key={value} value={value}>{value}</option>)}</select><ChevronDown size={16}/></div></label>}{memories.some(m=>m!=='—')&&<label>{macbook?'Накопитель (SSD)':'Память'}<div className="select-wrap"><select value={storage} onChange={e=>{setStorage(e.target.value);setRam('');}} aria-label="Объём памяти"><option value="" disabled>Память</option>{memories.map(m=><option key={m}>{m}</option>)}</select><ChevronDown size={16}/></div></label>}</div>{macbook&&<label className="classic-category ram-select">Оперативная память<div className="select-wrap"><select aria-label="Оперативная память" value={ram} onChange={e=>setRam(e.target.value)}><option value="">Любой объём</option>{ramOptions.map(value=><option key={value} value={value}>{value==='unknown'?'Не указана магазином':value.replace('GB',' ГБ')}</option>)}</select><ChevronDown size={16}/></div></label>}{phone&&!used&&!sims.includes('unknown')&&<><div className="sim-label">SIM-карта</div><div className="segmented">{[['physical','Физическая SIM'],['esim','eSIM'],...(sims.includes('unknown')?[['unknown','SIM не указана']]:[])].map(([value,label])=><button key={value} disabled={!sims.includes(value)} aria-pressed={sim===value} className={sim===value?'selected':''} onClick={()=>setSim(value)}>{sim===value&&<Check size={14}/>} {label}</button>)}</div></>}</section>}
   {!used&&selectedCategory==='mac'&&macCondition==='OpenBox'&&<div className="job-result"><p>Open Box · отдельные товары МойСклад. Остатки не смешиваются с новой техникой.</p>{<button type="button" className="rate-refresh" disabled={openBoxLoading||stockPaused} onClick={()=>void refreshOpenBox()}>{openBoxLoading?'Загружаем…':'Обновить каталог Open Box'}</button>}</div>}<label className="classic-search"><Search size={17}/><input type="search" aria-label={used?"Поиск по всем Б/У iPhone":"Поиск в выбранной модели"} placeholder={used?"Модель, память, цвет или артикул":"Цвет, артикул или характеристика"} value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <p className="job-result">{stockPaused?'МойСклад отключён · показаны сохранённые остатки':stockOnOpen?(stockViewPending?'Проверяем остатки выбранной модели…':used&&!usedModel?'Выберите модель — остатки загрузятся автоматически':stockViewPartial?'Не все остатки подтвердились · показаны последние проверенные данные':'Остатки загружаются при открытии модели · обновить вручную можно кнопкой ↻'):stockLive?(stockFailed?'Нет связи · показаны последние сохранённые остатки':!stockSyncedAt||clock-Date.parse(stockSyncedAt)>180000?'Остатки устарели · ждём подтверждения МойСклада':'Общие остатки · проверка изменений раз в минуту'):'Остатки — из сохранённой базы. Обновление вручную: ↻ в карточке или «Обновить все остатки» сверху.'}</p>
   <div className="results-heading"><div><h2>{used?'Предложения iPeople':phone?'Цены по цветам':'Цены по комплектациям'}</h2><span>{used?(usedModel?'iPhone '+usedModel+(usedStorage?' · '+usedStorage:''):'Все модели · сначала в наличии'):model?`${hardware?hardwareSummary:(phone?'iPhone ':'')+model}${storage==='—'?'':' · '+storage}${macbook&&ram?' · RAM '+(ram==='unknown'?'не указана':ram.replace('GB',' ГБ')):''}${!phone||used||sim==='unknown'?'':' · '+(sim==='esim'?'eSIM':'SIM')}`:'Выберите конфигурацию'}</span></div><div className="results-tools"><span className="results-count">{rows.length}</span></div></div>
   {!data?.rate&&<button className="rate-prompt" onClick={()=>{setRateDraft('');setRateOpen(true);}}><Coins size={18}/><span>Обновите курс iPeople для цен в долларах</span><ArrowRight size={16}/></button>}
   {loading||used&&stockLoading&&!rows.length?<div className="empty card">{used?"Загружаем сохранённые остатки…":"Загружаем сохранённую базу…"}</div>:rows.length?<div className="results">{rows.map(row=><article className="price-card card" key={row.key}><div className="color-heading"><div className="color-name"><span className="swatch" style={{background:colorHex(row.color)}}/><h3>{used?row.title:phone?row.color:row.title}</h3></div><div className="card-actions"><button type="button" className="copy-card card-refresh" disabled={cardRefreshing(row)||syncing||loading||!!row.iPeople?.stock_id} onClick={()=>void refreshCard(row)} aria-label={'Обновить цены карточки '+(phone?row.color:row.title)} aria-busy={cardRefreshing(row)} title="Обновить цены только этой карточки"><RefreshCw size={17} className={cardRefreshing(row)?'spin':''}/></button><button type="button" className="copy-card" onClick={()=>void copyCard(row)} aria-label={copied===row.key?"Скопировано":"Скопировать название и цены"} title="Копировать название и цены">{copied===row.key?<Check size={16}/>:<Copy size={16}/>}<span>{copied===row.key?"Скопировано":"Копировать"}</span></button><button type="button" className="copy-card send-boss" onClick={()=>sendToBoss(row)} title={'Открыть черновик для @'+settings.bossRecipient} aria-label={'Открыть черновик для @'+settings.bossRecipient}><Send size={16}/><span>Отправить шефу</span></button></div></div>{!phone&&<div className="configuration-chips">{configurationChips(row.offers?.[0]).map(chip=><span key={chip}>{chip}</span>)}</div>}<div className="offer-list" aria-label="Цены магазинов">{stores.map(store=>{const p=row[store],priced=hasPrice(p);return <div key={store} className={'offer-item'+(priced?'':' offer-empty')}><div className="offer-shop"><strong>{p?<a href={p.url} target="_blank" rel="noopener noreferrer">{storeLabels[store]} <ArrowUpRight size={12}/></a>:storeLabels[store]}</strong><small>{p?used?(stockValues[p.store+'|'+p.url]?.some(n=>typeof n==='number'&&n>0)?'В наличии':stockValues[p.store+'|'+p.url]?.every(n=>typeof n==='number')?'Нет в наличии':'Наличие не проверено')+(hasPrice(p)&&['error','deferred','unavailable'].includes(p.status)?' · последняя цена':''):p.edition==='OpenBox'?(hasPrice(p)?'Open Box · новое − $100':'Open Box · цена не рассчитана'):priceLabel(p):missingPriceReason(store,selectedCategory,data?.catalog,data?.job)}</small>{p?.sku&&<span className="offer-article">{p.sku}</span>}{p?.stock_id&&p.metadata_notice&&<small>{p.metadata_notice}</small>}{phone&&store!=='iSpace'&&p?.sim==='unknown'&&<small className="sim-warning">SIM не указана</small>}</div><div className="offer-price">{priced?<><button type="button" className="price-history-trigger" onClick={()=>setHistoryProduct(p)} aria-label={"История цены "+storeLabels[store]} title="Посмотреть историю цены">{money(Number(p.price))}<span className="uah"> ₴</span></button>{data?.rate&&<span className="offer-usd">${money(Math.round(Number(p.price)/Number(data.rate)))}</span>}<small>{formatPriceDate(p.last_success_at||p.checked_at)?'Цена '+formatPriceDate(p.last_success_at||p.checked_at):'Дата не указана'}</small></>:<span className="missing">—</span>}</div></div>;})}</div>{!phone&&<details className="offer-originals"><summary>Названия в магазинах</summary>{stores.filter(store=>row[store]).map(store=><p key={store}><strong>{storeLabels[store]}</strong> {row[store].full_title||row[store].model}</p>)}</details>}<div className="warehouse-stock" aria-label="Остатки по складам">{rowStockDetails(row.offers||[row.iPeople].filter(Boolean),stockValues,stockVerifiedAt).map(({quantity,checkedAt,conflict},index)=><span className="stock-quantity" key={stockWarehouses[index].label} title={stockWarehouses[index].name+(checkedAt?' · Проверено '+formatKyivDate(checkedAt):'')}><span>{stockWarehouses[index].label}:</span> <strong>{quantity===null?(conflict?'разные данные':'не проверено'):quantity}</strong><small>{quantity===null?'':formatPriceDate(checkedAt)||'дата неизвестна'}</small></span>)}<button type="button" className="stock-card-refresh" disabled={stockPaused||stockRefreshingAll||stockPendingCards.includes(targetKey(cardTargets(row)))} aria-label={'Обновить остатки карточки '+(used?row.title:phone?row.color:row.title)} title="Обновить только остатки этой карточки" onClick={()=>void refreshStockCard(row)}><RefreshCw size={15} className={stockPendingCards.includes(targetKey(cardTargets(row)))?'spin':''}/></button></div></article>)}</div>:<div className="empty card"><Smartphone size={26}/><h3>{used?stockFailed?'Не удалось загрузить сохранённые остатки':!stockUpdatedAt?'База остатков ещё не загружена':products.length?'Нет подходящих Б/У iPhone':'Каталог Б/У ещё не загружен':products.length?'Нет подтверждённых предложений':'База пока пуста'}</h3><p>{used?stockFailed?'Повторите загрузку базы.':!stockUpdatedAt?'Нажмите «Обновить остатки».':query?'Измените поисковый запрос.':products.length?'Измените модель, память или поисковый запрос.':'Нажмите «Загрузить каталог Б/У» выше.':products.length?'Выберите другую конфигурацию.':'Нажмите «Обновить весь каталог» в разделе «Моя база».'}</p>{used&&stockFailed&&<button className="primary" onClick={()=>void updateStocks()}>Повторить</button>}</div>}
   <div className="footnote"><span className="dot"/> Из сохранённой базы{date&&<> · {date}</>}</div>
  </>:<>
    <section className="registry-experiment card"><h2>Справочник конфигураций · тест</h2><p>Сопоставление по артикулам с отдельными полями чипа, RAM, SSD, экрана, стекла, подключения и ремешка. Режим действует только на этом устройстве.</p><label><input type="checkbox" aria-label="Тестовый справочник конфигураций" checked={registryEnabled} onChange={e=>toggleRegistry(e.target.checked)}/> Использовать тестовый справочник</label>{registryEnabled&&<p role="status">{registryLoading?'Готовим справочник…':registry?`Артикулов: ${Object.keys(registry.records).length}. Конфликтов: ${Object.values(registry.records).filter(record=>record.conflicts.length).length}. При конфликте сохранено прежнее сопоставление.`:'Ожидаем каталог…'}</p>}<p>Цены и исходные названия сохраняются. Выключатель сразу возвращает прежнее сопоставление.</p>{registryEnabled&&<button className="primary" onClick={()=>toggleRegistry(false)}>Вернуться к прежнему сопоставлению</button>}</section><section className="database-card card"><div className="db-icon"><Database size={25}/></div><h2>Общая база в облаке.</h2><p>Одна база на телефоне и компьютере.<br/>Проверенные цены и очередь обновления сохраняются на сервере.</p><div className="stats"><div><strong>{allProducts.length}</strong><span>товаров</span></div><div><strong>{new Set(allProducts.map(p=>p.model)).size}</strong><span>моделей</span></div><div><strong>{good}</strong><span>цен в наличии</span></div></div>{date&&<div className="updated">Обновлено {date}</div>}</section>
    <section className="sync card"><h2>Обновление базы</h2><button className="sync-row" disabled={busy||syncing} onClick={()=>refresh('prices')}><span className="action-icon"><RefreshCw size={19}/></span><span><strong>Обновить цены</strong><small>Проверить цены и наличие известных товаров</small></span><ArrowUpRight size={18}/></button><button className="sync-row" disabled={busy||syncing} onClick={()=>refresh('catalog','all')}><span className="action-icon purple"><Database size={19}/></span><span><strong>Обновить весь каталог</strong><small>Загрузить новые и Б/У модели, варианты и цены</small></span><ArrowUpRight size={18}/></button></section>
    <div className="store-status">{stores.map(store=><div key={store}><span className={'dot '+(data?.catalog.stores[store]?.status==='error'?'red':'')}/><strong>{store}</strong><span>{data?.catalog.stores[store]?.status==='error'?'Ошибка последнего обновления':data?.catalog.stores[store]?.status==='partial'?'Часть цен не обновилась':data?.catalog.stores[store]?'Сохранён в базе':'Ещё не загружен'}</span></div>)}</div>
  </>}
  {busy&&<section role="status" className="progress-card card"><div><RefreshCw size={16} className="spin"/><strong>{data.job.kind==='catalog'?'Обновляем каталог':'Обновляем цены'}</strong><span>{data.job.progress}%</span></div><progress max="100" value={data.job.progress}/><p>{data.job.message} Прогресс сохранён на сервере. После закрытия можно продолжить с того же места.</p></section>}
  {data?.job&&['succeeded','partial','failed'].includes(data.job.status)&&<div className={'job-result '+(data.job.status==='succeeded'?'success':'')} role="status">{data.job.message}</div>}
  {session?.provider!=='public'&&<button className="admin-entry" onClick={()=>setAdminOpen(v=>!v)}>{isOwner?'⚙ Панель владельца':!ownerConfigured?'Доступ владельца':'⚙'}</button>}
  <footer>Apple Compare<span>Только подтверждённые цены.</span></footer>
  {rateOpen&&<div className="modal-backdrop" onClick={()=>setRateOpen(false)}><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="rateTitle" onClick={e=>e.stopPropagation()}><button className="close-modal" aria-label="Закрыть" onClick={()=>setRateOpen(false)}><X size={18}/></button><div className="db-icon"><Coins size={25}/></div><h2 id="rateTitle">Курс доллара iPeople</h2><p>Автоматически обновляется вместе с ценами с <a href="https://www.ipeople.in.ua/" target="_blank" rel="noopener noreferrer">ipeople.in.ua</a>.{data?.rateSource&&data.rateCheckedAt?' Проверен: '+formatKyivDate(data.rateCheckedAt)+'.':''} Ручной курс будет заменён при следующем обновлении.</p><button type="button" className="primary" disabled={saving||syncing} onClick={async()=>{setSaving(true);try{await updateRate();}finally{setSaving(false);}}}>{saving?'Обновляем…':'Обновить с iPeople'}</button><form onSubmit={saveRate}><label htmlFor="rateInput">Гривен за $1</label><div className="rate-input"><span>$1 =</span><input id="rateInput" autoFocus inputMode="decimal" placeholder="42.50" value={rateDraft} onChange={e=>setRateDraft(e.target.value)} required/><span>₴</span></div><button className="primary" disabled={saving}>{saving?'Сохраняем…':'Сохранить вручную'}</button></form></section></div>}
 {historyProduct&&<PriceHistory product={historyProduct} rate={data?.rate} onClose={()=>setHistoryProduct(null)}/> }</main>;
}

function configurationChips(p?:Product){if(!p)return [];const title=p.full_title||p.model,ram=macbookRam(p),cores=[...title.matchAll(/(\d+)[\s-]*(?:C|cores?)?[\s-]*(CPU|GPU)\b/ig)].map(m=>m[1]+' '+m[2].toUpperCase());return [...new Set([ram?'RAM '+ram.replace('GB',' ГБ'):'',p.storage!=='—'?p.storage:'',...cores,/nano.?texture|нанотекстур/i.test(title)?'Nano-texture':'',/cellular|\bLTE\b|\b[345]G\b/i.test(title)?'Cellular':/wi[ -]?fi/i.test(title)?'Wi-Fi':'',/\b[SM]\/[ML]\b/i.exec(title)?.[0]||'',/\b\d{2}\s*mm\b/i.exec(title)?.[0]||'',categoryOf(p)==='watch'?/(?:[A-Z][a-z]+\s+){1,3}(?:Sport Band|Ocean Band|Alpine Loop|Trail Loop)/.exec(title)?.[0]||'':'',categoryOf(p)==='watch'&&/\bGPS\b/i.test(title)&&!/Cellular|LTE|eSIM/i.test(title)?'GPS':'',categoryOf(p)==='airpods'?/Active Noise Cancellation|\bANC\b/i.test(title)?'ANC':/Wireless Charging/i.test(title)?'Wireless Charging':/USB[ -]?C/i.test(title)?'USB-C':/Lightning/i.test(title)?'Lightning':'':'',p.sku||''].filter(Boolean))];}
