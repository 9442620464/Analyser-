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
    card.innerHTML=`
      <div class="section-title">Connect your accounts</div>
      <div class="section-note">Click connect, approve on the provider's own site, and you're done — no API keys to find or paste.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px">
        <input id="sb-woo-url" type="text" placeholder="yourstore.com" style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:6px;font-size:13px" />
        <button class="btn btn-primary" id="sb-connect-woo">Connect WooCommerce</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-outline" id="sb-connect-google">Connect Google Analytics + Ads</button>
        <button class="btn btn-outline" id="sb-connect-meta">Connect Meta Ads</button>
      </div>
      <div style="margin-top:10px"><a href="#" id="sb-woo-advanced" style="font-size:12px;color:var(--ink-2)">Store blocking the connect button? Enter API keys manually →</a></div>
      <div id="sb-woo-manual" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="section-note" style="margin-bottom:8px">Advanced: paste keys generated under WooCommerce → Settings → Advanced → REST API.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="sb-woo-manual-url" type="text" placeholder="https://yourstore.com" style="flex:1;min-width:180px;padding:9px 12px;border:1px solid var(--line);border-radius:6px;font-size:13px" />
          <input id="sb-woo-manual-key" type="text" placeholder="Consumer key (ck_...)" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--line);border-radius:6px;font-size:13px" />
          <input id="sb-woo-manual-secret" type="text" placeholder="Consumer secret (cs_...)" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--line);border-radius:6px;font-size:13px" />
          <button class="btn btn-outline" id="sb-connect-woo-manual">Save</button>
        </div>
      </div>`;
    title.closest('.page-header').after(card);

    document.querySelector('#sb-connect-google').onclick=()=>location='/api/connections/google/start';
    document.querySelector('#sb-connect-meta').onclick=()=>location='/api/connections/meta/start';

    document.querySelector('#sb-connect-woo').onclick=()=>{
      const raw=document.querySelector('#sb-woo-url').value.trim();
      if(!raw){ alert('Enter your store address first, e.g. yourstore.com'); return; }
      const baseUrl=/^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      location=`/api/connections/woocommerce/start?baseUrl=${encodeURIComponent(baseUrl)}`;
    };

    document.querySelector('#sb-woo-advanced').onclick=(e)=>{ e.preventDefault(); const box=document.querySelector('#sb-woo-manual'); box.style.display = box.style.display==='none' ? 'block' : 'none'; };

    document.querySelector('#sb-connect-woo-manual').onclick=async()=>{
      const baseUrl=document.querySelector('#sb-woo-manual-url').value.trim();
      const consumerKey=document.querySelector('#sb-woo-manual-key').value.trim();
      const consumerSecret=document.querySelector('#sb-woo-manual-secret').value.trim();
      if(!baseUrl || !consumerKey || !consumerSecret){ alert('Fill in store URL, consumer key, and consumer secret.'); return; }
      try{ await api('/api/connections/woocommerce/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl,consumerKey,consumerSecret})}); alert('WooCommerce connected. Use Sync now to pull live store data.'); await window.StoreBuddy.refresh(); }catch(e){ alert(e.message); }
    };
  }

  function handleConnectReturn(){
    const params=new URLSearchParams(location.search);
    if(!params.has('woocommerce')) return;
    const success=params.get('success');
    if(success==='0') alert('WooCommerce connection was not approved.');
    else if(success==='1') alert('WooCommerce connected. Use Sync now to pull live store data.');
    history.replaceState(null,'',location.pathname);
  }

  handleConnectReturn();
  ensureConnectionSetup();

  boot();
})();
