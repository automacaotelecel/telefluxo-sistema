import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    })
  : null;

function extrairTextoClaude(response: any): string {
  const blocos = Array.isArray(response?.content) ? response.content : [];

  return blocos
    .filter((bloco: any) => bloco?.type === 'text' && bloco?.text)
    .map((bloco: any) => String(bloco.text))
    .join('\n')
    .trim();
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
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no backend.');
  }

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: params.maxTokens || 4096,
      temperature: params.temperature ?? 0.2,
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
    console.error('[Claude API Error] Falha ao processar solicitação da Clark:', error);
    throw error;
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
    temperature: 0.2,
    system:
      'Você é a Clark, IA analítica executiva do TeleFluxo. Siga estritamente as instruções fornecidas. Use apenas os dados reais recebidos e nunca invente números.',
  });
};
