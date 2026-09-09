(function () {
  "use strict";

  const api = async (url, options) => {
    const r = await fetch(url, options);
    if (!r.ok) { let e = 'Request failed'; try { e = (await r.json()).error || e; } catch {} throw new Error(e); }
    return r.status === 204 ? null : r.json();
  };
  const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
  const usdCents = (c) => usd((c || 0) / 100);
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';

  function goToPage(pageId) {
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + pageId));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === pageId));
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.nav-item[data-page]').forEach((btn) => btn.addEventListener('click', () => { goToPage(btn.dataset.page); if (btn.dataset.page === 'overview') loadOverview(); if (btn.dataset.page === 'tenants') loadTenants(); if (btn.dataset.page === 'whatsapp') loadWhatsApp(); if (btn.dataset.page === 'pricing') loadPricing(); }));
  document.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => goToPage(btn.dataset.goto)));

  document.querySelector('#logoutLink').onclick = async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }); location = '/admin/login'; };

  // --- Overview ---
  let revenueChart, plansChart;
  async function loadOverview() {
    const d = await api('/api/admin/overview');
    document.querySelector('#overviewStats').innerHTML = [
      { label: 'Total tenants', value: d.totalTenants, ctx: `${d.subscriptionBreakdown.find(s=>s.status==='ACTIVE')?.count || 0} active subscriptions` },
      { label: 'Revenue this month', value: usdCents(d.revenueThisMonthCents), ctx: `${usdCents(d.revenueAllTimeCents)} all-time` },
      { label: 'AI cost this month', value: usd(d.aiCostThisMonthUsd), ctx: `${d.aiTokensThisMonth.toLocaleString()} tokens · ${d.aiCallsThisMonth} calls` },
      { label: 'WhatsApp cost this month', value: usd(d.whatsappCostThisMonthUsd), ctx: `${d.whatsappMessagesThisMonth} messages sent` }
    ].map(s => `<div class="card"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div><div class="stat-context">${s.ctx}</div></div>`).join('');

    const labels = d.revenueTrend.map(r => r.date.slice(5));
    const values = d.revenueTrend.map(r => r.revenueCents / 100);
    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(document.getElementById('chartRevenue'), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: '#2A3B7A', borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => '$' + v } } } }
    });

    if (plansChart) plansChart.destroy();
    plansChart = new Chart(document.getElementById('chartPlans'), {
      type: 'doughnut',
      data: { labels: d.planBreakdown.map(p => p.planId), datasets: [{ data: d.planBreakdown.map(p => p.count), backgroundColor: ['#1F8A70', '#2A3B7A', '#D9A21B', '#7C867E'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '60%' }
    });

    document.querySelector('#connectionHealth').innerHTML = d.connectionsByStatus.map(c => `<span class="tag ${c.status==='CONNECTED'?'tag-green':c.status==='NEEDS_ATTENTION'?'tag-yellow':'tag-gray'}" style="margin-right:8px">${c.status}: ${c.count}</span>`).join('') || '<span class="stat-context">No connections yet.</span>';
  }

  // --- Tenants ---
  let tenantPage = 1;
  async function loadTenants(search) {
    const params = new URLSearchParams({ page: String(tenantPage), pageSize: '25' });
    if (search) params.set('search', search);
    const d = await api('/api/admin/tenants?' + params.toString());
    document.querySelector('#tenantsBody').innerHTML = d.rows.map(t => `
      <tr class="clickable" data-id="${t.id}">
        <td><b>${t.name}</b><div class="stat-context">${t.slug}</div></td>
        <td>${t.planId ? `<span class="tag tag-gray">${t.planId}</span>` : '—'}</td>
        <td>${t.subscriptionStatus ? `<span class="tag ${t.subscriptionStatus==='ACTIVE'?'tag-green':t.subscriptionStatus==='PAST_DUE'?'tag-red':'tag-yellow'}">${t.subscriptionStatus}</span>` : '—'}</td>
        <td class="num mono">${t.connectionCount}</td>
        <td class="num mono">${usd(t.aiCostThisMonthUsd)}</td>
        <td class="num mono">${usd(t.whatsappCostThisMonthUsd)}</td>
        <td>${fmtDate(t.lastSyncedAt)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="stat-context">No tenants match.</td></tr>';
    document.querySelectorAll('#tenantsBody tr[data-id]').forEach(row => row.onclick = () => openTenant(row.dataset.id));

    const totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
    document.querySelector('#tenantsPagination').innerHTML = `<button class="btn btn-sm" id="prevPg" ${tenantPage<=1?'disabled':''}>← Prev</button><span class="stat-context" style="align-self:center">Page ${tenantPage} of ${totalPages}</span><button class="btn btn-sm" id="nextPg" ${tenantPage>=totalPages?'disabled':''}>Next →</button>`;
    document.querySelector('#prevPg')?.addEventListener('click', () => { tenantPage--; loadTenants(search); });
    document.querySelector('#nextPg')?.addEventListener('click', () => { tenantPage++; loadTenants(search); });
  }
  document.querySelector('#tenantSearchBtn').onclick = () => { tenantPage = 1; loadTenants(document.querySelector('#tenantSearch').value.trim()); };

  async function openTenant(id) {
    const d = await api('/api/admin/tenants/' + id);
    goToPage('tenant-detail');
    document.querySelector('#tenantDetailName').textContent = d.tenant.name;
    document.querySelector('#tenantDetailSub').textContent = `${d.tenant.slug} · created ${fmtDate(d.tenant.createdAt)}`;
    document.querySelector('#tenantConnections').innerHTML = d.connections.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${c.displayName}</b> <span class="tag ${c.status==='CONNECTED'?'tag-green':'tag-yellow'}">${c.status}</span><div class="stat-context">${c.lastError || (c.lastSyncedAt ? 'Synced ' + fmtDate(c.lastSyncedAt) : 'Never synced')}</div></div>`).join('') || '<div class="stat-context">No connections.</div>';
    document.querySelector('#tenantBilling').innerHTML = `
      <div class="stat-context">Plan: <b>${d.tenant.planId || '—'}</b></div>
      <div class="stat-context">Status: <b>${d.tenant.subscriptionStatus || '—'}</b></div>
      <div class="stat-context">Renews: ${fmtDate(d.tenant.currentPeriodEnd)}</div>
      <div class="stat-context">Stripe customer: ${d.tenant.stripeCustomerId || '—'}</div>
      ${d.tenant.stripeSubscriptionId ? `<button class="btn btn-sm mt-8" id="stripeSyncBtn" style="margin-top:8px">Re-sync from Stripe</button>` : ''}
    `;
    document.querySelector('#stripeSyncBtn')?.addEventListener('click', async () => { await api(`/api/admin/tenants/${id}/stripe-sync`, { method: 'POST' }); openTenant(id); });
    document.querySelector('#tenantAiRows').innerHTML = d.aiEvents.map(e => `<tr><td>${fmtDate(e.createdAt)}</td><td>${e.purpose}</td><td class="num mono">${e.totalTokens}</td><td class="num mono">${usd(e.estimatedCostUsd)}</td></tr>`).join('') || '<tr><td colspan="4" class="stat-context">No AI usage yet.</td></tr>';
    document.querySelector('#tenantWaRows').innerHTML = d.whatsappMessages.map(m => `<tr><td>${fmtDate(m.createdAt)}</td><td>${m.direction}</td><td class="mono">${m.toNumber}</td><td class="num mono">${usd(m.estimatedCostUsd)}</td></tr>`).join('') || '<tr><td colspan="4" class="stat-context">No WhatsApp messages yet.</td></tr>';
  }

  // --- WhatsApp settings ---
  async function loadWhatsApp() {
    document.querySelector('#waWebhookUrl').textContent = location.origin + '/api/webhooks/whatsapp';
    const d = await api('/api/admin/settings/whatsapp');
    if (d.configured) {
      document.querySelector('#waBusinessId').value = d.businessAccountId || '';
      document.querySelector('#waPhoneId').value = d.phoneNumberId || '';
      document.querySelector('#waToken').value = d.accessToken || '';
      document.querySelector('#waAppSecret').value = d.appSecret || '';
      document.querySelector('#waVerifyToken').value = d.webhookVerifyToken || '';
      document.querySelector('#waApiVersion').value = d.apiVersion || '';
    }
  }
  document.querySelector('#waSave').onclick = async () => {
    try {
      await api('/api/admin/settings/whatsapp', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId: document.querySelector('#waBusinessId').value.trim(),
          phoneNumberId: document.querySelector('#waPhoneId').value.trim(),
          accessToken: document.querySelector('#waToken').value.trim(),
          appSecret: document.querySelector('#waAppSecret').value.trim(),
          webhookVerifyToken: document.querySelector('#waVerifyToken').value.trim(),
          apiVersion: document.querySelector('#waApiVersion').value.trim()
        })
      });
      alert('WhatsApp settings saved.');
      loadWhatsApp();
    } catch (e) { alert(e.message); }
  };
  document.querySelector('#waTestSend').onclick = async () => {
    const result = document.querySelector('#waTestResult');
    result.textContent = 'Sending…';
    try {
      const d = await api('/api/admin/settings/whatsapp/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toNumber: document.querySelector('#waTestTo').value.trim(), message: document.querySelector('#waTestMsg').value }) });
      result.textContent = `Sent. Provider message ID: ${d.providerMessageId || '(none returned)'}`;
    } catch (e) { result.textContent = 'Failed: ' + e.message; }
  };

  // --- Pricing settings ---
  async function loadPricing() {
    const d = await api('/api/admin/settings/pricing');
    const models = new Set([...Object.keys(d.aiInputPer1kUsd || {}), ...Object.keys(d.aiOutputPer1kUsd || {})]);
    if (models.size === 0) models.add('');
    renderPricingRows([...models].map(m => ({ model: m, input: d.aiInputPer1kUsd?.[m] ?? '', output: d.aiOutputPer1kUsd?.[m] ?? '' })));
    document.querySelector('#pricingWa').value = d.whatsappPerConversationUsd ?? 0;
  }
  function renderPricingRows(rows) {
    const container = document.querySelector('#pricingAiRows');
    container.innerHTML = rows.map((r, i) => `
      <div class="pricing-row" data-row="${i}">
        <input placeholder="model name, e.g. gpt-5.6-sol" class="model-input" value="${r.model}">
        <input placeholder="$/1k input tokens" type="number" step="0.0001" class="input-rate" value="${r.input}">
        <input placeholder="$/1k output tokens" type="number" step="0.0001" class="output-rate" value="${r.output}">
      </div>`).join('');
  }
  document.querySelector('#pricingAddModel').onclick = () => {
    const rows = [...document.querySelectorAll('.pricing-row')].map(row => ({ model: row.querySelector('.model-input').value, input: row.querySelector('.input-rate').value, output: row.querySelector('.output-rate').value }));
    rows.push({ model: '', input: '', output: '' });
    renderPricingRows(rows);
  };
  document.querySelector('#pricingSave').onclick = async () => {
    const aiInputPer1kUsd = {}, aiOutputPer1kUsd = {};
    document.querySelectorAll('.pricing-row').forEach(row => {
      const model = row.querySelector('.model-input').value.trim();
      if (!model) return;
      aiInputPer1kUsd[model] = Number(row.querySelector('.input-rate').value || 0);
      aiOutputPer1kUsd[model] = Number(row.querySelector('.output-rate').value || 0);
    });
    try {
      await api('/api/admin/settings/pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiInputPer1kUsd, aiOutputPer1kUsd, whatsappPerConversationUsd: Number(document.querySelector('#pricingWa').value || 0) }) });
      alert('Pricing saved.');
    } catch (e) { alert(e.message); }
  };

  loadOverview();
})();
