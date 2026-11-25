import {appleCategories,type AppleCategory} from './apple-products.ts';
import {emptyHardwareChoice,type HardwareChoice} from './configuration-filters.ts';
export type RememberedSelection={macCondition?:string;model:string;storage:string;sim:string;ram:string;watchBand:string;hardwareChoice:HardwareChoice;usedModel:string;usedStorage:string};
export const emptySelection:RememberedSelection={macCondition:'Standard',model:'',storage:'',sim:'physical',ram:'',watchBand:'',hardwareChoice:{...emptyHardwareChoice},usedModel:'',usedStorage:''};
type Memory={category:AppleCategory;used:boolean;selections:Record<string,RememberedSelection>};
const key=(user:string)=>'apple-compare:selections:v1:'+user;
const text=(value:unknown)=>typeof value==='string'&&value.length<=200?value:'';
export function readSelectionMemory(user:string):Memory{
 try{const raw=JSON.parse(localStorage.getItem(key(user))||'null');const selections:Record<string,RememberedSelection>={};for(const category of [...appleCategories,'used']){const value=raw?.selections?.[category];if(!value)continue;selections[category]={...emptySelection,macCondition:value.macCondition==='OpenBox'?'OpenBox':'Standard',...Object.fromEntries(['model','storage','sim','ram','watchBand','usedModel','usedStorage'].map(k=>[k,text(value[k])])),hardwareChoice:{...emptyHardwareChoice,...Object.fromEntries(Object.keys(emptyHardwareChoice).map(k=>[k,text(value.hardwareChoice?.[k])]))}};}return {category:appleCategories.includes(raw?.category)?raw.category:'iphone',used:raw?.used===true,selections};}catch{return {category:'iphone',used:false,selections:{}};}
}
export function rememberSelection(user:string,scope:string,selection:RememberedSelection,category:AppleCategory,used:boolean){try{const old=readSelectionMemory(user);localStorage.setItem(key(user),JSON.stringify({...old,category,used,selections:{...old.selections,[scope]:selection}}));}catch{}}
