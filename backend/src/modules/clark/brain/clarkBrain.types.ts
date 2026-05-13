import { ClarkFiltros, ClarkHistoricoMensagem, ClarkPeriodo, ClarkResposta } from '../clark.types';
import { ClarkAgentPlan, ClarkToolResult, ClarkVerificationResult } from '../agent/clarkAgent.types';
import { ClarkUserScope } from '../clark.types';

export type ClarkBrainInput = {
  userId: string;
  pergunta: string;
  historico?: ClarkHistoricoMensagem[];
};

export type ClarkBrainContext = {
  userId: string;
  perguntaOriginal: string;
  perguntaExpandida: string;
  historico: ClarkHistoricoMensagem[];
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
  scope: ClarkUserScope;
  schemaContext: string;
};

export type ClarkBrainOutput = ClarkResposta;

export type ClarkBrainTrace = {
  plan: ClarkAgentPlan;
  toolResults: ClarkToolResult[];
  verifier: ClarkVerificationResult;
  usedGeminiPlanner: boolean;
  usedGeminiResponder: boolean;
};
