/** Contrato de apresentação: nenhum indicador é calculado no frontend. */
export type ClarkExecutiveMetric = {
  label: string;
  value: string;
  detail?: string;
};

export type ClarkExecutiveReport = {
  version: 1;
  title: string;
  subtitle: string;
  agent: string;
  generatedAt: string;
  dataAsOf?: string;
  status: 'complete' | 'partial' | 'unavailable';
  metrics: ClarkExecutiveMetric[];
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  diagnosis: string[];
  risks: string[];
  actions: string[];
  caveats: string[];
  sources: string[];
};
