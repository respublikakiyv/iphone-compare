import test from 'node:test';
import assert from 'node:assert/strict';
import {hardwareFilters,modernMac,colorHex,equipmentColor,hardwareCatalog} from '../lib/product-selection.ts';
const product=(category,title)=>({category,full_title:title,model:title,storage:'512GB',color:'—'});
test('Mac class, generation, chip variant and diagonal are independent',()=>{
 assert.deepEqual(hardwareFilters(product('mac','MacBook Pro 14.2 M4 Max 36GB 1TB Space Black')),{deviceClass:'Pro',generation:'M4',tier:'Max',screen:'14'});
 assert.deepEqual(hardwareFilters(product('mac','MacBook Air M5 15.3" 16GB/512GB Sky Blue')),{deviceClass:'Air',generation:'M5',tier:'Базовый',screen:'15'});
 assert.equal(hardwareFilters(product('mac','Mac mini M4 Pro 24GB/512GB')).screen,'');
 assert.equal(hardwareFilters(product('mac','MacBook Neo A18 Pro 13" 8GB/256GB')).screen,'');
 assert.equal(modernMac(product('mac','MacBook Pro 16 M3 Max')),false);
 assert.equal(modernMac(product('mac','MacBook Pro 16 М4 Pro')),true);
 assert.equal(modernMac(product('mac','MacBook Neo A18 Pro')),true);
});
test('iPad family, generation and sizes are parsed without storage becoming diagonal',()=>{
 assert.deepEqual(hardwareFilters(product('ipad','iPad Pro М5 2025 13" Wi-Fi 256GB')),{deviceClass:'Pro',generation:'M5',tier:'Базовый',screen:'13'});
 assert.equal(hardwareFilters(product('ipad','iPad Air 11 M4 128GB')).screen,'11');
 assert.equal(hardwareFilters(product('ipad','iPad mini 8.3" A17 Pro 256GB')).deviceClass,'mini');
 assert.equal(hardwareFilters(product('ipad','iPad A16 11" 128GB')).generation,'A16');
 assert.equal(hardwareFilters(product('ipad','iPad 10 gen 64GB 2022')).generation,'Не указан');
 assert.equal(hardwareFilters(product('ipad','iPad Pro M5 256GB')).screen,'Не указана');
});
test('hardware finishes have their own swatches and retailer grey spelling agrees',()=>{
 const colors=['Space Gray','Space Black','Sky Blue','Midnight','Starlight','Silver','Pink','Purple','Gold','Blue','Yellow'];
 assert.equal(new Set(colors.map(colorHex)).size,colors.length);
 for(const color of colors){assert.notEqual(colorHex(color),'#c3c3ca',color);assert.equal(equipmentColor(product('mac','MacBook Air M4 '+color)),color);}
 assert.equal(colorHex('Space Grey'),colorHex('Space Gray'));
});

test('same article completes omitted chip and screen without inventing absent or conflicting facts',()=>{
 const a={...product('mac','MacBook Neo A18 Pro 13 Retina 256GB (MHFA4)'),sku:'MHFA4'};
 const b={...product('mac','MacBook Neo 256GB Silver (MHFA4)'),sku:'MHFA4'};
 const c=product('ipad','iPad Air 13 2026 128GB (MH5N4)');
 const d=product('ipad','iPad Air 13 M4 128GB (MH5N4)');
 const f=hardwareCatalog([a,b,c,d]);assert.equal(f.get(b).generation,'A18');assert.equal(f.get(b).tier,'Pro');assert.equal(f.get(b).screen,'');assert.equal(f.get(c).generation,'M4');
 assert.equal(modernMac(product('mac','Mac mini Intel 2020')),false);
 assert.equal(hardwareFilters(product('mac','MacBook Pro 14 with Apple M5')).screen,'14');
});

test('mini generation titles still offer the actual processor and diagonal',()=>{
 assert.deepEqual(hardwareFilters(product('ipad','iPad mini 7 128GB')),{deviceClass:'mini',generation:'A17',tier:'Pro',screen:'8.3'});
 assert.deepEqual(hardwareFilters(product('ipad','iPad mini 6 64GB')),{deviceClass:'mini',generation:'A15',tier:'Базовый',screen:'8.3'});
});

test('translated hardware colours get the same swatch as English offers',()=>{
 for(const [name,expected] of [['Космічний сірий','Space Gray'],['Серый космос','Space Gray'],['Космічний чорний','Space Black'],['небесно-блакитний','Sky Blue'],['Жовтий','Yellow']])assert.equal(equipmentColor(product('ipad','iPad Pro M4 '+name)),expected);
});
