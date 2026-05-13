import { GoogleGenAI } from '@google/genai';
import { montarPromptClark } from './clarkPrompt';

import {
  ClarkFiltros,
  ClarkIntent,
  ClarkModo,
  ClarkPeriodo,
} from '../clark/clark.types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const genAI = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    })
  : null;

export async function gerarRespostaAnaliticaGeminiClark(params: {
  pergunta: string;
  intencao: ClarkIntent;
  modo: ClarkModo;
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
  dados: any;
}) {
  if (!genAI) {
    return '';
  }

  try {
    const prompt = montarPromptClark(params);

    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    return response.text || '';
  } catch (error) {
    console.error('❌ Erro ao chamar Gemini na Clark:', error);
    return '';
  }
}