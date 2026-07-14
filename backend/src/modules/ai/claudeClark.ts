import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey = '';

function normalizeClaudeModel(rawModel: string | undefined | null): string {
  const model = String(rawModel || '').trim();

  // Claude Sonnet 5 é o substituto direto do Claude Sonnet 4.6.
  // Esse mapeamento evita quebra quando o .env antigo ainda aponta para claude-sonnet-4-6.
  if (!model || model === 'claude-sonnet-4-6') {
    return DEFAULT_CLAUDE_MODEL;
  }

  return model;
}

function getClaudeModel(): string {
  return normalizeClaudeModel(process.env.CLAUDE_MODEL);
}

function getAnthropicClient(): Anthropic {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada no backend.');
  }

  if (!anthropicClient || anthropicClientKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey });
    anthropicClientKey = apiKey;
  }

  return anthropicClient;
}

function extrairTextoClaude(response: any): string {
  const blocos = Array.isArray(response?.content) ? response.content : [];

  return blocos
    .filter((bloco: any) => bloco?.type === 'text' && bloco?.text)
    .map((bloco: any) => String(bloco.text))
    .join('\n')
    .trim();
}

function getAnthropicMessage(error: any): string {
  return String(
    error?.error?.message ||
      error?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      'Erro desconhecido na API da Anthropic.',
  );
}

function buildFriendlyClaudeError(error: any, model: string): Error {
  const status = error?.status || error?.response?.status || error?.statusCode || '';
  const message = getAnthropicMessage(error);
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('deprecated') || lower.includes('retired') || lower.includes('model')) {
    hints.push(`Modelo configurado: ${model}. Use CLAUDE_MODEL=claude-sonnet-5 no backend.`);
  }

  if (lower.includes('temperature') || lower.includes('top_p') || lower.includes('top_k') || lower.includes('sampling')) {
    hints.push('A chamada da Clark foi corrigida para não enviar parâmetros de amostragem para modelos Claude recentes. Reinicie o backend.');
  }

  const prefix = status ? `Claude API ${status}: ` : 'Claude API: ';
  return new Error(`${prefix}${message}${hints.length ? ` | ${hints.join(' ')}` : ''}`);
}

/**
 * Chamada genérica ao Claude usada pela Clark como planner e como responder final.
 * A chave nunca deve ficar no frontend. Ela precisa estar somente no .env do backend.
 */
export async function gerarTextoClaudeClark(params: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const anthropic = getAnthropicClient();
  const claudeModel = getClaudeModel();

  try {
    // Não enviar temperature/top_p/top_k. Modelos Claude recentes podem retornar 400
    // quando recebem parâmetros de amostragem não padrão.
    const response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: params.maxTokens || 4096,
      system:
        params.system ||
        'Você é a Clark, IA analítica executiva do TeleFluxo. Responda com precisão, sem inventar dados.',
      messages: [
        {
          role: 'user',
          content: params.prompt,
        },
      ],
    });

    const text = extrairTextoClaude(response);

    if (!text) {
      throw new Error('A resposta do Claude não veio em formato de texto.');
    }

    return text;
  } catch (error) {
    const friendly = buildFriendlyClaudeError(error, claudeModel);
    console.error('[Claude API Error] Falha ao processar solicitação da Clark:', friendly);
    throw friendly;
  }
}

/**
 * Envia o prompt consolidado da Clark para o Claude.
 * O prompt já contém as regras de comportamento e os dados estruturados.
 */
export const gerarRespostaAnaliticaClaudeClark = async (
  promptCompleto: string
): Promise<string> => {
  return gerarTextoClaudeClark({
    prompt: promptCompleto,
    maxTokens: 4096,
    system:
      'Você é a Clark, IA analítica executiva do TeleFluxo. Siga estritamente as instruções fornecidas. Use apenas os dados reais recebidos e nunca invente números.',
  });
};
