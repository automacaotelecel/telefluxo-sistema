import { ClarkToolName, ClarkToolResult } from '../agent/clarkAgent.types';

export type ClarkToolContext = {
  userId: string;
  pergunta?: string;
  db?: unknown;
  prisma?: unknown;
  [key: string]: unknown;
};

export type ClarkToolHandler = (
  args: Record<string, any>,
  ctx: ClarkToolContext
) => Promise<ClarkToolResult>;

export type ClarkToolRegistry = Record<ClarkToolName, ClarkToolHandler>;
