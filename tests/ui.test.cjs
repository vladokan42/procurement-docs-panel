// No dependencies: exercise reused UI handlers in Node's VM with a tiny DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const context = {console, setTimeout:()=>{}, clearTimeout:()=>{}, requestAnimationFrame:()=>{}, window:{},
  document:{addEventListener:()=>{}, getElementById:(id)=>elements.get(id)||null,
    querySelectorAll:()=>[], body:{style:{}}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/panel.js','utf8'), context);
function run(s){return vm.runInContext(s,context);}
function element(value=''){return {value, textContent:'', classList:{add(){},remove(){}},focus(){}};}
elements.set('meta-supplier',element('Демо'));
elements.set('kp-meta-supplier',element('Демо'));
elements.set('spec-totals',element());
elements.set('kp-totals',element());
assert.equal(run('createEmptyRow().vat_rate'),null,'unknown VAT must stay unknown');
for(const rate of [0,.1,.2,.22]){
  run(`specRows=[{...createEmptyRow(),article:'MANUAL',name:'Свободное имя',vat_rate:${rate},pcs_per_box:3}]`);
  elements.set('row-p-with-vat-0',element());
  elements.set('row-p-no-vat-0',element());
  elements.set('row-box-with-vat-0',element());
  elements.set('row-box-no-vat-0',element());
  context.input=element('100');
  run('onLoadPriceNoVatInput(0,input)');
  assert.equal(run('specRows[0].price_with_vat'),{0:100,.1:110,.2:120,.22:122}[rate]);
  context.input=element(String({0:200,.1:220,.2:240,.22:244}[rate]));
  run('onLoadPriceWithVatInput(0,input)');
  assert.equal(run('specRows[0].price_no_vat'),200);
  assert.ok(elements.get('spec-totals').textContent.includes('600,00'));
  run(`kpRows=[{...createEmptyKpRow(),name:'Произвольное имя',vat_rate:${rate},pcs_per_box:3,cost_with_vat:80}]`);
  context.input=element('100');run('onKpPriceSaleNoVatInput(0,input)');
  assert.equal(run('kpRows[0].price_sale_with_vat'),{0:100,.1:110,.2:120,.22:122}[rate]);
  context.input=element(String({0:200,.1:220,.2:240,.22:244}[rate]));
  run('onKpPriceSaleWithVatInput(0,input)');
  assert.equal(run('kpRows[0].price_sale_no_vat'),200);
  assert.ok(elements.get('kp-totals').textContent.includes('600,00'));
}
run("specRows=[createEmptyRow()]");context.input=element('Моё ручное наименование');run('onNameInput(0,input)');
assert.equal(run('specRows[0].name'),'Моё ручное наименование');
for(const bad of ['1junk','NaN','Infinity','1.2.3']) assert.equal(run(`parseRuNum(${JSON.stringify(bad)})`),null);

// Setting VAT back to unknown must clear the calculated partner and totals.
run('kpRows=[{...createEmptyKpRow(),name:"ручное",pcs_per_box:3,vat_rate:0.2,price_sale_no_vat:100,price_sale_with_vat:120,cost_with_vat:80}]');
run('kpRows[0].vat_rate=null;recalcKpRow(0,"vat_change")');
assert.equal(run('kpRows[0].price_sale_with_vat'),null);
assert.ok(elements.get('kp-totals').textContent.includes('0,00'));
// Catalog-suggested net prices must populate live gross and totals on rendering.
run('specRows=[{...createEmptyRow(),name:"каталог",article:"DEMO",pcs_per_box:3,vat_rate:0,price_no_vat:100}]; syncSpecMoney(specRows[0]); updateTotals()');
assert.equal(run('specRows[0].price_with_vat'),100);
assert.ok(elements.get('spec-totals').textContent.includes('300,00'));

// A gross price entered before choosing VAT is retained, not silently lost.
run('kpRows=[createEmptyKpRow()]');context.input=element('120');run('onKpPriceSaleWithVatInput(0,input)');
assert.equal(run('kpRows[0].price_sale_with_vat'),120);
assert.equal(run('kpRows[0].price_sale_no_vat'),null);
run('specRows=[createEmptyRow()]');context.input=element('120');run('onLoadPriceWithVatInput(0,input);syncSpecMoney(specRows[0])');
assert.equal(run('specRows[0].price_with_vat'),120);
assert.equal(run('specRows[0].price_no_vat'),null);

// UI rounds the entered unit price before VAT, matching the server's pennies.
run('specRows=[{...createEmptyRow(),name:"копейки",article:"M",pcs_per_box:3,vat_rate:0.2}]');
context.input=element('1.005');run('onLoadPriceNoVatInput(0,input)');
assert.equal(run('specRows[0].price_no_vat'),1.01);
assert.equal(run('specRows[0].price_with_vat'),1.21);
assert.ok(elements.get('spec-totals').textContent.includes('3,63'));

// Delayed autocomplete cannot attach itself to a removed/re-rendered input.
elements.set('spec-global-autocomplete',{style:{display:'none'}});
context.stale={isConnected:false,getBoundingClientRect:()=>({left:0,bottom:0,width:0})};
run('renderGlobalAutocomplete(0,[],stale)');
assert.equal(elements.get('spec-global-autocomplete').style.display,'none');
context.window.innerWidth=390;context.window.innerHeight=844;
context.active={isConnected:true,getBoundingClientRect:()=>({left:80,bottom:500,width:220})};
context.document.activeElement=context.active;
run('renderGlobalAutocomplete(0,[],active)');
assert.ok(parseFloat(elements.get('spec-global-autocomplete').style.width)<=374);
console.log('UI math/manual-input checks passed');
