(function(){
  'use strict';
  const money = (n) => '$' + Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:0});
  const num = (n) => Number(n || 0).toLocaleString();
  const api = async (url, options) => { const r = await fetch(url, options); if(!r.ok) { let e='Request failed'; try{e=(await r.json()).error||e}catch{} throw new Error(e); } return r.status===204?null:r.json(); };

  function setStat(label, value){
    const nodes=[...document.querySelectorAll('.stat-label')];
    const node=nodes.find(n=>n.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));
    if(!node) return;
    const valueNode=node.parentElement.querySelector('.stat-value');
    if(valueNode) valueNode.textContent=value;
  }

  async function boot(){
    try {
      const me=await api('/api/me');
      const data=await api('/api/dashboard');
      document.querySelector('.brand-sub').textContent=me.tenant?.name||'Your Store';
      const metrics=(data.metrics||[]).map(m=>({...m, revenue:Number(m.revenue),adSpend:Number(m.adSpend),refunds:Number(m.refunds)}));
      const totalRevenue=metrics.reduce((a,m)=>a+m.revenue,0);
      const totalOrders=metrics.reduce((a,m)=>a+m.orders,0);
      const totalSessions=metrics.reduce((a,m)=>a+m.sessions,0);
      const totalSpend=metrics.reduce((a,m)=>a+m.adSpend,0);
      if(totalRevenue) setStat('Revenue',money(totalRevenue));
      if(totalOrders) setStat('Orders',num(totalOrders));
      if(totalSessions) setStat('Sessions',num(totalSessions));
      if(totalSpend) setStat('Ad spend',money(totalSpend));
      const connections=data.connections||[];
      const map={WOOCOMMERCE:'WooCommerce',GA4:'Google Analytics 4',GOOGLE_ADS:'Google Ads',META_ADS:'Meta Ads'};
      document.querySelectorAll('.ticker-item').forEach(item=>{
        const name=item.textContent.replace(/·.*$/,'').trim();
        const c=connections.find(x=>map[x.provider]===name);
        if(c){ item.querySelector('.dot')?.classList.remove('on','off','warn','err'); item.querySelector('.dot')?.classList.add(c.status==='CONNECTED'?'on':c.status==='SYNCING'?'warn':'err'); }
      });
      window.StoreBuddy={me,data,refresh:boot};
      wireActions();
    } catch (e) {
      console.warn('StoreBuddy bootstrap failed',e.message);
      if(location.pathname==='/dashboard' && /Authentication|session/i.test(e.message)) location='/login';
    }
  }

  function wireActions(){
    const ask=[...document.querySelectorAll('button')].find(b=>/Ask AI about this data/i.test(b.textContent));
    if(ask && !ask.dataset.bound){ ask.dataset.bound='1'; ask.addEventListener('click', async()=>{ ask.disabled=true; const old=ask.textContent; ask.textContent='Analyzing…'; try{ await api('/api/dashboard/insights/generate',{method:'POST'}); alert('AI insights updated. Open Insights & Alerts to review them.'); await window.StoreBuddy.refresh(); }catch(e){ alert(e.message); } finally { ask.disabled=false; ask.textContent=old; } }); }
    document.querySelectorAll('.source-row .btn').forEach(btn=>{
      if(btn.dataset.bound) return; btn.dataset.bound='1';
      if(/sync now/i.test(btn.textContent)) btn.addEventListener('click', async()=>{ btn.disabled=true; const old=btn.textContent; btn.textContent='Syncing…'; try{ await api('/api/dashboard/sync/woocommerce',{method:'POST'}); await window.StoreBuddy.refresh(); }catch(e){ alert(e.message); }finally{btn.disabled=false;btn.textContent=old;} });
      if(/reconnect/i.test(btn.textContent)) btn.addEventListener('click',()=>{ location='/api/connections/meta/start'; });
    });
  }

  function ensureConnectionSetup(){
    const title=[...document.querySelectorAll('.page h1')].find(x=>/Connections/i.test(x.textContent||''));
    if(!title || document.querySelector('#storebuddy-live-connect')) return;
    const card=document.createElement('div');
    card.id='storebuddy-live-connect';
    card.className='card mb-16';
    card.innerHTML='<div class="section-title">Live connection setup</div><div class="section-note">Credentials are sent only to the StoreBuddy server and stored encrypted. Never paste provider secrets into client-side code.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="sb-connect-woo">Connect WooCommerce</button><button class="btn btn-outline" id="sb-connect-google">Connect Google Analytics + Ads</button><button class="btn btn-outline" id="sb-connect-meta">Connect Meta Ads</button></div>';
    title.closest('.page-header').after(card);
    document.querySelector('#sb-connect-google').onclick=()=>location='/api/connections/google/start';
    document.querySelector('#sb-connect-meta').onclick=()=>location='/api/connections/meta/start';
    document.querySelector('#sb-connect-woo').onclick=async()=>{
      const baseUrl=prompt('WooCommerce store URL (example: https://store.example.com)');
      if(!baseUrl) return;
      const consumerKey=prompt('WooCommerce Consumer Key (ck_...)');
      if(!consumerKey) return;
      const consumerSecret=prompt('WooCommerce Consumer Secret (cs_...)');
      if(!consumerSecret) return;
      try{ await api('/api/connections/woocommerce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl,consumerKey,consumerSecret})}); alert('WooCommerce connected. Use Sync now to pull live store data.'); await window.StoreBuddy.refresh(); }catch(e){ alert(e.message); }
    };
  }
  ensureConnectionSetup();

  boot();
})();
