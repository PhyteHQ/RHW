/* DTR // Trade Routes: ship registry and custom flight profiles.
   Darkstat POST /api/ships is the canonical live source. */
export const DEFAULT_SHIP_ID='ship:dsy_corsair_transport';
export const DEFAULT_FAVORITES=Object.freeze([
  'ship:dsy_tribun','ship:dsy_corsair_transport','ship:dsy_bsgalactica'
]);
export const DOCK_CLASSES=Object.freeze({
  1:Object.freeze({label:'RING',nav:'berth'}),
  2:Object.freeze({label:'MID',nav:'medium'}),
  3:Object.freeze({label:'LARGE',nav:'large'})
});
const SKIP_NICKNAMES=new Set(['dsy_slaveliner','dsy_pi_freighter']);
const ALIASES=Object.freeze({
  dsy_mercatante:Object.freeze({name:'Correo',terms:['Coreo','Corsair Freighter']}),
  dsy_bsgalactica:Object.freeze({name:'Essedarius',terms:['Corsair Train']}),
  dsy_corsair_transport:Object.freeze({name:'Armicustos',terms:['Corsair Transport']}),
  dsy_tribun:Object.freeze({name:'Raba',terms:['Hogosha Frigate']}),
  pilgrim_liner:Object.freeze({name:'Pilgrim',terms:['Pilgrim Liner']}),
  bristol_transport:Object.freeze({name:'Bulwark',terms:['Bristol Heavy Explorer']})
});
export const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const reasonableInteger=(value,lower,upper)=>{
  if(value===null||value===undefined||value==='')return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=lower&&number<=upper?number:null;
};
const profileKey=value=>'ship:'+String(value);
const short=value=>String(value??'').trim().slice(0,100);
function makeShip(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const nickname=short(raw.nickname),cargo=reasonableInteger(raw.hold_size,1,50000),
    cruise=reasonableInteger(raw.cruise_speed,1,3000),
    dockType=reasonableInteger(raw.dock_type,1,3),dock=DOCK_CLASSES[dockType];
  if(!nickname||!cargo||!cruise||!dock||SKIP_NICKNAMES.has(nickname.toLowerCase()))return null;
  const apiName=short(raw.name)||nickname;
  const alias=ALIASES[nickname.toLowerCase()];
  const name=alias?.name||apiName;
  const terms=[name,apiName,nickname,raw.type,...(alias?.terms||[])];
  return Object.freeze({id:profileKey(nickname),nickname,name,apiName,type:short(raw.type)||'ship',
    cargo,cruise,dock:dock.nav,dockType,dockLabel:dock.label,
    custom:false,source:'darkstat',
    searchKey:norm(terms.join(' '))});
}
export function normalizeShipRegistry(response){
  if(!Array.isArray(response)||response.length>15000)throw Error('Darkstat ship registry format invalid.');
  const byId=new Map();
  for(const item of response){
    const candidate=makeShip(item);
    if(candidate&&!byId.has(candidate.id))byId.set(candidate.id,candidate);
  }
  if(!byId.size)throw Error('No navigable ships with usable cargo, speed and docking data.');
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'en')||a.nickname.localeCompare(b.nickname,'en'));
}
// Last verified fallback for offline-first DTR. Use only until live/cache loads.
export const FALLBACK_SHIPS=Object.freeze([
  ['dsy_mercatante','Correo','freighter',600,500,1],
  ['dsy_tribun','Hogosha Frigate','transport',3150,500,2],
  ['dsy_corsair_transport','Corsair Transport','transport',3600,500,2],
  ['dsy_bsgalactica','Corsair Train','transport',4450,350,2],
  ['pilgrim_liner','Pilgrim Liner','capital',4300,415,3],
  ['bristol_transport','Bristol Heavy Explorer','capital',4300,415,3],
  ['dsy_advanced_train','Advanced Train','transport',5000,350,2]
].map(([nickname,name,type,hold_size,cruise_speed,dock_type])=>
  makeShip({nickname,name,type,hold_size,cruise_speed,dock_type})));
export function findProfile(list,id){
  return Array.isArray(list)?list.find(ship=>ship.id===id)||null:null;
}
export function searchShipProfiles(profiles,query,limit=70){
  if(!Array.isArray(profiles))return [];
  const words=norm(query).split(' ').filter(Boolean);
  if(!words.length)return profiles.slice(0,limit);
  return profiles.filter(x=>words.every(word=>x.searchKey.includes(word))).slice(0,limit);
}
export function resolveSavedFavorites(saved,profiles){
  const ids=Array.isArray(saved)?saved.slice(0,3):[];
  return DEFAULT_FAVORITES.map((id,i)=>{
    const requested=typeof ids[i]==='string'?ids[i]:id;
    return findProfile(profiles,requested)?requested:findProfile(profiles,id)?id:profiles[0]?.id||null;
  });
}
export function validateCustomProfile(input,id){
  const name=String(input?.name??'').trim().replace(/\s+/g,' ').slice(0,46);
  const cargo=reasonableInteger(input?.cargo,1,50000);
  const cruise=reasonableInteger(input?.cruise,1,3000);
  const dockType=reasonableInteger(input?.dockType,1,3);
  if(!name||name.length<2)throw Error('Enter a ship profile name (at least 2 characters).');
  if(!cargo)throw Error('Cargo capacity must be an integer from 1 to 50,000.');
  if(!cruise)throw Error('Cruise speed must be an integer from 1 to 3,000 m/s.');
  if(!DOCK_CLASSES[dockType])throw Error('Select RING, MID or LARGE docking.');
  if(!/^custom:[a-z0-9-]{3,55}$/i.test(id||''))throw Error('Invalid custom profile ID.');
  return Object.freeze({id,name,apiName:'CUSTOM / USER DEFINED',nickname:id,
    type:'custom',cargo,cruise,dock:DOCK_CLASSES[dockType].nav,dockType,
    dockLabel:DOCK_CLASSES[dockType].label,custom:true,source:'local',searchKey:norm(name+' custom')});
}
export function restoreCustomProfiles(input){
  if(!Array.isArray(input))return [];
  const list=[],ids=new Set();
  for(const row of input.slice(0,40)){
    try{
      const profile=validateCustomProfile(row,row.id);
      if(ids.has(profile.id))continue;
      ids.add(profile.id);list.push(profile);
    }catch{}
  }
  return list;
}
export function storageCustomProfiles(profiles){
  return profiles.filter(x=>x.custom).map(({id,name,cargo,cruise,dockType})=>({id,name,cargo,cruise,dockType}));
}
// Physical mooring restrictions read from Discovery's published navigation graph.
// Missing graph nodes are UNKNOWN, never treated as proof of physical access.
export function dockEligibility(baseId,profile,navigation,nodeIndex=null){
  if(!baseId||!verifyShipProfile(profile)||!navigation?.baseNodes)return 'unknown';
  const nodeId=navigation.baseNodes[baseId];
  if(!nodeId)return 'unknown';
  const node=nodeIndex?.get(nodeId)||navigation.nodes?.find(n=>n.id===nodeId);
  if(!node||!Array.isArray(node.allows)||!node.allows.length)return 'unknown';
  return node.allows.includes(profile.dock)?'allowed':'blocked';
}
export function blockedShipDocks(bases,profile,navigation){
  if(!navigation?.nodes||!Array.isArray(bases))return [];
  const byNode=new Map(navigation.nodes.map(node=>[node.id,node]));
  return bases.filter(base=>dockEligibility(base.id,profile,navigation,byNode)==='blocked')
    .map(base=>base.id);
}

export function verifyShipProfile(profile){
  return Boolean(profile&&reasonableInteger(profile.cargo,1,50000)&&reasonableInteger(profile.cruise,1,3000)&&
    DOCK_CLASSES[profile.dockType]?.nav===profile.dock);
}
