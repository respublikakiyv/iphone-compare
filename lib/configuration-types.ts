export type CanonicalFields={deviceClass?:string;generation?:string;chipVariant?:string;ram?:string;storage?:string;diagonal?:string;glass?:'standard'|'nano';network?:'wifi'|'cellular';bandType?:string;color?:string;cpu?:string;gpu?:string;watchSize?:string;bandFit?:string;modelLabel?:string};
export type ProductConfiguration=CanonicalFields&{schema:1;id:string};
export type ConfigurationRecord={id:string;category:string;article:string;fields:CanonicalFields;conflicts:string[];sources:string[]};
export type ConfigurationRegistry={schema:1;catalogVersion:string;createdAt:string;records:Record<string,ConfigurationRecord>};
