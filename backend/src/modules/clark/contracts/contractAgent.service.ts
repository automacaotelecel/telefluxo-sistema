import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey = '';

function normalizeClaudeModel(rawModel: string | undefined | null): string {
  const model = String(rawModel || '').trim();

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

function extractClaudeText(response: any): string {
  const content = Array.isArray(response?.content) ? response.content : [];
  return content
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text)
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

function buildFriendlyContractError(error: any, model: string): Error {
  const status = error?.status || error?.response?.status || error?.statusCode || '';
  const message = getAnthropicMessage(error);
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('deprecated') || lower.includes('retired') || lower.includes('model')) {
    hints.push(`Modelo configurado: ${model}. Use CLAUDE_MODEL=claude-sonnet-5 no backend.`);
  }

  if (lower.includes('temperature') || lower.includes('top_p') || lower.includes('top_k') || lower.includes('sampling')) {
    hints.push('A chamada de contratos foi corrigida para não enviar parâmetros de amostragem. Reinicie o backend/deploy.');
  }

  const prefix = status ? `Claude API ${status}: ` : 'Claude API: ';
  return new Error(`${prefix}${message}${hints.length ? ` | ${hints.join(' ')}` : ''}`);
}

export interface ContractAnalysisInput {
  contractText: string;
  userQuestion: string;
}

export class ContractAgentService {
  /**
   * Envia o texto do contrato e a pergunta do usuário para o Claude.
   */
  public async analyzeContract({ contractText, userQuestion }: ContractAnalysisInput): Promise<string> {
    const systemPrompt = `
Você é um consultor jurídico e administrativo sênior, atuando como assistente exclusivo da diretoria do TeleFluxo.
Sua missão é responder às dúvidas sobre o contrato fornecido de forma clara, leiga, direta e profissional.

REGRAS OBRIGATÓRIAS:
1. Baseie-se EXCLUSIVAMENTE nas cláusulas do texto fornecido.
2. Nunca deduza leis gerais, regras externas ou invente informações (Zero Alucinação).
3. Se a informação solicitada (ex: índice de reajuste, multa rescisória) não estiver expressa no texto do contrato, responda claramente: "Esta informação não consta no documento fornecido."
4. Use formatação limpa (negritos para destacar valores ou cláusulas importantes).
5. Seja objetivo. Não faça saudações longas. Vá direto à resposta.
    `.trim();

    const anthropic = getAnthropicClient();
    const claudeModel = getClaudeModel();

    try {
      // Não enviar temperature/top_p/top_k. Modelos Claude recentes podem retornar 400
      // com parâmetros de amostragem não padrão.
      const response = await anthropic.messages.create({
        model: claudeModel,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `
          --- INÍCIO DO TEXTO DO CONTRATO ---
          ${contractText}
          --- FIM DO TEXTO DO CONTRATO ---

          PERGUNTA DA DIRETORIA:
          ${userQuestion}
            `.trim(),
          },
        ],
      });

      const text = extractClaudeText(response);

      if (text) {
        return text;
      }

      throw new Error('A resposta do Claude não veio no formato esperado.');
    } catch (error) {
      const friendly = buildFriendlyContractError(error, claudeModel);
      console.error('[ContractAgentService] Falha na análise do contrato via Claude:', friendly);
      throw friendly;
    }
  }
}

export const contractAgentService = new ContractAgentService();
