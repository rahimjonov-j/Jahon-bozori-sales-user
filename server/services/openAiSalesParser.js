import OpenAI from 'openai';
import {
  isValidShopId,
  normalizeShopId,
  normalizeStatus,
} from '../../shared/shop-status.js';

const SALES_PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shop_id: {
      type: 'string',
      pattern: '^[A-Z]-\\d+-\\d+$',
    },
    status: {
      type: 'string',
      enum: ['reserved', 'sold'],
    },
  },
  required: ['shop_id', 'status'],
};

const SYSTEM_INSTRUCTIONS = `
You convert messy shop sales text into strict JSON.

Rules:
- Return JSON only.
- Do not return markdown.
- Do not add explanations.
- shop_id format must be BLOCK-SECTION-UNIT like A-5-112.
- Preserve uppercase for the block letter.
- Normalize these sales statuses:
  - "sotildi" -> "sold"
  - "sotuv bo'ldi" -> "sold"
  - "bron" -> "reserved"
  - "bron qilindi" -> "reserved"
- Example: "A blok 5 qavat 112 bron qilindi" => {"shop_id":"A-5-112","status":"reserved"}
- Example: "A-5-112 sotildi" => {"shop_id":"A-5-112","status":"sold"}
`.trim();

export function createOpenAiSalesParser({ apiKey, model, catalogService }) {
  const client = apiKey ? new OpenAI({ apiKey }) : null;

  return {
    isEnabled() {
      return Boolean(client);
    },
    async parse(rawText) {
      if (!client) {
        const error = new Error(
          'OPENAI_API_KEY is missing. Add it to your environment before using the GPT parser endpoint.',
        );
        error.statusCode = 503;
        throw error;
      }

      const response = await client.responses.create({
        model,
        input: rawText,
        instructions: SYSTEM_INSTRUCTIONS,
        max_output_tokens: 80,
        temperature: 0,
        text: {
          format: {
            type: 'json_schema',
            name: 'shop_sale_status',
            strict: true,
            schema: SALES_PARSE_SCHEMA,
          },
        },
      });

      const parsed = JSON.parse(response.output_text);
      const shop_id = normalizeShopId(parsed.shop_id);
      const status = normalizeStatus(parsed.status);

      if (!isValidShopId(shop_id) || !status) {
        const error = new Error('The GPT parser returned an invalid shop payload.');
        error.statusCode = 422;
        throw error;
      }

      const knownShop = await catalogService.getByShopId(shop_id);

      if (!knownShop) {
        const error = new Error(
          `Parsed shop_id "${shop_id}" does not exist in the SVG catalog.`,
        );
        error.statusCode = 422;
        throw error;
      }

      return {
        shop_id,
        status,
      };
    },
  };
}
