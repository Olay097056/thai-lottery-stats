const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'static');
function readFrontend(entry) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts.json'), 'utf8'));
  const files = entry === 'app.js' ? manifest.app : ['shared/server-data.js','shared/ui-state.js',...manifest.engine];
  return files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}
function prepareContext(sandbox){
  const vm=require('node:vm');vm.createContext(sandbox);
  for(const file of ['shared/server-data.js','shared/ui-state.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
  const aliases=JSON.parse(fs.readFileSync(path.join(__dirname,'ui_state_aliases.json'),'utf8'));
  for(const [name,member] of Object.entries(aliases)){
    if(Object.prototype.hasOwnProperty.call(sandbox,name)){
      const [feature,field]=member.split('.');sandbox.LotteryUiState[feature][field]=sandbox[name];
    }
  }
  return sandbox;
}
module.exports = { readFrontend,prepareContext };
