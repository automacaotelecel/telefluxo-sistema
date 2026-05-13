export type ClarkPlanSubject =
  | 'sales'
  | 'stock'
  | 'insurance'
  | 'help';

export type ClarkPlanIntent =
  | 'sales_summary'
  | 'sales_by_store'
  | 'sales_by_seller'
  | 'sales_by_category'
  | 'sales_monthly_growth'
  | 'sales_analytic_report'
  | 'stock_product_search'
  | 'stock_ranking'
  | 'insurance_by_seller'
  | 'insurance_by_store'
  | 'help';

export type ClarkPlanMode = 'simple' | 'analytic';

export type ClarkPlanMetric =
  | 'revenue'
  | 'quantity'
  | 'average_ticket'
  | 'growth'
  | 'ranking'
  | 'stock_quantity'
  | 'insurance_value'
  | 'insurance_quantity';

export type ClarkPlanGroupBy =
  | 'store'
  | 'seller'
  | 'category'
  | 'product'
  | 'month'
  | 'day';

export type ClarkPlanDateRange = {
  startDate: string | null;
  endDate: string | null;
  label: string | null;
};

export type ClarkPlanProductEntity = {
  raw: string | null;
  family: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  category: string | null;
};

export type ClarkPlanFilters = {
  dateRange: ClarkPlanDateRange | null;
  storeName: string | null;
  sellerName: string | null;
  categoryName: string | null;
  product: ClarkPlanProductEntity | null;
  limit: number | null;
};

export type ClarkPlanOutput = {
  groupBy: ClarkPlanGroupBy[];
  metrics: ClarkPlanMetric[];
  needsStoresBreakdown: boolean;
  needsProductBreakdown: boolean;
  needsMonthlyGrowth: boolean;
  needsStrategicInsights: boolean;
};

export type ClarkPlan = {
  intent: ClarkPlanIntent;
  subject: ClarkPlanSubject;
  mode: ClarkPlanMode;
  confidence: number;
  filters: ClarkPlanFilters;
  output: ClarkPlanOutput;
  userQuestion: string;
  reasoningSummary: string;
};

export type ClarkPlannerResult = {
  ok: boolean;
  plan: ClarkPlan | null;
  rawText: string;
  error?: string;
};