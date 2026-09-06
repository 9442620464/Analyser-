export function metaAuthUrl(appId: string, redirectUri: string, state: string) {
  const url = new URL('https://www.facebook.com/v24.0/dialog/oauth');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ['ads_read', 'business_management'].join(','));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeMetaCode(code: string, appId: string, appSecret: string, redirectUri: string) {
  const url = new URL('https://graph.facebook.com/v24.0/oauth/access_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meta OAuth ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function fetchMetaInsights(accessToken: string, adAccountId: string, since: string, until: string) {
  const url = new URL(`https://graph.facebook.com/v24.0/act_${adAccountId}/insights`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('fields', 'date_start,date_stop,spend,impressions,clicks,ctr,cpc,actions,action_values');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('time_increment', '1');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meta Insights ${response.status}: ${await response.text()}`);
  return response.json();
}
