import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

/**
 * Envia o prompt consolidado da Clark para o Claude.
 * O prompt já contém as regras de comportamento e os dados estruturados.
 */
export const gerarRespostaAnaliticaClaudeClark = async (
  promptCompleto: string
): Promise<string> => {
  try {
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20240620',
      max_tokens: 2048,
      temperature: 0.25, // Mesma temperatura fixada no Gemini para manter o tom analítico
      system: 'Você é a Clark, IA analítica executiva do TeleFluxo. Siga estritamente as instruções fornecidas no prompt do usuário.',
      messages: [
        {
          role: 'user',
          content: promptCompleto,
        },
      ],
    });

    // Extraindo para uma constante para garantir o Type Narrowing seguro do TypeScript
    const primeiroBloco = response.content[0];

    // Validação segura de existência e tipo
    if (primeiroBloco && primeiroBloco.type === 'text') {
      return primeiroBloco.text;
    }

    throw new Error('A resposta do Claude não veio em formato de texto.');
  } catch (error) {
    console.error('[Claude API Error] Falha ao processar final responder:', error);
    // Repassamos o erro para que o clarkFinalResponder.service.ts faça o catch e use o Fallback Local
    throw error;
  }
};