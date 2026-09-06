import OpenAI from 'openai';
import { env } from '../config/env.js';

type InsightShape = { priority: 'HIGH' | 'MEDIUM' | 'LOW'; title: string; body: string; source?: string; metricValue?: string; actionLabel?: string };

let client: OpenAI | undefined;
function getClient() {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

export async function analyzeStore(data: unknown): Promise<InsightShape[]> {
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
  return parsed.insights;
}
