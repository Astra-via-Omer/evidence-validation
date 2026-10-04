let rememberedStep=0;
let cleanup=()=>{};

export function workflowMarkup() {
 return `<section class="workflow-guide" aria-labelledby="ev-heading" id="how-it-works">
 <div class="eyebrow">How it works / Follow the evidence</div>
 <h2 id="ev-heading">From a claim to a review and a ledger record</h2>
 <p class="workflow-intro">Follow each step to see who acts, where the evidence goes, and what you can do. Exploring this guide does not create a task or move money.</p>
 <div id="ev-workflow">
 <div class="workflow-stephead"><span id="ev-number"></span><strong id="ev-title"></strong><span class="tag neutral" id="ev-state"></span></div>
 <div id="ev-diagram"></div>
 <div class="workflow-legend"><span>Solid: application flow</span><span>Dashed: planned Web3 connection</span><span>Mint: current step</span></div>
 <p id="ev-action" class="workflow-action" aria-live="polite"></p>
 <div class="workflow-controls"><button class="btn" id="ev-prev" type="button">Previous step</button><button class="btn primary" id="ev-next" type="button">Next step</button></div>
 </div>
 <p class="workflow-note">Sign in with your existing Astra account. Evidence records are awaiting setup; distributed storage, ledger proofs, and payouts are planned. A ledger preserves provenance and transactions, rather than proving that a claim is true.</p>
 <div class="actions"><button class="textbtn" data-action="demo">Explore a sample task →</button></div>
 </section>`;
}


export function mountWorkflow(feeBps = 1000) {
 cleanup();
 const root=document.getElementById('ev-workflow');
 if(!root)return;
 const fee=Math.floor(2000*feeBps/10000);
 const dollars=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
 const steps=[
  {title:'Sign in with your Astra account',state:'Available',nodes:['people','service','db'],edges:['input','auth'],action:'You: choose Log in and use the same email and password you use in Astra Lab.'},
  {title:'Create an evidence task',state:'Setup pending',nodes:['people','service','db'],edges:['input','auth'],action:'You: choose New task; enter the claim, exact quote, source URL, page, relationship, and proposed budget.'},
  {title:'Open an unpaid pilot task',state:'Operator action · setup pending',nodes:['db','service','reviewers'],edges:['auth','review'],action:'Operator: open an eligible public draft in Supabase. This does not fund the task.'},
  {title:'Review the source independently',state:'Pilot · setup pending',nodes:['reviewers','service','db'],edges:['review','auth'],action:'Reviewer: open the source, compare the quote with the claim, explain the verdict, and declare conflicts.'},
  {title:'Inspect the evidence and reviews',state:'Pilot · setup pending',nodes:['people','service','db'],edges:['input','auth'],action:'You: open the task and export its accessible reviews. Other reviewers’ submissions remain blind to reviewers.'},
  {title:'Export a reproducible evidence bundle',state:'Pilot · setup pending',nodes:['service','bundle'],edges:['export'],action:'You: choose Export evidence bundle to download the JSON record and its SHA-256 digest.'},
  {title:'Publish content and anchor its hash',state:'Planned · not connected',nodes:['bundle','storage','ledger'],edges:['publish','anchor'],action:'Planned: inspect the content address and ledger transaction; compare the stored bundle with the anchored hash.'},
  {title:'Settle an accepted review',state:'Planned · no payments live',nodes:['people','reviewers','ledger'],edges:[],action:`Planned: inspect acceptance and payout receipts. Illustrative $20 quote: ${dollars(2000-fee)} reviewer / ${dollars(fee)} Astra-Via at ${feeBps/100}%.`}
 ];
 let index=rememberedStep;
 const ns='http://www.w3.org/2000/svg';
 function el(tag,attrs={},text){const x=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>x.setAttribute(k,v));if(text!==undefined)x.textContent=text;return x;}
 function draw(){
  if(!root.isConnected)return;
  const step=steps[index];
  root.querySelector('#ev-number').textContent=`${index+1} / ${steps.length}`;
  root.querySelector('#ev-title').textContent=step.title;
  root.querySelector('#ev-state').textContent=step.state;
  root.querySelector('#ev-action').textContent=step.action;
  root.querySelector('#ev-prev').disabled=index===0;
  root.querySelector('#ev-next').disabled=index===steps.length-1;
  const container=root.querySelector('#ev-diagram');
  const w=Math.max(280,Math.floor(container.getBoundingClientRect().width));
  const narrow=w<560;
  const box=narrow?w-32:Math.min(300,w*.43);
  const h=index===6?(narrow?440:430):index===7?(narrow?560:530):(narrow?760:530);
  const svg=el('svg',{viewBox:`0 0 ${w} ${h}`,class:'ev-svg',role:'img','aria-labelledby':'ev-diagram-title ev-diagram-desc'});
  svg.append(el('title',{id:'ev-diagram-title'},`Evidence Validation workflow: ${step.title}`));
  svg.append(el('desc',{id:'ev-diagram-desc'},'Astra Lab, other products, and independent reviewers interact with Evidence Validation. Existing Supabase supplies shared authentication and evidence records. Bundles can be exported. Distributed storage and ledger proofs and payouts are planned. Evidence records still require setup.'));
  const defs=el('defs');
  const marker=el('marker',{id:'ev-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
  marker.append(el('path',{d:'M0 1L9 5L0 9Z',fill:'var(--border)'}));defs.append(marker);
  const activeMarker=el('marker',{id:'ev-arrow-active',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
  activeMarker.append(el('path',{d:'M0 1L9 5L0 9Z',fill:'var(--viz-series-1)'}));defs.append(activeMarker);svg.append(defs);
  const left=w*.255,right=w*.745;
  let positions=narrow?{people:[w/2,45],reviewers:[w/2,145],service:[w/2,250],db:[w/2,355],bundle:[w/2,460],storage:[w/2,565],ledger:[w/2,680]}:{people:[left,48],reviewers:[right,48],service:[w/2,180],db:[left,315],bundle:[right,315],storage:[left,465],ledger:[right,465]};
  let edges=[['input','people','service',false],['review','reviewers','service',false],['auth','service','db',false],['export','service','bundle',false],['publish','bundle','storage',true],['anchor','bundle','ledger',true]];
  let nodes={
   people:['Astra Lab / other products','People: UI · applications: API/MCP'],
   reviewers:['Independent reviewers','People or external AI processes'],
   service:['Evidence Validation','Tasks · reviews · scoped access'],
   db:['Existing Astra Supabase','Shared accounts · records setup pending'],
   bundle:['Evidence bundle','JSON + SHA-256 · after setup'],
   storage:['Distributed storage','IPFS / chosen network · planned'],
   ledger:['Web3 ledger','Hash proofs + settlement · planned']
  };
  if(index===6){
   positions=narrow?{bundle:[w/2,45],storage:[w/2,150],ledger:[w/2,255],viewer:[w/2,370]}:{bundle:[w/2,48],storage:[left,180],ledger:[right,180],viewer:[w/2,350]};
   nodes={bundle:['Evidence bundle','Exact content + SHA-256 digest'],storage:['Distributed storage','Content address / CID · planned'],ledger:['Ledger record','Transaction ID + hash · planned'],viewer:['View proof · planned','Compare content, hash, and record']};
   edges=[['publish','bundle','storage',true],['anchor','bundle','ledger',true],['content','storage','viewer',true],['proof','ledger','viewer',true]];
  }
  if(index===7){
   positions=narrow?{customer:[w/2,45],settlement:[w/2,150],validator:[w/2,255],platform:[w/2,360],receipt:[w/2,485]}:{customer:[w/2,48],settlement:[w/2,180],validator:[left,315],platform:[right,315],receipt:[w/2,465]};
   nodes={customer:['Customer budget','$20 example · future funding'],settlement:['Accepted review','Future settlement adapter / contract'],validator:['Validator payout',`${dollars(2000-fee)} example · not paid`],platform:['Astra-Via fee',`${dollars(fee)} example at ${feeBps/100}% · not paid`],receipt:['Payout receipts · planned','Transaction IDs + amounts + fee']};
   edges=[['fund','customer','settlement',true],['validator','settlement','validator',true],['platform','settlement','platform',true],['receipt1','validator','receipt',true],['receipt2','platform','receipt',true]];
  }
  edges.forEach(([id,a,b,future])=>{
   const [ax,ay]=positions[a],[bx,by]=positions[b];
   let d;
   if(narrow){
    if(a==='people' || a==='service' || Math.abs(by-ay)>125){
     const side=(id==='anchor'||id==='platform'||id==='proof')?w-8:8;
     const edgeX=side>w/2?box/2:-box/2;
     d=`M${ax+edgeX} ${ay}H${side}V${by}H${bx+edgeX}`;
    }else d=`M${ax} ${ay+38}V${by-38}`;
    if(id==='anchor')d=`M${ax+box/2} ${ay}H${w-8}V${by}H${bx+box/2}`;
   }else{
    const start=[ax,ay+38],end=[bx,by-38];
    const middle=(start[1]+end[1])/2;
    d=`M${start[0]} ${start[1]}C${start[0]} ${middle},${end[0]} ${middle},${end[0]} ${end[1]}`;
   }
   const active=index>=6 || step.edges.includes(id);
   svg.append(el('path',{d,class:`ev-edge${future?' future':''}${active?' active':''}`,'marker-end':active?'url(#ev-arrow-active)':'url(#ev-arrow)'}));
  });
  function split(text,max){const words=text.split(' '),lines=[];let line='';words.forEach(word=>{if((line+' '+word).trim().length>max && line){lines.push(line);line=word;}else line=(line+' '+word).trim();});if(line)lines.push(line);return lines;}
  Object.entries(nodes).forEach(([id,labels])=>{
   const [x,y]=positions[id];
   svg.append(el('rect',{x:x-box/2,y:y-38,width:box,height:76,rx:7,class:`ev-node${(index>=6 || step.nodes.includes(id))?' active':''}`}));
   const title=el('text',{x,y:y-13,'text-anchor':'middle'});title.textContent=labels[0];svg.append(title);
   const line=el('text',{x,y:y+8,'text-anchor':'middle',class:'ev-sub'});
   split(labels[1],Math.floor((box-24)/7)).forEach((t,i)=>line.append(el('tspan',{x,dy:i===0?0:18},t)));svg.append(line);
  });
  container.replaceChildren(svg);
 }
 function save(){rememberedStep=index;}
 root.querySelector('#ev-prev').addEventListener('click',()=>{index=Math.max(0,index-1);draw();save();});
 root.querySelector('#ev-next').addEventListener('click',()=>{index=Math.min(steps.length-1,index+1);draw();save();});
 draw();
 const observer=new ResizeObserver(()=>draw());
 observer.observe(root.querySelector('#ev-diagram'));
 cleanup=()=>observer.disconnect();
}
