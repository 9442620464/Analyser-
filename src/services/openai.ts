import OpenAI from 'openai';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { getPricingConfig } from '../lib/platformSettings.js';

type InsightShape = { priority: 'HIGH' | 'MEDIUM' | 'LOW'; title: string; body: string; source?: string; metricValue?: string; actionLabel?: string };

let client: OpenAI | undefined;
function getClient() {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

// Logs one row per OpenAI call so the admin dashboard can total tokens/cost by tenant and overall.
// Cost is an estimate: it multiplies token counts by the $/1k rates you set in Admin > Pricing,
// which you should keep in sync with your actual OpenAI billing rate for OPENAI_MODEL.
async function recordAiUsage(tenantId: string, purpose: string, model: string, promptTokens: number, completionTokens: number) {
  const pricing = await getPricingConfig();
  const inRate = pricing.aiInputPer1kUsd[model] ?? 0;
  const outRate = pricing.aiOutputPer1kUsd[model] ?? 0;
  const estimatedCostUsd = (promptTokens / 1000) * inRate + (completionTokens / 1000) * outRate;
  await prisma.aiUsageEvent.create({
    data: { tenantId, purpose, model, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimatedCostUsd }
  }).catch(() => { /* usage logging must never break the caller's actual request */ });
}

export async function analyzeStore(tenantId: string, data: unknown): Promise<InsightShape[]> {
  const response = await getClient().responses.create({
    model: env.OPENAI_MODEL,
    reasoning: { effort: 'medium' },
    input: [
      {
        role: 'system',
        content: 'You are StoreBuddy AI, an ecommerce analytics operator. Analyze only the supplied store data. Identify high-value actionable findings, avoid fabricating missing facts, and return concise insights. Prioritize estimated revenue/profit impact and stock or campaign risk.'
      },
      {
        role: 'user',
        content: JSON.stringify(data)
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'store_insights',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  source: { type: 'string' },
                  metricValue: { type: 'string' },
                  actionLabel: { type: 'string' }
                },
                required: ['priority', 'title', 'body', 'source', 'metricValue', 'actionLabel'],
                additionalProperties: false
              }
            }
          },
          required: ['insights'],
          additionalProperties: false
        }
      }
    }
  });
  const parsed = JSON.parse(response.output_text) as { insights: InsightShape[] };
  const usage = response.usage;
  if (usage) await recordAiUsage(tenantId, 'dashboard_insight', env.OPENAI_MODEL, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
  return parsed.insights;
}

export async function answerStoreQuestion(tenantId: string, question: string, data: unknown): Promise<string> {
  const response = await getClient().responses.create({
    model: env.OPENAI_MODEL,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'system',
        content: 'You are StoreBuddy AI, replying over WhatsApp to a store owner about their own store\'s data. Answer only from the supplied data. Keep replies short and plain-text (WhatsApp has no rich formatting) -- a few sentences, not a report. If the data does not contain the answer, say so plainly instead of guessing.'
      },
      { role: 'user', content: JSON.stringify(data) },
      { role: 'user', content: question }
    ]
  });
  const usage = response.usage;
  if (usage) await recordAiUsage(tenantId, 'whatsapp_qa', env.OPENAI_MODEL, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
  return response.output_text;
}
