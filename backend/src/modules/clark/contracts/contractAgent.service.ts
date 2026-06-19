import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

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

    try {
      const response = await anthropic.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20240620',
        max_tokens: 2048,
        temperature: 0.1, // Temperatura quase zerada: máxima precisão analítica e mínima criatividade
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

      const primeiroBloco = response.content[0];

      if (primeiroBloco && primeiroBloco.type === 'text') {
        return primeiroBloco.text;
      }

      throw new Error('A resposta do Claude não veio no formato esperado.');
    } catch (error) {
      console.error('[ContractAgentService] Falha na análise do contrato via Claude:', error);
      throw new Error('Não foi possível processar a análise do contrato no momento. Verifique a conexão com a IA.');
    }
  }
}

export const contractAgentService = new ContractAgentService();