import {readDevice} from './device-catalog.ts';
const pointer='apple-compare:last-catalog-user';
export function rememberCatalogUser(user:string){try{localStorage.setItem(pointer,user);}catch{}}
export function readLatestCatalog(){try{const user=localStorage.getItem(pointer)||'public',saved=readDevice(user);return saved?.catalog.products.length?{cacheUser:user,catalog:saved.catalog,catalogVersion:saved.catalogVersion,cachedAt:saved.cachedAt||saved.catalog.updated_at}:null;}catch{return null;}}
