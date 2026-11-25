import {visitor,json,failure} from '../../../lib/auth';
import {readCatalogState} from '../../../lib/catalog-state';
export async function GET(request:Request){try{return json(await readCatalogState(await visitor(request),new URL(request.url).searchParams.get('version')));}catch(e){return failure(e);}}
