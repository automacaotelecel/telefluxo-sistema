//ARQUIVO DE VENDAS ANUAIS - TUDO QUE FOI VENDIDO NESSE ANO

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckSquare,
  ChevronDown,
  Filter,
  Flame,
  Layers,
  MapPin,
  Minus,
  Package,
  PieChart,
  Search,
  ShieldCheck,
  Square,
  Store,
  TrendingUp,
} from 'lucide-react';

const STORE_MAP: Record<string, string> = {
  "12309173001309": "ARAGUAIA SHOPPING",
  "12309173000418": "BOULEVARD SHOPPING",
  "12309173000175": "BRASILIA SHOPPING",
  "12309173000680": "CONJUNTO NACIONAL",
  "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
  "12309173000507": "GOIANIA SHOPPING",
  "12309173000256": "IGUATEMI SHOPPING",
  "12309173000841": "JK SHOPPING",
  "12309173000337": "PARK SHOPPING",
  "12309173000922": "PATIO BRASIL",
  "12309173000760": "TAGUATINGA SHOPPING",
  "12309173001147": "TERRAÇO SHOPPING",
  "12309173001651": "TAGUATINGA SHOPPING QQ",
  "12309173001732": "UBERLÂNDIA SHOPPING",
  "12309173001813": "UBERABA SHOPPING",
  "12309173001570": "FLAMBOYANT SHOPPING",
  "12309173002119": "BURITI SHOPPING",
  "12309173002461": "PASSEIO DAS AGUAS",
  "12309173002038": "PORTAL SHOPPING",
  "12309173002208": "SHOPPING SUL",
  "12309173001902": "BURITI RIO VERDE",
  "12309173002380": "PARK ANAPOLIS",
  "12309173002542": "SHOPPING RECIFE",
  "12309173002895": "MANAIRA SHOPPING",
  "12309173002976": "IGUATEMI FORTALEZA",
  "12309173001066": "CD TAGUATINGA",
};

const STORE_ALIAS_MAP: Record<string, string> = {
  'CNB SHOPPING': 'CONJUNTO NACIONAL',
  'UBERLÂNDIA': 'UBERLÂNDIA SHOPPING',
  'UBERLANDIA': 'UBERLÂNDIA SHOPPING',
  'UBERABA': 'UBERABA SHOPPING',
  'CONJUNTO NACIONAL SHOPPING': 'CONJUNTO NACIONAL',
  'SD CONJUNTO NACIONAL': 'CONJUNTO NACIONAL',
  'CNB QUIOSQUE': 'CONJUNTO NACIONAL QUIOSQUE',
  'CONJUNTO NACIONAL QQ': 'CONJUNTO NACIONAL QUIOSQUE',
  'UBERLANDIA SHOPPING': 'UBERLÂNDIA SHOPPING',
  'TERRACO SHOPPING': 'TERRAÇO SHOPPING',
  'PASSEIO DAS ÁGUAS': 'PASSEIO DAS AGUAS',
  'PASSEIO DAS AGUAS SHOPPING': 'PASSEIO DAS AGUAS',
  'GOIÂNIA SHOPPING': 'GOIANIA SHOPPING',
  'BRASÍLIA SHOPPING': 'BRASILIA SHOPPING',
  'PÁTIO BRASIL': 'PATIO BRASIL',
  'PARK ANÁPOLIS': 'PARK ANAPOLIS',
  'MANAÍRA SHOPPING': 'MANAIRA SHOPPING',
};

const STORE_REGION_MAP: Record<string, string> = {
  'ARAGUAIA SHOPPING': 'GOIÁS',
  'BOULEVARD SHOPPING': 'DF',
  'BRASILIA SHOPPING': 'DF',
  'CONJUNTO NACIONAL': 'DF',
  'CONJUNTO NACIONAL QUIOSQUE': 'DF',
  'CNB SHOPPING': 'DF',
  'CNB QUIOSQUE': 'DF',
  'GOIANIA SHOPPING': 'GOIÁS',
  'IGUATEMI SHOPPING': 'DF',
  'JK SHOPPING': 'DF',
  'PARK SHOPPING': 'DF',
  'PATIO BRASIL': 'DF',
  'TAGUATINGA SHOPPING': 'DF',
  'TERRAÇO SHOPPING': 'DF',
  'TAGUATINGA SHOPPING QQ': 'DF',
  'UBERLÂNDIA SHOPPING': 'MINAS GERAIS',
  'UBERLANDIA SHOPPING': 'MINAS GERAIS',
  'UBERABA SHOPPING': 'MINAS GERAIS',
  'FLAMBOYANT SHOPPING': 'GOIÁS',
  'BURITI SHOPPING': 'GOIÁS',
  'PASSEIO DAS AGUAS': 'GOIÁS',
  'PORTAL SHOPPING': 'GOIÁS',
  'SHOPPING SUL': 'GOIÁS',
  'BURITI RIO VERDE': 'GOIÁS',
  'PARK ANAPOLIS': 'GOIÁS',
  'SHOPPING RECIFE': 'PE',
  'MANAIRA SHOPPING': 'PB',
  'IGUATEMI FORTALEZA': 'CE',
  'CD TAGUATINGA': 'CD',
};

// Classificação inicial exatamente como a planilha LOJA LIQUIDA.
// OK = considerável (entra na análise líquida).
// NÃO OK = não considerável (aparece somente na análise bruta).
// Uma loja não cadastrada permanece PENDENTE e não entra na análise líquida.
type LojaConsideravel = 'OK' | 'NAO_OK' | 'PENDENTE';
type ModoAnalise = 'bruto' | 'liquido';
const CLASSIFICACAO_STORAGE_KEY = 'telefluxo.classificacao.lojas.liquidas.v1';
const CLASSIFICACAO_PADRAO: Record<string, LojaConsideravel> = {
  'UBERLÂNDIA SHOPPING': 'OK',
  'JK SHOPPING': 'OK',
  'UBERABA SHOPPING': 'OK',
  'GOIANIA SHOPPING': 'OK',
  'BRASILIA SHOPPING': 'OK',
  'PARK SHOPPING': 'OK',
  'PATIO BRASIL': 'OK',
  'IGUATEMI SHOPPING': 'OK',
  'TAGUATINGA SHOPPING': 'OK',
  'ARAGUAIA SHOPPING': 'OK',
  'TERRAÇO SHOPPING': 'OK',
  'CONJUNTO NACIONAL': 'OK',
  'PASSEIO DAS AGUAS': 'OK',
  'SHOPPING SUL': 'OK',
  'FLAMBOYANT SHOPPING': 'OK',
  'BURITI RIO VERDE': 'OK',
  'BURITI SHOPPING': 'OK',
  'PORTAL SHOPPING': 'OK',
  'PARK ANAPOLIS': 'OK',
  'SHOPPING RECIFE': 'NAO_OK',
  'MANAIRA SHOPPING': 'NAO_OK',
  'IGUATEMI FORTALEZA': 'NAO_OK',
  'BOULEVARD SHOPPING': 'OK',
  'CONJUNTO NACIONAL QUIOSQUE': 'OK',
};

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const MONTH_FULL: Record<number, string> = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro',
};

const THEME = {
  orange: '#F97316',
  orangeDark: '#C2410C',
  orangeSoft: '#FDBA74',
  slate: '#475569',
  slateDark: '#0F172A',
};

const CHART_COLORS = {
  yearA: THEME.slate,
  yearBReal: THEME.orange,
  yearBProjection: THEME.orangeSoft,
};

const PIE_COLORS = ['#F97316', '#334155', '#FB923C', '#64748B', '#FDBA74', '#94A3B8', '#C2410C', '#CBD5E1'];

type AnyRow = Record<string, any>;
type StoreSortKey = 'loja' | 'fatA' | 'fatB' | 'fatPct' | 'segA' | 'segB' | 'segPct';

const formatMoney = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

const formatMoneyNoCents = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val || 0);

const formatMoneyShort = (val: number) => {
  if (!val) return 'R$ 0';
  if (val >= 1_000_000) return `R$ ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R$ ${(val / 1_000).toFixed(0)}k`;
  return `R$ ${val.toFixed(0)}`;
};

const formatCellCompact = (val: number) => {
  if (!val || val <= 0) return '—';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2).replace('.', ',')}M`;
  if (val >= 1_000) return `${Math.round(val / 1_000)}k`;
  return `${Math.round(val)}`;
};

const pick = (obj: AnyRow, keys: string[], fallback: any = undefined) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
};

const toNumberSafe = (v: any) => {
  if (v === null || v === undefined) return 0;

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }

  let s = String(v)
    .trim()
    .replace(/\s/g, '')
    .replace(/[R$\u00A0]/g, '');

  if (s.includes(',')) {
    s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  } else {
    if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
  }

  s = s.replace(/[^0-9.-]/g, '');

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const getStoreName = (raw: string) => {
  if (!raw) return 'N/D';
  const cleanDigits = raw.replace(/\D/g, '');
  if (cleanDigits && STORE_MAP[cleanDigits]) return STORE_MAP[cleanDigits];
  const upper = String(raw).trim().toUpperCase();
  return STORE_MAP[upper] || STORE_ALIAS_MAP[upper] || upper;
};

const shortenStoreName = (name: string) => {
  return name
    .replace('CONJUNTO NACIONAL QUIOSQUE', 'CONJ. NACIONAL QQ')
    .replace('CONJUNTO NACIONAL', 'CONJ. NACIONAL')
    .replace('TAGUATINGA SHOPPING QQ', 'TAGUATINGA QQ');
};

const getStoreRegion = (storeName: string, rawRegion?: string) => {
  const canonicalStore = getStoreName(storeName);
  // Para as filiais conhecidas, a UF prevalece sobre a região genérica do ERP.
  if (['SHOPPING RECIFE', 'MANAIRA SHOPPING', 'IGUATEMI FORTALEZA'].includes(canonicalStore)) {
    return STORE_REGION_MAP[canonicalStore];
  }
  const cleanRegion = String(rawRegion || '').trim().toUpperCase();
  if (cleanRegion && cleanRegion !== 'N/D' && cleanRegion !== 'NAN' && cleanRegion !== 'UNDEFINED' && cleanRegion !== 'SEM REGIÃO') {
    if (cleanRegion === 'GO') return 'GOIÁS';
    if (cleanRegion === 'MG') return 'MINAS GERAIS';
    if (['PE', 'PB', 'CE', 'BA', 'RN', 'AL'].includes(cleanRegion)) return 'NORDESTE';
    return cleanRegion;
  }
  const upperStore = getStoreName(storeName);
  return STORE_REGION_MAP[upperStore] || 'OUTRAS';
};

const REGION_ORDER = ['CE', 'DF', 'GOIÁS', 'MINAS GERAIS', 'PB', 'PE', 'CD', 'OUTRAS'];
const sortRegionName = (region: string) => {
  const idx = REGION_ORDER.indexOf(region);
  return idx === -1 ? 999 : idx;
};
const regionShortLabel = (region: string) => {
  if (region === 'MINAS GERAIS') return 'MG';
  if (region === 'NORDESTE') return 'NE';
  if (region === 'GOIÁS') return 'GO';
  return region;
};

const getDateValue = (sale: AnyRow) =>
  pick(sale, ['data_emissao', 'DATA_EMISSAO', 'data', 'DATA', 'date', 'DATE'], '');

const getTotal = (sale: AnyRow) =>
  toNumberSafe(
    pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total_real', 'TOTAL_REAL', 'total', 'TOTAL', 'valor', 'VALOR'], 0)
  );

const getStoreRaw = (sale: AnyRow) =>
  String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();

const getCategory = (sale: AnyRow) =>
  String(
    pick(sale, ['familia', 'FAMILIA', 'categoria_real', 'CATEGORIA_REAL', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS')
  )
    .trim()
    .toUpperCase();

const getRegion = (sale: AnyRow) => {
  const rawRegion = String(pick(sale, ['regiao', 'REGIAO'], '')).trim().toUpperCase();
  const store = getStoreName(getStoreRaw(sale)).toUpperCase();
  return getStoreRegion(store, rawRegion);
};

const getDescription = (sale: AnyRow) =>
  String(pick(sale, ['descricao', 'DESCRICAO', 'produto', 'PRODUTO'], 'N/D')).trim().toUpperCase();

const getQuantity = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['quantidade', 'QUANTIDADE', 'qtd', 'QTD'], 0));

const isInsuranceRow = (sale: AnyRow) => {
  const tipo = String(pick(sale, ['tipo_registro', 'TIPO_REGISTRO'], '')).trim().toUpperCase();
  if (tipo === 'SEGURO') return true;
  const text = `${getCategory(sale)} ${getDescription(sale)}`;
  return /SEGURO|PROTECAO|PROTEÇÃO|GARANTIA|SAMSUNG CARE|CARE\+/.test(text);
};

/**
 * Calcula a variação percentual evitando:
 * 1) Mostrar -100% quando o período atual (valB) ainda está zerado (ex: meses futuros como Dezembro)
 * 2) Distorções visuais absurdas quando o ano anterior tinha apenas R$ 100 de teste de inauguração
 */
const calcVariationPct = (valA: number, valB: number): number | null => {
  if (valB <= 0) return null; // Se ainda não houve venda no período atual, não exibe -100%
  if (valA <= 0 && valB > 0) return 100;
  return ((valB - valA) / valA) * 100;
};

const formatPctBadgeText = (pct: number | null, valA?: number, valB?: number): string => {
  if (pct === null) return '—';
  if (valA !== undefined && valB !== undefined && valA <= 0 && valB > 0) return 'NOVO';
  if (pct > 999) {
    return valA !== undefined && valB !== undefined && valA > 0
      ? `${Math.round(valB / valA).toLocaleString('pt-BR')}×`
      : '10×+';
  }
  if (pct < -99.9) return '-99%';
  const rounded = Math.round(pct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};

const extractYearMonth = (raw: any): { year: string; month: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return {
      year: String(raw.getFullYear()),
      month: String(raw.getMonth() + 1).padStart(2, '0'),
    };
  }

  const s = String(raw).trim();

  if (/^\d{4}$/.test(s)) return { year: s, month: '01' };

  const normalized = s.replace(/\./g, '/').replace(/\s+/g, '');

  if (normalized.includes('-')) {
    const parts = normalized.split('-').filter(Boolean);
    if (/^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
    if (
      parts.length === 3 &&
      /^\d{4}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      /^\d{1,2}$/.test(parts[2])
    ) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
  }

  if (normalized.includes('/')) {
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
    if (
      parts.length === 3 &&
      /^\d{1,2}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      /^\d{4}$/.test(parts[2])
    ) {
      return { year: parts[2], month: String(parts[1]).padStart(2, '0') };
    }
  }

  const m = normalized.match(/(\d{4}).*?(\d{1,2})/);
  if (m?.[1] && m?.[2]) return { year: m[1], month: String(m[2]).padStart(2, '0') };

  return null;
};

const parseDateLoose = (raw: any): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(`${s}-01T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const isWithinDateRange = (raw: any, startDate: string, endDate: string) => {
  const value = parseDateLoose(raw);
  if (!value) return false;

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);
    if (value < start) return false;
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59`);
    if (value > end) return false;
  }

  return true;
};

const SmallMetricCard = ({
  title,
  icon,
  value,
  subtitle,
  valueClass = 'text-slate-900',
  children,
}: {
  title: string;
  icon: React.ReactNode;
  value?: string;
  subtitle?: string;
  valueClass?: string;
  children?: React.ReactNode;
}) => (
  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm min-h-[150px] flex flex-col">
    <div className="flex justify-between items-start mb-3">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{title}</span>
      <div className="p-1.5 rounded-lg bg-orange-50 text-orange-600">{icon}</div>
    </div>
    {children ? (
      <div className="w-full flex-1">{children}</div>
    ) : (
      <>
        <h3 className={`text-2xl font-black tracking-tight ${valueClass}`}>{value}</h3>
        {subtitle && (
          <div className="text-[10px] font-bold text-slate-500 uppercase mt-3 whitespace-pre-line leading-relaxed">
            {subtitle}
          </div>
        )}
      </>
    )}
  </div>
);

const LegendItem = ({ color, label }: { color: string; label: string }) => (
  <span className="flex items-center gap-2 text-xs font-bold text-slate-600">
    <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ backgroundColor: color }} />
    {label}
  </span>
);

// A indicação de crescimento usa o mesmo jogo de cores do painel, inclusive nos subtotais.
const GrowthChip = ({
  pct, previous, current, prominent = false, dark = false,
}: {
  pct: number | null;
  previous: number;
  current: number;
  prominent?: boolean;
  dark?: boolean;
}) => {
  const label = formatPctBadgeText(pct, previous, current);
  const tone = pct === null
    ? (dark ? 'border-slate-600 bg-slate-800 text-slate-300' : 'border-slate-200 bg-slate-100 text-slate-500')
    : pct < 0
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-md border font-extrabold tabular-nums leading-none ${prominent ? 'min-w-[40px] px-1.5 py-1 text-[11px]' : 'min-w-[38px] px-1.5 py-1 text-[10px]'} ${tone}`} title={`Variação: ${label}`}>
      {label}
    </span>
  );
};

// Célula exclusiva do Mapa de Calor: realizado, variação e referência do ano anterior.
// Mantém os cálculos existentes e usa dicas completas (title) para auditoria dos valores.
const HeatCell = ({
  current,
  previous,
  previousYear,
  total = false,
  dark = false,
}: {
  current: number;
  previous: number;
  previousYear?: string;
  total?: boolean;
  dark?: boolean;
}) => {
  const pct = calcVariationPct(previous, current);
  const empty = current <= 0 && previous <= 0;
  const bg = dark
    ? 'bg-slate-900 border-slate-700'
    : empty
      ? 'bg-slate-50 border-slate-200'
      : pct === null
        ? 'bg-slate-50 border-slate-200'
        : pct >= 30
          ? 'bg-emerald-100/85 border-emerald-200/80'
          : pct >= 0
            ? 'bg-emerald-50 border-emerald-100'
            : pct <= -20
              ? 'bg-rose-100/85 border-rose-200/80'
              : 'bg-rose-50 border-rose-100';

  return (
    <div
      className={`flex min-h-[54px] w-full flex-col justify-center gap-1 rounded-md border px-1.5 py-1.5 ${bg}`}
      title={`Realizado: ${formatMoney(current)} | ${previousYear || 'Ano anterior'}: ${formatMoney(previous)} | Variação: ${formatPctBadgeText(pct, previous, current)}`}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-1">
        <span className={`min-w-0 whitespace-nowrap font-sans font-black tracking-tight tabular-nums ${total ? 'text-[14px] xl:text-[15px]' : 'text-[13px] xl:text-[14px]'} ${dark ? 'text-orange-300' : 'text-slate-900'}`}>
          {current > 0 ? formatCellCompact(current) : empty ? '—' : '0'}
        </span>
        {!empty && (
          <GrowthChip pct={pct} previous={previous} current={current} prominent={false} dark={dark} />
        )}
      </div>
      <span className={`block truncate whitespace-nowrap text-[10px] font-semibold tabular-nums ${dark ? 'text-slate-300' : 'text-slate-500'}`}>
        {previousYear ? `${previousYear}: ` : 'Anterior: '}{previous > 0 ? formatCellCompact(previous) : '—'}
      </span>
    </div>
  );
};

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [monthlyRawData, setMonthlyRawData] = useState<any[]>([]);
  const [annualStoreCompareRows, setAnnualStoreCompareRows] = useState<any[]>([]);
  const [monthlyInsuranceFallback, setMonthlyInsuranceFallback] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [monthFilter, setMonthFilter] = useState<string>('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [yearA, setYearA] = useState<string>('');
  const [yearB, setYearB] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'geral' | 'lojas' | 'produtos'>('geral');
  // Alterações feitas pela tabela são locais ao navegador, sem gravar no servidor.
  const [modoAnalise, setModoAnalise] = useState<ModoAnalise>('bruto');
  const [mostrarCadastroLojas, setMostrarCadastroLojas] = useState(false);
  const [filtroCadastroLojas, setFiltroCadastroLojas] = useState('');
  const [classificacaoPersonalizada, setClassificacaoPersonalizada] = useState<Record<string, LojaConsideravel>>(() => {
    try {
      const valor = window.localStorage.getItem(CLASSIFICACAO_STORAGE_KEY);
      const objeto = valor ? JSON.parse(valor) : {};
      if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return {};
      const seguro: Record<string, LojaConsideravel> = {};
      for (const [nome, status] of Object.entries(objeto)) {
        if (status === 'OK' || status === 'NAO_OK' || status === 'PENDENTE') seguro[nome] = status;
      }
      return seguro;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(CLASSIFICACAO_STORAGE_KEY, JSON.stringify(classificacaoPersonalizada));
    } catch (e) {
      console.warn('Não foi possível salvar a classificação local das lojas.', e);
    }
  }, [classificacaoPersonalizada]);

  const [searchProduct, setSearchProduct] = useState('');

  // Estados da aba "Visão por Loja"
  const [storeViewMode, setStoreViewMode] = useState<'comparativo' | 'mes_a_mes'>('comparativo');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('TODAS');
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>({});
  const [searchStoreQuery, setSearchStoreQuery] = useState<string>('');
  const [storeSortKey, setStoreSortKey] = useState<StoreSortKey>('loja');
  const [storeSortDir, setStoreSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleRegion = (region: string) => setCollapsedRegions((old) => ({ ...old, [region]: !old[region] }));

  const API_URL = useMemo(() => {
    const envUrl = String(
      import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_BACKEND_URL ||
      ''
    ).trim();

    if (envUrl) return envUrl.replace(/\/$/, '');

    const hostname = window.location.hostname;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.endsWith('.local');

    return isLocal ? `http://${hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';
  }, []);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) setIsStoreMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getUserId = () => {
    let userId = '';
    try {
      const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        userId = parsed.id || parsed.userId || parsed._id || '';
      }
    } catch (e) {
      console.error(e);
    }
    return userId;
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const userId = getUserId();

      const [resAnnual, resMonthly, resSegurosMensal] = await Promise.all([
        fetch(`${API_URL}/sales_anuais?userId=${userId}`),
        fetch(`${API_URL}/sales?userId=${userId}`),
        fetch(`${API_URL}/seguros_analytics?userId=${userId}`).catch(() => null),
      ]);

      if (!resAnnual.ok) throw new Error('Rota de histórico anual não encontrada no servidor.');
      if (!resMonthly.ok) throw new Error('Rota de vendas mensais não encontrada no servidor.');

      const dataAnnual = await resAnnual.json();
      const dataMonthly = await resMonthly.json();

      if (resSegurosMensal && resSegurosMensal.ok) {
        const dataSeg = await resSegurosMensal.json();
        const rankingSeg = Array.isArray(dataSeg?.rankingLojas) ? dataSeg.rankingLojas : [];
        setMonthlyInsuranceFallback(rankingSeg);
      }

      const annualList =
        (dataAnnual && Array.isArray(dataAnnual.sales) && dataAnnual.sales) ||
        (dataAnnual && Array.isArray(dataAnnual.data) && dataAnnual.data) ||
        (Array.isArray(dataAnnual) ? dataAnnual : []);

      const monthlyList =
        (dataMonthly && Array.isArray(dataMonthly.sales) && dataMonthly.sales) ||
        (dataMonthly && Array.isArray(dataMonthly.data) && dataMonthly.data) ||
        (Array.isArray(dataMonthly) ? dataMonthly : []);

      setAnnualRawData(annualList);
      setMonthlyRawData(monthlyList);
      setErrorMsg('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Erro ao carregar dados anuais.');
      setAnnualRawData([]);
      setMonthlyRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const mergedRawData = useMemo(() => {
    const today = new Date();
    const currentYear = String(today.getFullYear());
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');

    const annualWithoutCurrentMonth = annualRawData.filter((row) => {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym) return false;
      return !(ym.year === currentYear && ym.month === currentMonth);
    });

    const monthlyCurrentMonth = monthlyRawData.filter((row) => {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym) return false;
      return ym.year === currentYear && ym.month === currentMonth;
    });

    return [...annualWithoutCurrentMonth, ...monthlyCurrentMonth];
  }, [annualRawData, monthlyRawData]);

  const yearsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const sale of mergedRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (ym?.year) set.add(ym.year);
    }
    return Array.from(set).sort();
  }, [mergedRawData]);

  useEffect(() => {
    if (!yearsAvailable.length) return;
    const latest = yearsAvailable[yearsAvailable.length - 1];
    const previous = yearsAvailable.length >= 2 ? yearsAvailable[yearsAvailable.length - 2] : latest;
    setYearA((cur) => cur || previous);
    setYearB((cur) => cur || latest);
  }, [yearsAvailable]);

  useEffect(() => {
    const loadAnnualStoreCompare = async () => {
      if (!yearA || !yearB) return;
      try {
        const userId = getUserId();
        const month = Number(monthFilter || '0');
        const res = await fetch(
          `${API_URL}/anuais/lojas_compare?userId=${encodeURIComponent(userId)}&yearA=${encodeURIComponent(yearA)}&yearB=${encodeURIComponent(yearB)}&month=${month}`
        );
        if (!res.ok) throw new Error('Rota de comparação anual por lojas não encontrada.');
        const json = await res.json();
        const rows = (json && Array.isArray(json.data) && json.data) || (Array.isArray(json) ? json : []);
        setAnnualStoreCompareRows(rows);
      } catch (e: any) {
        console.error(e);
        setAnnualStoreCompareRows([]);
      }
    };
    loadAnnualStoreCompare();
  }, [API_URL, yearA, yearB, monthFilter]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(
      mergedRawData.map((r) => getCategory(r)).filter((c) => c && c !== 'NAN' && c !== 'UNDEFINED')
    );
    return Array.from(cats).sort();
  }, [mergedRawData]);

  const uniqueStores = useMemo(() => {
    const stores = new Set(mergedRawData.map((r) => getStoreName(getStoreRaw(r))).filter(Boolean));
    return Array.from(stores).sort();
  }, [mergedRawData]);

  // A lista de cadastro permanece completa, mesmo quando o filtro Líquido está ativo.
  const tabelaClassificacao = useMemo(() => {
    const lojas = new Set<string>([...Object.keys(CLASSIFICACAO_PADRAO), ...Object.values(STORE_MAP), ...uniqueStores]);
    const ufDaLoja = (loja: string) => {
      const regiao = STORE_REGION_MAP[loja] || 'OUTRAS';
      return regiao === 'GOIÁS' ? 'GO' : regiao === 'MINAS GERAIS' ? 'MG' : regiao === 'CD' ? 'DF' : regiao;
    };
    return Array.from(lojas)
      .map((loja) => ({
        loja,
        uf: ufDaLoja(loja),
        status: classificacaoPersonalizada[loja] ?? CLASSIFICACAO_PADRAO[loja] ?? 'PENDENTE' as LojaConsideravel,
      }))
      .sort((a, b) => a.uf.localeCompare(b.uf, 'pt-BR') || a.loja.localeCompare(b.loja, 'pt-BR'));
  }, [uniqueStores, classificacaoPersonalizada]);

  const classificacaoResumo = useMemo(() => ({
    ok: tabelaClassificacao.filter((l) => l.status === 'OK').length,
    naoOk: tabelaClassificacao.filter((l) => l.status === 'NAO_OK').length,
    pendentes: tabelaClassificacao.filter((l) => l.status === 'PENDENTE').length,
  }), [tabelaClassificacao]);

  const linhasTabelaClassificacao = useMemo(() => {
    const pesquisa = filtroCadastroLojas.trim().toLocaleUpperCase('pt-BR');
    return tabelaClassificacao.filter((linha) =>
      !pesquisa || `${linha.loja} ${linha.uf}`.includes(pesquisa)
    );
  }, [tabelaClassificacao, filtroCadastroLojas]);

  const alterarClassificacaoLoja = (loja: string, status: LojaConsideravel) => {
    setClassificacaoPersonalizada((anterior) => ({ ...anterior, [loja]: status }));
  };

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) setSelectedStores(selectedStores.filter((s) => s !== store));
    else setSelectedStores([...selectedStores, store]);
  };

  const clearDates = () => {
    setStartDate('');
    setEndDate('');
  };

  const handleStoreSort = (key: StoreSortKey) => {
    if (storeSortKey === key) {
      setStoreSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setStoreSortKey(key);
      setStoreSortDir(key === 'loja' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: StoreSortKey) => {
    if (storeSortKey !== key) return <ArrowUpDown size={11} className=" opacity-40" />;
    return storeSortDir === 'asc' ? <ArrowUp size={11} className="text-orange-500" /> : <ArrowDown size={11} className="text-orange-500" />;
  };

  const baseFilteredRawData = useMemo(() => {
    return mergedRawData.filter((sale) => {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) return false;

      const storeName = getStoreName(getStoreRaw(sale)).toUpperCase();

      if (modoAnalise === 'liquido' && (classificacaoPersonalizada[storeName] ?? CLASSIFICACAO_PADRAO[storeName] ?? 'PENDENTE') !== 'OK') return false;

      if (selectedStores.length > 0 && !selectedStores.map((s) => s.toUpperCase()).includes(storeName)) {
        return false;
      }

      if (categoryFilter !== 'TODAS' && getCategory(sale) !== categoryFilter) {
        return false;
      }

      if ((startDate || endDate) && !isWithinDateRange(getDateValue(sale), startDate, endDate)) {
        return false;
      }

      return true;
    });
  }, [mergedRawData, selectedStores, categoryFilter, startDate, endDate, modoAnalise, classificacaoPersonalizada]);

  const filteredRawData = useMemo(() => {
    return baseFilteredRawData.filter((sale) => {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) return false;

      if (monthFilter !== '0' && ym.month !== String(monthFilter).padStart(2, '0')) {
        return false;
      }

      return true;
    });
  }, [baseFilteredRawData, monthFilter]);

  const filteredAnnualStoreCompare = useMemo(() => {
    return annualStoreCompareRows.filter((row) => {
      const storeName = getStoreName(String(row.loja || row.LOJA || row.cnpj_empresa || row.CNPJ_EMPRESA || ''));
      if (modoAnalise === 'liquido' && (classificacaoPersonalizada[storeName] ?? CLASSIFICACAO_PADRAO[storeName] ?? 'PENDENTE') !== 'OK') return false;
      if (selectedStores.length > 0 && !selectedStores.map((s) => s.toUpperCase()).includes(storeName.toUpperCase())) {
        return false;
      }
      return true;
    });
  }, [annualStoreCompareRows, selectedStores, modoAnalise, classificacaoPersonalizada]);

  const computed = useMemo(() => {
    const today = new Date();
    const currentYear = String(today.getFullYear());
    const currentMonth = today.getMonth() + 1;
    const currentDay = Math.max(1, today.getDate());
    const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const daysPassedInYear = Math.max(
      1,
      Math.floor((today.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );
    const daysInYear = today.getFullYear() % 4 === 0 ? 366 : 365;

    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const years = [yearA, yearB].filter(Boolean);

    const totalsByYearMonth: Record<string, Record<string, number>> = {};
    const storeTotalsByYear: Record<string, Record<string, number>> = {};
    const totalByYear: Record<string, number> = {};

    for (const year of years) {
      totalsByYearMonth[year] = {};
      storeTotalsByYear[year] = {};
      totalByYear[year] = 0;
      for (const month of monthKeys) totalsByYearMonth[year][month] = 0;
    }

    for (const sale of filteredRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym || !years.includes(ym.year)) continue;
      if (isInsuranceRow(sale)) continue;

      const total = getTotal(sale);
      if (!total) continue;

      const storeName = getStoreName(getStoreRaw(sale));

      totalsByYearMonth[ym.year][ym.month] = (totalsByYearMonth[ym.year][ym.month] || 0) + total;
      storeTotalsByYear[ym.year][storeName] = (storeTotalsByYear[ym.year][storeName] || 0) + total;
      totalByYear[ym.year] += total;
    }

    let currentMonthRealYearB = 0;

    const chartData = monthKeys.map((month, idx) => {
      const totalYearA = yearA ? totalsByYearMonth[yearA]?.[month] || 0 : 0;
      const totalYearB = yearB ? totalsByYearMonth[yearB]?.[month] || 0 : 0;

      const row: AnyRow = {
        mes: MONTH_LABELS[idx],
        mesNumero: month,
        [yearA]: totalYearA,
        [`${yearB}_real`]: totalYearB,
        [`${yearB}_proj`]: 0,
        [`${yearB}_realLabel`]: totalYearB,
        [`${yearB}_projLabel`]: 0,
      };

      if (yearB === currentYear && Number(month) === currentMonth) {
        currentMonthRealYearB = totalYearB;
        const projectedMonth = currentDay > 0 ? (totalYearB / currentDay) * daysInCurrentMonth : totalYearB;
        const remaining = Math.max(0, projectedMonth - totalYearB);
        row[`${yearB}_proj`] = remaining;
        if (remaining > 0) {
          row[`${yearB}_realLabel`] = 0;
          row[`${yearB}_projLabel`] = totalYearB + remaining;
        }
      }

      return row;
    });

    const totalA = yearA ? totalByYear[yearA] || 0 : 0;
    const totalB = yearB ? totalByYear[yearB] || 0 : 0;

    const cutoffMonth = monthFilter !== '0' ? Number(monthFilter) : currentMonth;

    const totalAUntilCurrentMonth = yearA
      ? monthKeys
          .filter((m) => Number(m) <= cutoffMonth)
          .reduce((sum, m) => sum + (totalsByYearMonth[yearA]?.[m] || 0), 0)
      : 0;

    const hasExplicitDateFilter = Boolean(startDate || endDate);
    const hasSingleMonthFilter = monthFilter !== '0';

    let localYearForecast = totalB;
    let trendLabel = 'Ano fechado';

    if (yearB === currentYear && !hasExplicitDateFilter) {
      if (hasSingleMonthFilter && Number(monthFilter) === currentMonth) {
        localYearForecast = totalB - currentMonthRealYearB + (currentDay > 0 ? (currentMonthRealYearB / currentDay) * daysInCurrentMonth : currentMonthRealYearB);
        trendLabel = 'Projeção do mês atual no recorte';
      } else if (!hasSingleMonthFilter) {
        localYearForecast = daysPassedInYear > 0 ? (totalB / daysPassedInYear) * daysInYear : totalB;
        trendLabel = 'Projeção anual pelo ritmo atual';
      } else {
        localYearForecast = totalB;
        trendLabel = 'Filtro de mês fechado';
      }
    } else if (hasExplicitDateFilter) {
      trendLabel = 'Filtro de datas aplicado';
    }

    const bestStoreByYear = (year: string) => {
      const entries = Object.entries(storeTotalsByYear[year] || {})
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);
      return entries[0] || { nome: '—', total: 0 };
    };

    const bestB = yearB ? bestStoreByYear(yearB) : { nome: '—', total: 0 };
    const growthVsYearA = totalA > 0 ? ((localYearForecast - totalA) / totalA) * 100 : 0;

    return {
      chartData,
      totalA,
      totalAUntilCurrentMonth,
      totalB,
      bestB,
      localMonthSoFar: currentMonthRealYearB,
      localMonthForecast:
        yearB === currentYear && currentDay > 0
          ? Math.max(currentMonthRealYearB, (currentMonthRealYearB / currentDay) * daysInCurrentMonth)
          : currentMonthRealYearB,
      localYearForecast: Math.max(localYearForecast, totalB),
      trendLabel,
      growthVsYearA,
      cutoffLabel:
        monthFilter !== '0'
          ? `Até ${MONTH_FULL[Number(monthFilter)]}`
          : yearB === currentYear
            ? 'Até mês atual'
            : 'Ano completo',
    };
  }, [filteredRawData, yearA, yearB, monthFilter, startDate, endDate]);

  const segurosComputed = useMemo(() => {
    const byYear: Record<string, { total: number; qtd: number }> = {
      [yearA]: { total: 0, qtd: 0 },
      [yearB]: { total: 0, qtd: 0 },
    };

    for (const row of filteredAnnualStoreCompare) {
      const year = String(row.ano || row.ANO || '');
      if (year !== yearA && year !== yearB) continue;

      byYear[year] = {
        total: (byYear[year]?.total || 0) + toNumberSafe(row.seguro_total || row.SEGURO_TOTAL || 0),
        qtd: (byYear[year]?.qtd || 0) + toNumberSafe(row.seguro_qtd || row.SEGURO_QTD || 0),
      };
    }

    const hasInsurance = Object.values(byYear).some((item) => item.total !== 0 || item.qtd !== 0);

    if (!hasInsurance) {
      for (const row of filteredRawData) {
        const ym = extractYearMonth(getDateValue(row));
        if (!ym || (ym.year !== yearA && ym.year !== yearB)) continue;
        if (!isInsuranceRow(row)) continue;

        byYear[ym.year].total += getTotal(row);
        byYear[ym.year].qtd += getQuantity(row) || 1;
      }

      const now = new Date();
      const curYear = String(now.getFullYear());
      const curMonth = String(now.getMonth() + 1);
      if (
        byYear[curYear] &&
        byYear[curYear].total === 0 &&
        (monthFilter === '0' || monthFilter === curMonth)
      ) {
        for (const sRow of monthlyInsuranceFallback) {
          const storeName = getStoreName(String(sRow.loja || ''));
          if (modoAnalise === 'liquido' && (classificacaoPersonalizada[storeName] ?? CLASSIFICACAO_PADRAO[storeName] ?? 'PENDENTE') !== 'OK') continue;
          if (
            selectedStores.length > 0 &&
            !selectedStores.map((s) => s.toUpperCase()).includes(storeName.toUpperCase())
          ) {
            continue;
          }
          byYear[curYear].total += toNumberSafe(sRow.valorSeguro || sRow.seguros || 0);
          byYear[curYear].qtd += toNumberSafe(sRow.qtdSeguros || 0);
        }
      }
    }

    return {
      yearA: byYear[yearA] || { total: 0, qtd: 0 },
      yearB: byYear[yearB] || { total: 0, qtd: 0 },
    };
  }, [filteredAnnualStoreCompare, filteredRawData, monthlyInsuranceFallback, selectedStores, monthFilter, yearA, yearB, modoAnalise, classificacaoPersonalizada]);

  /* ============================================================================
     CÁLCULO DA ABA: "VISÃO POR LOJA" (FATURAMENTO, SEGURO E MÊS A MÊS)
     ============================================================================ */
  const storeVisionData = useMemo(() => {
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

    type StoreEntry = {
      loja: string;
      regiao: string;
      fatA: number;
      fatB: number;
      segA: number;
      segB: number;
      monthsA: Record<string, number>;
      monthsB: Record<string, number>;
    };

    const storeMap = new Map<string, StoreEntry>();

    const ensureStore = (storeName: string, rawRegion?: string) => {
      const cleanName = getStoreName(storeName);
      if (!storeMap.has(cleanName)) {
        const mA: Record<string, number> = {};
        const mB: Record<string, number> = {};
        monthKeys.forEach((m) => {
          mA[m] = 0;
          mB[m] = 0;
        });
        storeMap.set(cleanName, {
          loja: cleanName,
          regiao: getStoreRegion(cleanName, rawRegion),
          fatA: 0,
          fatB: 0,
          segA: 0,
          segB: 0,
          monthsA: mA,
          monthsB: mB,
        });
      }
      return storeMap.get(cleanName)!;
    };

    for (const sale of baseFilteredRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym || (ym.year !== yearA && ym.year !== yearB)) continue;

      const storeName = getStoreName(getStoreRaw(sale));
      if (!storeName || storeName === 'N/D') continue;

      const total = getTotal(sale);
      const isSeg = isInsuranceRow(sale);
      const entry = ensureStore(storeName, pick(sale, ['regiao', 'REGIAO'], ''));

      if (!isSeg) {
        if (ym.year === yearA) {
          entry.monthsA[ym.month] = (entry.monthsA[ym.month] || 0) + total;
        } else if (ym.year === yearB) {
          entry.monthsB[ym.month] = (entry.monthsB[ym.month] || 0) + total;
        }
      }

      const matchesSelectedMonth = monthFilter === '0' || ym.month === String(monthFilter).padStart(2, '0');
      if (matchesSelectedMonth) {
        if (ym.year === yearA) {
          if (isSeg) entry.segA += total;
          else entry.fatA += total;
        } else if (ym.year === yearB) {
          if (isSeg) entry.segB += total;
          else entry.fatB += total;
        }
      }
    }

    const apiInsuranceByStore = new Map<string, { segA: number; segB: number }>();
    for (const row of filteredAnnualStoreCompare) {
      const year = String(row.ano || row.ANO || '');
      if (year !== yearA && year !== yearB) continue;

      const storeName = getStoreName(String(row.loja || row.LOJA || row.cnpj_empresa || row.CNPJ_EMPRESA || ''));
      if (!storeName || storeName === 'N/D') continue;

      const segVal = toNumberSafe(row.seguro_total || row.SEGURO_TOTAL || 0);
      if (!apiInsuranceByStore.has(storeName)) {
        apiInsuranceByStore.set(storeName, { segA: 0, segB: 0 });
      }
      const item = apiInsuranceByStore.get(storeName)!;
      if (year === yearA) item.segA += segVal;
      if (year === yearB) item.segB += segVal;
    }

    apiInsuranceByStore.forEach((segVals, storeName) => {
      if (segVals.segA > 0 || segVals.segB > 0) {
        const entry = ensureStore(storeName);
        entry.segA = segVals.segA;
        entry.segB = segVals.segB;
      }
    });

    const now = new Date();
    const curYear = String(now.getFullYear());
    const curMonth = String(now.getMonth() + 1);
    if (
      yearB === curYear &&
      (monthFilter === '0' || monthFilter === curMonth) &&
      apiInsuranceByStore.size === 0
    ) {
      for (const sRow of monthlyInsuranceFallback) {
        const storeName = getStoreName(String(sRow.loja || ''));
        if (!storeName || storeName === 'N/D') continue;
        if (modoAnalise === 'liquido' && (classificacaoPersonalizada[storeName] ?? CLASSIFICACAO_PADRAO[storeName] ?? 'PENDENTE') !== 'OK') continue;
        if (
          selectedStores.length > 0 &&
          !selectedStores.map((s) => s.toUpperCase()).includes(storeName.toUpperCase())
        ) {
          continue;
        }
        const val = toNumberSafe(sRow.valorSeguro || sRow.seguros || 0);
        if (val > 0) {
          const entry = ensureStore(storeName);
          if (entry.segB === 0) entry.segB = val;
        }
      }
    }

    const allStores = Array.from(storeMap.values())
      .filter((s) => s.fatA > 0 || s.fatB > 0 || s.segA > 0 || s.segB > 0)
      .map((s) => ({
        ...s,
        fatPct: calcVariationPct(s.fatA, s.fatB),
        segPct: calcVariationPct(s.segA, s.segB),
      }));

    const regionMap = new Map<
      string,
      { regiao: string; fatA: number; fatB: number; segA: number; segB: number; count: number }
    >();

    for (const s of allStores) {
      if (!regionMap.has(s.regiao)) {
        regionMap.set(s.regiao, { regiao: s.regiao, fatA: 0, fatB: 0, segA: 0, segB: 0, count: 0 });
      }
      const r = regionMap.get(s.regiao)!;
      r.fatA += s.fatA;
      r.fatB += s.fatB;
      r.segA += s.segA;
      r.segB += s.segB;
      r.count += 1;
    }

    const regions = Array.from(regionMap.values())
      .map((r) => ({
        ...r,
        fatPct: calcVariationPct(r.fatA, r.fatB),
        segPct: calcVariationPct(r.segA, r.segB),
      }))
      .sort((a, b) => sortRegionName(a.regiao) - sortRegionName(b.regiao) || b.fatB - a.fatB);

    const visibleStores = allStores
      .filter((s) => {
        if (selectedRegionFilter !== 'TODAS' && s.regiao !== selectedRegionFilter) return false;
        if (searchStoreQuery.trim() !== '') {
          const term = searchStoreQuery.trim().toLowerCase();
          if (!s.loja.toLowerCase().includes(term) && !s.regiao.toLowerCase().includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (storeSortKey === 'loja') {
          return storeSortDir === 'asc'
            ? a.loja.localeCompare(b.loja)
            : b.loja.localeCompare(a.loja);
        }
        const valA = a[storeSortKey] ?? -999999;
        const valB = b[storeSortKey] ?? -999999;
        return storeSortDir === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
      });

    const totals = visibleStores.reduce(
      (acc, s) => {
        acc.fatA += s.fatA;
        acc.fatB += s.fatB;
        acc.segA += s.segA;
        acc.segB += s.segB;
        monthKeys.forEach((m) => {
          acc.monthsA[m] = (acc.monthsA[m] || 0) + (s.monthsA[m] || 0);
          acc.monthsB[m] = (acc.monthsB[m] || 0) + (s.monthsB[m] || 0);
        });
        return acc;
      },
      {
        fatA: 0,
        fatB: 0,
        segA: 0,
        segB: 0,
        monthsA: {} as Record<string, number>,
        monthsB: {} as Record<string, number>,
      }
    );

    type RegionGroup = {
      regiao: string;
      stores: typeof visibleStores;
      subtotal: {
        fatA: number;
        fatB: number;
        segA: number;
        segB: number;
        monthsA: Record<string, number>;
        monthsB: Record<string, number>;
        count: number;
      };
    };
    const groupedVisibleStores = Array.from(
      visibleStores.reduce((map, store) => {
        if (!map.has(store.regiao)) {
          const emptyMonthsA: Record<string, number> = {};
          const emptyMonthsB: Record<string, number> = {};
          monthKeys.forEach((m) => {
            emptyMonthsA[m] = 0;
            emptyMonthsB[m] = 0;
          });
          map.set(store.regiao, {
            regiao: store.regiao,
            stores: [] as typeof visibleStores,
            subtotal: {
              fatA: 0,
              fatB: 0,
              segA: 0,
              segB: 0,
              monthsA: emptyMonthsA,
              monthsB: emptyMonthsB,
              count: 0,
            },
          });
        }
        const current = map.get(store.regiao)!;
        current.stores.push(store);
        current.subtotal.fatA += store.fatA;
        current.subtotal.fatB += store.fatB;
        current.subtotal.segA += store.segA;
        current.subtotal.segB += store.segB;
        current.subtotal.count += 1;
        monthKeys.forEach((m) => {
          current.subtotal.monthsA[m] += store.monthsA[m] || 0;
          current.subtotal.monthsB[m] += store.monthsB[m] || 0;
        });
        return map;
      }, new Map<string, RegionGroup>()).values()
    ).map((group) => ({
      ...group,
      subtotal: {
        ...group.subtotal,
        fatPct: calcVariationPct(group.subtotal.fatA, group.subtotal.fatB),
        segPct: calcVariationPct(group.subtotal.segA, group.subtotal.segB),
      },
    })).sort((a, b) => sortRegionName(a.regiao) - sortRegionName(b.regiao) || a.regiao.localeCompare(b.regiao));

    return {
      allStores,
      visibleStores,
      regions,
      groupedVisibleStores,
      totals: {
        ...totals,
        fatPct: calcVariationPct(totals.fatA, totals.fatB),
        segPct: calcVariationPct(totals.segA, totals.segB),
      },
    };
  }, [
    baseFilteredRawData,
    filteredAnnualStoreCompare,
    monthlyInsuranceFallback,
    selectedStores,
    yearA,
    yearB,
    monthFilter,
    selectedRegionFilter,
    searchStoreQuery,
    storeSortKey,
    storeSortDir,
    modoAnalise,
    classificacaoPersonalizada,
  ]);

  const categoryMiniData = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of filteredRawData) {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym || ym.year !== yearB) continue;
      if (isInsuranceRow(row)) continue;
      const category = getCategory(row) || 'OUTROS';
      map.set(category, (map.get(category) || 0) + getTotal(row));
    }

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredRawData, yearB]);

  const regionPieData = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of filteredRawData) {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym || ym.year !== yearB) continue;
      if (isInsuranceRow(row)) continue;
      const region = getRegion(row) || 'SEM REGIÃO';
      map.set(region, (map.get(region) || 0) + getTotal(row));
    }

    const sorted = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    if (sorted.length <= 7) return sorted;
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((sum, r) => sum + r.value, 0);
    return [...top, { name: 'OUTRAS', value: rest }];
  }, [filteredRawData, yearB]);

  const regionTotal = useMemo(() => regionPieData.reduce((sum, r) => sum + r.value, 0), [regionPieData]);
  const categoryMax = useMemo(() => Math.max(1, ...categoryMiniData.map((c) => c.value)), [categoryMiniData]);

  const productComparison = useMemo(() => {
    const prodMap = new Map<string, { desc: string; totalA: number; qtdA: number; totalB: number; qtdB: number }>();

    for (const sale of filteredRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) continue;

      const isYearA = ym.year === yearA;
      const isYearB = ym.year === yearB;
      if (!isYearA && !isYearB) continue;

      const desc = getDescription(sale);
      const total = getTotal(sale);
      const qtd = getQuantity(sale);

      if (!prodMap.has(desc)) {
        prodMap.set(desc, { desc, totalA: 0, qtdA: 0, totalB: 0, qtdB: 0 });
      }

      const current = prodMap.get(desc)!;

      if (isYearA) {
        current.totalA += total;
        current.qtdA += qtd;
      }
      if (isYearB) {
        current.totalB += total;
        current.qtdB += qtd;
      }
    }

    return Array.from(prodMap.values())
      .map((p) => {
        let crescimentoPct = 0;
        if (p.totalA > 0) crescimentoPct = ((p.totalB - p.totalA) / p.totalA) * 100;
        else if (p.totalB > 0) crescimentoPct = 100;
        return { ...p, crescimentoPct };
      })
      .sort((a, b) => b.totalB - a.totalB);
  }, [filteredRawData, yearA, yearB]);

  const searchedProducts = useMemo(() => {
    if (!searchProduct) return productComparison;
    const term = searchProduct.toLowerCase();
    return productComparison.filter((p) => p.desc.toLowerCase().includes(term));
  }, [productComparison, searchProduct]);

  const topProductA = useMemo(() => {
    return [...productComparison].sort((a, b) => b.totalA - a.totalA)[0] || null;
  }, [productComparison]);

  const topProductB = useMemo(() => {
    return [...productComparison].sort((a, b) => b.totalB - a.totalB)[0] || null;
  }, [productComparison]);

  const maxGrowthProduct = useMemo(() => {
    const valid = productComparison.filter((p) => p.totalA > 10000);
    return valid.sort((a, b) => b.crescimentoPct - a.crescimentoPct)[0] || null;
  }, [productComparison]);

  const noData = computed.totalA + computed.totalB + segurosComputed.yearB.total <= 0;

  const chartLegendNameMap: Record<string, string> = useMemo(() => ({
    [yearA]: `${yearA}`,
    [`${yearB}_real`]: `${yearB}`,
    [`${yearB}_proj`]: `${yearB} Tendência`,
  }), [yearA, yearB]);

  const periodHeaderA = monthFilter !== '0' ? `${String(monthFilter).padStart(2, '0')}/${yearA}` : `${yearA}`;
  const periodHeaderB = monthFilter !== '0' ? `${String(monthFilter).padStart(2, '0')}/${yearB}` : `${yearB}`;

  return (
    <div className="h-full overflow-y-auto p-3 md:p-5 bg-[#F8FAFC] font-sans text-slate-800">
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <AlertCircle size={20} />
          <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* Cabeçalho + filtros */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 gap-3 bg-white px-4 py-3.5 rounded-2xl shadow-2xs border border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orange-500 rounded-xl text-white shadow-xs"><Activity size={18} /></div>
            <div>
              <h1 className="text-base md:text-lg font-black uppercase tracking-tight text-slate-900 leading-none">
                Comparativo Anual ({yearA || '—'} x {yearB || '—'})
              </h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                Histórico completo • Comparativo entre anos • Lojas & Produtos
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center w-full xl:w-auto">
          <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl gap-1.5 focus-within:border-orange-400 focus-within:bg-white">
            <Calendar size={13} className="text-orange-500" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 outline-none"
            />
          </div>

          <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl gap-1.5 focus-within:border-orange-400 focus-within:bg-white">
            <Calendar size={13} className="text-orange-500" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 outline-none"
            />
          </div>

          {(startDate || endDate) && (
            <button
              onClick={clearDates}
              className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50"
            >
              Limpar
            </button>
          )}

          <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl gap-1.5">
            <Calendar size={13} className="text-orange-500" />
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-700 uppercase outline-none cursor-pointer"
            >
              <option value="0">Todos os meses</option>
              {Object.entries(MONTH_FULL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl gap-1.5">
            <Layers size={13} className="text-orange-500" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-700 uppercase outline-none cursor-pointer max-w-[160px] truncate"
            >
              <option value="TODAS">Todas categorias</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="relative" ref={storeMenuRef}>
            <button
              onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
              className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors min-w-[155px] justify-between"
            >
              <div className="flex items-center gap-1.5">
                <Store size={13} className="text-orange-500" />
                <span className="truncate max-w-[110px] uppercase">
                  {selectedStores.length === 0 ? 'Todas as lojas' : selectedStores.length === 1 ? selectedStores[0] : `${selectedStores.length} lojas`}
                </span>
              </div>
              <ChevronDown size={13} className="text-slate-400" />
            </button>

            {isStoreMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 p-2 max-h-80 overflow-y-auto">
                <div
                  onClick={() => setSelectedStores([])}
                  className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1"
                >
                  {selectedStores.length === 0 ? <CheckSquare size={15} className="text-orange-500" /> : <Square size={15} className="text-slate-300" />}
                  <span className="text-xs font-bold text-slate-700 uppercase">Todas as lojas</span>
                </div>

                {uniqueStores.map((store) => (
                  <div
                    key={store}
                    onClick={() => toggleStore(store)}
                    className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    {selectedStores.includes(store)
                      ? <CheckSquare size={15} className="text-orange-500" />
                      : <Square size={15} className="text-slate-300" />
                    }
                    <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="bg-orange-500 hover:bg-orange-600 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Filter size={13} /> {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('geral')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
              activeTab === 'geral'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Activity size={15} /> Visão Geral
          </button>

          <button
            onClick={() => setActiveTab('lojas')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
              activeTab === 'lojas'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Store size={15} /> Visão por Loja
          </button>

          <button
            onClick={() => setActiveTab('produtos')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
              activeTab === 'produtos'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Package size={15} /> Comparativo de Produtos
          </button>
        </div>
      </div>

      {/* A classificação altera apenas o conjunto de lojas utilizado no cálculo;
          nunca altera dados no backend ou as bases de vendas. */}
      <section className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] font-black uppercase text-slate-700">Tipo de análise</span>
            <div role="group" aria-label="Tipo de análise" className="inline-flex rounded-lg bg-slate-100 p-1">
              <button type="button" onClick={() => setModoAnalise('bruto')}
                aria-pressed={modoAnalise === 'bruto'}
                className={`rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors ${modoAnalise === 'bruto' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}>
                Bruto
              </button>
              <button type="button" onClick={() => setModoAnalise('liquido')}
                aria-pressed={modoAnalise === 'liquido'}
                className={`rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors ${modoAnalise === 'liquido' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}>
                Líquido
              </button>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">{modoAnalise === 'liquido' ? `${classificacaoResumo.ok} lojas consideráveis` : 'Todas as lojas'}</span>
          </div>
          <button type="button" onClick={() => setMostrarCadastroLojas((v) => !v)}
            aria-expanded={mostrarCadastroLojas}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50">
            <Store size={14} className="text-orange-500" /> Classificar lojas
            <ChevronDown size={14} className={`transition-transform ${mostrarCadastroLojas ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {mostrarCadastroLojas && (
          <div className="border-t border-slate-200 bg-slate-50/50 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-black text-slate-900">Cadastro de lojas consideráveis</h3>
                <p className="text-[11px] font-medium text-slate-500">OK entra no Líquido; NÃO OK e pendentes aparecem somente no Bruto.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-black">
                <span className="text-emerald-700">OK: {classificacaoResumo.ok}</span>
                <span className="text-rose-700">NÃO OK: {classificacaoResumo.naoOk}</span>
                <span className="text-slate-500">Pendentes: {classificacaoResumo.pendentes}</span>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1 sm:max-w-sm">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={filtroCadastroLojas} onChange={(e) => setFiltroCadastroLojas(e.target.value)}
                  placeholder="Buscar loja ou UF..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[12px] text-slate-700 outline-none focus:border-orange-400" />
              </div>
              <button type="button" onClick={() => setClassificacaoPersonalizada({})}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 hover:border-orange-300">
                Restaurar classificação da planilha
              </button>
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full table-fixed border-collapse text-left text-[12px]">
                <thead className="sticky top-0 z-10 bg-slate-900 text-[11px] uppercase text-white">
                  <tr><th className="w-[54%] px-3 py-2">Loja</th><th className="w-[12%] px-3 py-2">UF</th><th className="w-[34%] px-3 py-2">Considerável?</th></tr>
                </thead>
                <tbody>
                  {linhasTabelaClassificacao.map(({ loja, uf, status }) => (
                    <tr key={loja} className="border-t border-slate-200 even:bg-slate-50/50">
                      <td title={loja} className="truncate px-3 py-2 font-extrabold text-slate-800">{loja}</td>
                      <td className="px-3 py-2 font-bold text-slate-500">{uf}</td>
                      <td className="px-3 py-1.5">
                        <select value={status} onChange={(e) => alterarClassificacaoLoja(loja, e.target.value as LojaConsideravel)}
                          aria-label={`Classificação de ${loja}`}
                          className={`w-full max-w-44 rounded-md border px-2 py-1.5 text-[12px] font-bold outline-none ${status === 'OK' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : status === 'NAO_OK' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                          <option value="OK">OK · considerável</option>
                          <option value="NAO_OK">NÃO OK</option>
                          <option value="PENDENTE">Não definida</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                  {linhasTabelaClassificacao.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-slate-500">Nenhuma loja encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] font-medium text-amber-800">Alterações feitas nesta tabela ficam salvas somente neste navegador. Para definir a mesma classificação para todos os usuários, atualize a lista padrão no frontend e publique uma nova versão, ou crie um cadastro no backend.</p>
          </div>
        )}
      </section>

      {noData && !loading && !errorMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 p-4 rounded-xl flex items-center gap-3 mb-4">
          <AlertCircle size={20} />
          <div className="text-sm font-bold">Nenhum dado encontrado com os filtros atuais.</div>
        </div>
      )}

      {/* ==========================================================================
          ABA 1: VISÃO GERAL
         ========================================================================== */}
      {activeTab === 'geral' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <SmallMetricCard
              title={`Faturamento ${yearB}`}
              icon={<Store size={16} />}
              value={formatMoney(computed.totalB)}
              valueClass="text-orange-600"
              subtitle={`Melhor loja: ${computed.bestB.nome}\n${formatMoney(computed.bestB.total)}`}
            />

            <SmallMetricCard
              title={`Faturamento ${yearA}`}
              icon={<Calendar size={16} />}
              value={formatMoney(computed.totalA)}
              valueClass="text-slate-700"
              subtitle={`${computed.cutoffLabel}: ${formatMoney(computed.totalAUntilCurrentMonth)}`}
            />

            <SmallMetricCard
              title={`Tendência ${yearB}`}
              icon={<TrendingUp size={16} />}
              value={formatMoney(computed.localYearForecast)}
              valueClass="text-orange-700"
              subtitle={`${computed.trendLabel}
Total real ${yearB}: ${formatMoney(computed.totalB)}
Crescimento: ${computed.growthVsYearA >= 0 ? '+' : ''}${computed.growthVsYearA.toFixed(2)}%`}
            />

            <SmallMetricCard
              title="Seguros"
              icon={<ShieldCheck size={16} />}
              value={formatMoney(segurosComputed.yearB.total)}
              valueClass="text-slate-900"
              subtitle={`Qtd. seguros (${yearB}): ${Math.round(segurosComputed.yearB.qtd).toLocaleString('pt-BR')}\nSeguros ${yearA}: ${formatMoney(segurosComputed.yearA.total)}`}
            />

            <SmallMetricCard
              title="Categorias"
              icon={<BarChart3 size={16} />}
            >
              {categoryMiniData.length ? (
                <div className="space-y-2.5">
                  {categoryMiniData.map((item) => (
                    <div key={item.name}>
                      <div className="flex justify-between gap-2 text-[10px] font-black uppercase">
                        <span className="truncate text-slate-600">{item.name}</span>
                        <span className="text-slate-800 shrink-0">{formatMoneyShort(item.value)}</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-orange-50 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (item.value / categoryMax) * 100)}%`,
                            background: `linear-gradient(90deg, ${THEME.orange}, #FB923C)`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] font-bold text-slate-400 uppercase">Sem categoria no filtro</div>
              )}
            </SmallMetricCard>

            <SmallMetricCard
              title="Regiões"
              icon={<PieChart size={16} />}
            >
              {regionPieData.length ? (
                <div className="flex items-center gap-4">
                  <div className="h-[116px] w-[116px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={regionPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={34}
                          outerRadius={54}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {regionPieData.map((entry, index) => (
                            <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any, _name: any, props: any) => [formatMoney(Number(value) || 0), props?.payload?.name || 'Região']} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    {regionPieData.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between gap-2 text-[10px] font-black uppercase text-slate-500">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="text-slate-800 shrink-0">
                          {formatMoneyShort(item.value)}
                          <span className="ml-1.5 text-slate-400 font-bold">
                            {regionTotal > 0 ? `${((item.value / regionTotal) * 100).toFixed(0)}%` : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] font-bold text-slate-400 uppercase">Sem região no filtro</div>
              )}
            </SmallMetricCard>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-orange-50 text-orange-600"><Activity size={16} /></div>
                <h3 className="font-black text-slate-700 uppercase text-xs">Vendas por Mês ({yearA} x {yearB})</h3>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <LegendItem color={CHART_COLORS.yearA} label={`${yearA}`} />
                <LegendItem color={CHART_COLORS.yearBReal} label={`${yearB}`} />
                <LegendItem color={CHART_COLORS.yearBProjection} label={`${yearB} Tendência`} />
              </div>
            </div>

            <div className="h-[320px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={computed.chartData}
                  margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
                  barGap={3}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="mes"
                    tick={{ fontSize: 12, fontWeight: 'bold', fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={(value: any) => formatMoneyShort(Number(value))} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: '#FFF7ED' }}
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '10px', border: 'none', color: '#fff' }}
                    labelStyle={{ color: '#FDBA74', fontWeight: 800 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(val: any, name: any) => [formatMoney(Number(val) || 0), chartLegendNameMap[name] || name]}
                  />

                  <Bar
                    dataKey={yearA}
                    name={chartLegendNameMap[yearA]}
                    stackId="anoA"
                    fill={CHART_COLORS.yearA}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={yearA}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={CHART_COLORS.yearA}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>

                  <Bar
                    dataKey={`${yearB}_real`}
                    name={chartLegendNameMap[`${yearB}_real`]}
                    stackId="anoB"
                    fill={CHART_COLORS.yearBReal}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={`${yearB}_realLabel`}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={THEME.orangeDark}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>

                  <Bar
                    dataKey={`${yearB}_proj`}
                    name={chartLegendNameMap[`${yearB}_proj`]}
                    stackId="anoB"
                    fill={CHART_COLORS.yearBProjection}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={`${yearB}_projLabel`}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={THEME.orangeDark}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ==========================================================================
          ABA 2: VISÃO POR LOJA (REDESIGN EXECUTIVO DE ALTA DENSIDADE)
         ========================================================================== */}
      {activeTab === 'lojas' && (
        <div className="space-y-3.5 animate-in fade-in duration-300">
          {/* FAIXA COMPACTA DE REGIÕES (MINICARDS EXECUTIVOS) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-2.5">
            {/* Card Rede Total */}
            <div
              onClick={() => setSelectedRegionFilter('TODAS')}
              className={`cursor-pointer px-3.5 py-2.5 rounded-xl border transition-all flex flex-col justify-between ${
                selectedRegionFilter === 'TODAS'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-800 border-slate-200/90 hover:border-orange-300'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[10px] font-black uppercase tracking-wider truncate ${selectedRegionFilter === 'TODAS' ? 'text-orange-400' : 'text-slate-400'}`}>
                  REDE TOTAL ({storeVisionData.allStores.length})
                </span>
                {storeVisionData.totals.fatPct !== null && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                      storeVisionData.totals.fatPct >= 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {formatPctBadgeText(storeVisionData.totals.fatPct, storeVisionData.totals.fatA, storeVisionData.totals.fatB)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-sm md:text-base font-black tracking-tight truncate">
                  {formatMoneyNoCents(storeVisionData.totals.fatB)}
                </span>
              </div>
              <div className={`mt-1 pt-1 border-t flex items-center justify-between text-[9px] font-bold ${selectedRegionFilter === 'TODAS' ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-400'}`}>
                <span className="truncate">{periodHeaderA}: {formatMoneyShort(storeVisionData.totals.fatA)}</span>
                <span className={selectedRegionFilter === 'TODAS' ? 'text-orange-300 font-black' : 'text-slate-600 font-black'}>
                  Seg: {formatMoneyShort(storeVisionData.totals.segB)}
                </span>
              </div>
            </div>

            {/* Cards das Regiões */}
            {storeVisionData.regions.map((reg) => {
              const isSelected = selectedRegionFilter === reg.regiao;
              const isPositive = (reg.fatPct ?? 0) >= 0;
              return (
                <div
                  key={reg.regiao}
                  onClick={() => setSelectedRegionFilter(isSelected ? 'TODAS' : reg.regiao)}
                  className={`cursor-pointer px-3.5 py-2.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-orange-50/90 border-orange-500 ring-2 ring-orange-500/15 shadow-xs'
                      : 'bg-white border-slate-200/90 hover:border-orange-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 truncate flex items-center gap-1">
                      <MapPin size={10} className="text-orange-500 shrink-0" />
                      {reg.regiao} ({reg.count})
                    </span>
                    {reg.fatPct !== null && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                          isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                        }`}
                      >
                        {formatPctBadgeText(reg.fatPct, reg.fatA, reg.fatB)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm md:text-base font-black text-slate-900 tracking-tight truncate">
                      {formatMoneyNoCents(reg.fatB)}
                    </span>
                  </div>
                  <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-400">
                    <span className="truncate">{periodHeaderA}: {formatMoneyShort(reg.fatA)}</span>
                    <span className="text-slate-600 font-black">Seg: {formatMoneyShort(reg.segB)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* PAINEL PRINCIPAL UNIFICADO */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden">
            {/* Barra de Controle Unificada */}
            <div className="px-3 py-2.5 border-b border-slate-200/80 bg-slate-50/60 flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-2">
              {/* Esquerda: Alternador de Relatório */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-200/70 p-1">
                  <button
                    onClick={() => setStoreViewMode('comparativo')}
                    className={`px-3.5 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all flex items-center gap-1.5 ${
                      storeViewMode === 'comparativo'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Store size={13} /> Faturamento & Seguro
                  </button>
                  <button
                    onClick={() => setStoreViewMode('mes_a_mes')}
                    className={`px-3.5 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all flex items-center gap-1.5 ${
                      storeViewMode === 'mes_a_mes'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Flame size={13} /> Mapa de Calor (Jan–Dez)
                  </button>
                </div>

              </div>

              {/* Centro: Seletor Rápido de Mês (Pills Compactas) */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  onClick={() => setMonthFilter('0')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all ${
                    monthFilter === '0'
                      ? 'bg-orange-500 text-white shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Ano Todo
                </button>
                {MONTH_LABELS.map((label, idx) => {
                  const mKey = String(idx + 1);
                  const isSelected = monthFilter === mKey;
                  return (
                    <button
                      key={mKey}
                      onClick={() => setMonthFilter(isSelected ? '0' : mKey)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all ${
                        isSelected
                          ? 'bg-orange-500 text-white shadow-2xs'
                          : 'bg-white border border-slate-200 text-slate-500 hover:border-orange-300 hover:text-orange-600'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Direita: Busca de Loja */}
              <div className="relative min-w-[200px] xl:w-56">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar Loja..."
                  value={searchStoreQuery}
                  onChange={(e) => setSearchStoreQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-[12px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-orange-400 transition-colors uppercase"
                />
              </div>
            </div>

            {/* ====================================================================
                MODO 1: TABELA EXECUTIVA FATURAMENTO GERAL & SEGURO GERAL
               ==================================================================== */}
            {storeViewMode === 'comparativo' && (
              <div className="mx-auto w-full max-w-[1380px] px-2 pb-3 pt-2 sm:px-3">
                {/* Desktop: relatório centrado, colunas contidas e subtotais ao pé de cada grupo. */}
                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 shadow-sm xl:block">
                  <table className="w-full min-w-[1130px] table-fixed border-collapse text-left tabular-nums">
                    <colgroup>
                      <col style={{ width: '26%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '10%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-900 text-[13px] font-black uppercase tracking-wide text-white">
                        <th className="border-r border-slate-700 px-3 py-2.5">Unidade / Filial ({storeVisionData.visibleStores.length})</th>
                        <th colSpan={3} className="border-r border-slate-700 px-3 py-2.5 text-center text-orange-300">Faturamento · {periodHeaderA} × {periodHeaderB}</th>
                        <th colSpan={3} className="border-l-[12px] border-white px-3 py-2.5 text-center text-sky-300">Seguros · {periodHeaderA} × {periodHeaderB}</th>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-100 text-[12px] font-extrabold uppercase text-slate-700">
                        <th className="cursor-pointer border-r border-slate-200 px-3 py-2 text-left hover:bg-slate-200" onClick={() => handleStoreSort('loja')}>
                          <span className="inline-flex items-center gap-1">Loja {renderSortIcon('loja')}</span>
                        </th>
                        {([
                          ['fatA', periodHeaderA], ['fatB', periodHeaderB], ['fatPct', 'Variação'],
                          ['segA', periodHeaderA], ['segB', periodHeaderB], ['segPct', 'Variação'],
                        ] as Array<[StoreSortKey, string]>).map(([key, label]) => (
                          <th key={key} onClick={() => handleStoreSort(key)}
                            className={`cursor-pointer px-2 py-2 text-right hover:bg-slate-200 ${key === 'segA' ? 'border-l-[12px] border-white' : 'border-l border-slate-200'} ${key === 'fatB' ? 'bg-orange-50/60' : key === 'segB' ? 'bg-sky-50/60' : ''}`}>
                            <span className="inline-flex items-center justify-end gap-1">{label} {renderSortIcon(key)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[12px] font-semibold text-slate-700">
                      {storeVisionData.groupedVisibleStores.map((group) => (
                        <React.Fragment key={`comp-${group.regiao}`}>
                          <tr className="border-y border-slate-300 bg-slate-100">
                            <td colSpan={7} className="px-3 py-2">
                              <button type="button" aria-expanded={!collapsedRegions[group.regiao]}
                                aria-label={`${collapsedRegions[group.regiao] ? 'Expandir' : 'Recolher'} filiais de ${group.regiao}`}
                                onClick={() => toggleRegion(group.regiao)}
                                className="flex w-full items-center gap-2 text-left text-[12px] font-black uppercase text-slate-800 hover:text-orange-700">
                                <span className="inline-flex min-w-7 justify-center rounded bg-slate-900 px-1.5 py-1 text-white">{regionShortLabel(group.regiao)}</span>
                                <span>{group.regiao}</span>
                                <span className="font-bold normal-case text-slate-500">{group.stores.length} filiais</span>
                                <ChevronDown size={16} className={`ml-auto transition-transform ${collapsedRegions[group.regiao] ? '-rotate-90' : ''}`} />
                              </button>
                            </td>
                          </tr>
                          {!collapsedRegions[group.regiao] && group.stores.map((store) => (
                            <tr key={`comp-${group.regiao}-${store.loja}`} className="border-b border-slate-200 even:bg-slate-50/50 hover:bg-orange-50/40">
                              <td className="border-r border-slate-200 px-3 py-1.5 text-[12px] font-extrabold text-slate-900" title={store.loja}>{store.loja}</td>
                              <td className="border-l border-slate-200 px-2.5 py-1.5 text-right">{formatMoney(store.fatA)}</td>
                              <td className="border-l border-slate-200 bg-orange-50/40 px-2.5 py-1.5 text-right font-extrabold text-slate-900">{formatMoney(store.fatB)}</td>
                              <td className="border-l border-slate-200 px-1.5 py-1 text-center"><GrowthChip pct={store.fatPct} previous={store.fatA} current={store.fatB} /></td>
                              <td className="border-l-[12px] border-white bg-sky-50/25 px-2.5 py-1.5 text-right">{formatMoney(store.segA)}</td>
                              <td className="border-l border-slate-200 bg-sky-50/50 px-2.5 py-1.5 text-right font-extrabold text-slate-900">{formatMoney(store.segB)}</td>
                              <td className="border-l border-slate-200 px-1.5 py-1 text-center"><GrowthChip pct={store.segPct} previous={store.segA} current={store.segB} /></td>
                            </tr>
                          ))}
                          <tr className="border-b-2 border-slate-300 bg-slate-100/90 text-[13px] font-black">
                            <td className="border-r border-slate-200 px-3 py-2 text-slate-800">SUBTOTAL {group.regiao}</td>
                            <td className="border-l border-slate-200 px-2.5 py-2 text-right text-slate-700">{formatMoney(group.subtotal.fatA)}</td>
                            <td className="border-l border-slate-200 bg-orange-50/60 px-2.5 py-2 text-right text-orange-700">{formatMoney(group.subtotal.fatB)}</td>
                            <td className="border-l border-slate-200 px-1.5 py-1.5 text-center"><GrowthChip pct={group.subtotal.fatPct} previous={group.subtotal.fatA} current={group.subtotal.fatB} prominent /></td>
                            <td className="border-l-[12px] border-white bg-sky-50/40 px-2.5 py-2 text-right text-slate-700">{formatMoney(group.subtotal.segA)}</td>
                            <td className="border-l border-slate-200 bg-sky-50/70 px-2.5 py-2 text-right text-sky-700">{formatMoney(group.subtotal.segB)}</td>
                            <td className="border-l border-slate-200 px-1.5 py-1.5 text-center"><GrowthChip pct={group.subtotal.segPct} previous={group.subtotal.segA} current={group.subtotal.segB} prominent /></td>
                          </tr>
                        </React.Fragment>
                      ))}
                      {storeVisionData.visibleStores.length === 0 && (
                        <tr><td colSpan={7} className="p-8 text-center font-bold text-slate-500">Nenhuma filial encontrada para os filtros selecionados.</td></tr>
                      )}
                    </tbody>
                    {storeVisionData.visibleStores.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-900 text-[14px] font-black text-white">
                          <td className="border-r border-slate-700 px-3 py-3">TOTAL DA REDE ({storeVisionData.visibleStores.length})</td>
                          <td className="px-2.5 py-3 text-right">{formatMoney(storeVisionData.totals.fatA)}</td>
                          <td className="border-l border-slate-700 px-2.5 py-3 text-right text-orange-300">{formatMoney(storeVisionData.totals.fatB)}</td>
                          <td className="border-l border-slate-700 px-1 py-2 text-center"><GrowthChip pct={storeVisionData.totals.fatPct} previous={storeVisionData.totals.fatA} current={storeVisionData.totals.fatB} prominent dark /></td>
                          <td className="border-l-[12px] border-white px-2.5 py-3 text-right">{formatMoney(storeVisionData.totals.segA)}</td>
                          <td className="border-l border-slate-700 px-2.5 py-3 text-right text-sky-300">{formatMoney(storeVisionData.totals.segB)}</td>
                          <td className="border-l border-slate-700 px-1 py-2 text-center"><GrowthChip pct={storeVisionData.totals.segPct} previous={storeVisionData.totals.segA} current={storeVisionData.totals.segB} prominent dark /></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Celular e tablet: mesmos valores em cartões de leitura confortável. */}
                <div className="space-y-3 xl:hidden">
                  {storeVisionData.groupedVisibleStores.map((group) => (
                    <section key={`mobile-comp-${group.regiao}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <button type="button" onClick={() => toggleRegion(group.regiao)} aria-expanded={!collapsedRegions[group.regiao]}
                        className="flex w-full items-center gap-2 bg-slate-100 px-3 py-2.5 text-left text-[13px] font-black text-slate-900">
                        <span className="rounded bg-slate-900 px-2 py-1 text-white">{regionShortLabel(group.regiao)}</span>
                        <span className="truncate">{group.regiao}</span>
                        <span className="text-[11px] font-semibold text-slate-500">({group.stores.length})</span>
                        <ChevronDown size={17} className={`ml-auto shrink-0 transition-transform ${collapsedRegions[group.regiao] ? '-rotate-90' : ''}`} />
                      </button>
                      {!collapsedRegions[group.regiao] && group.stores.map((store) => (
                        <div key={`mc-${store.loja}`} className="border-t border-slate-200 p-3">
                          <div className="mb-2 text-[13px] font-black uppercase text-slate-900">{store.loja}</div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-2.5">
                              <div className="mb-1 flex items-center justify-between gap-1"><span className="text-[11px] font-bold uppercase text-slate-600">Faturamento {yearB}</span><GrowthChip pct={store.fatPct} previous={store.fatA} current={store.fatB} /></div>
                              <div className="text-[17px] font-black tabular-nums text-slate-900">{formatMoney(store.fatB)}</div>
                              <div className="mt-1 text-[11px] text-slate-500">{yearA}: {formatMoney(store.fatA)}</div>
                            </div>
                            <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-2.5">
                              <div className="mb-1 flex items-center justify-between gap-1"><span className="text-[11px] font-bold uppercase text-slate-600">Seguros {yearB}</span><GrowthChip pct={store.segPct} previous={store.segA} current={store.segB} /></div>
                              <div className="text-[17px] font-black tabular-nums text-slate-900">{formatMoney(store.segB)}</div>
                              <div className="mt-1 text-[11px] text-slate-500">{yearA}: {formatMoney(store.segA)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="border-t-2 border-slate-300 bg-slate-100 px-3 py-2.5">
                        <div className="mb-2 text-[13px] font-black uppercase text-slate-800">Subtotal {group.regiao}</div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-orange-50 px-2 py-2"><div><div className="text-[10px] font-bold text-slate-500">Faturamento {yearB}</div><div className="text-[15px] font-black tabular-nums text-orange-700">{formatMoney(group.subtotal.fatB)}</div></div><GrowthChip pct={group.subtotal.fatPct} previous={group.subtotal.fatA} current={group.subtotal.fatB} prominent /></div>
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-2 py-2"><div><div className="text-[10px] font-bold text-slate-500">Seguros {yearB}</div><div className="text-[15px] font-black tabular-nums text-sky-700">{formatMoney(group.subtotal.segB)}</div></div><GrowthChip pct={group.subtotal.segPct} previous={group.subtotal.segA} current={group.subtotal.segB} prominent /></div>
                        </div>
                      </div>
                    </section>
                  ))}
                  {storeVisionData.visibleStores.length > 0 && (
                    <div className="rounded-xl bg-slate-900 p-3 text-white">
                      <div className="mb-2 text-[14px] font-black uppercase">TOTAL REDE ({storeVisionData.visibleStores.length} lojas)</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="flex justify-between gap-2"><div><span className="block text-[11px] text-slate-300">Faturamento {yearB}</span><strong className="text-[18px] text-orange-300">{formatMoney(storeVisionData.totals.fatB)}</strong></div><GrowthChip pct={storeVisionData.totals.fatPct} previous={storeVisionData.totals.fatA} current={storeVisionData.totals.fatB} prominent dark /></div>
                        <div className="flex justify-between gap-2"><div><span className="block text-[11px] text-slate-300">Seguros {yearB}</span><strong className="text-[18px] text-sky-300">{formatMoney(storeVisionData.totals.segB)}</strong></div><GrowthChip pct={storeVisionData.totals.segPct} previous={storeVisionData.totals.segA} current={storeVisionData.totals.segB} prominent dark /></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ====================================================================
                MODO 2: MATRIZ ANUAL MÊS A MÊS (100% NA TELA SEM ROLAGEM HORIZONTAL)
               ==================================================================== */}
            {storeViewMode === 'mes_a_mes' && (
              <div className="w-full max-w-none px-0 pb-3 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 pb-3 text-xs font-semibold text-slate-600">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <strong className="text-sm text-slate-900">Mapa mensal · {yearB} versus {yearA}</strong>
                    <span>Valor em destaque: {yearB} · linha inferior: {yearA}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-emerald-200" /> Crescimento</span>
                    <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-rose-200" /> Queda</span>
                    <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border border-slate-300 bg-slate-100" /> Sem comparação</span>
                    <span className="text-slate-400">Arraste lateralmente se necessário</span>
                  </div>
                </div>
                {/* Desktop: preserva legibilidade sem espremer as 12 colunas; scroll apenas se necessário. */}
                <div className="hidden w-full overflow-x-auto rounded-lg border-y border-slate-300 xl:block">
                  <table className="w-full min-w-[1750px] table-fixed border-separate border-spacing-0 text-left tabular-nums">
                    <colgroup>
                      <col style={{ width: '18%' }} />
                      {MONTH_LABELS.map((month) => <col key={month} style={{ width: '5.9%' }} />)}
                      <col style={{ width: '11%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-900 text-[13px] font-black uppercase tracking-wide text-white">
                        <th className="sticky left-0 z-20 border-r border-slate-700 bg-slate-900 px-4 py-3.5">
                          <button type="button" className="flex w-full items-center justify-between gap-1 text-left" onClick={() => handleStoreSort('loja')}>
                            Filial {renderSortIcon('loja')}
                          </button>
                        </th>
                        {MONTH_LABELS.map((month, index) => {
                          const active = monthFilter === String(index + 1);
                          return (
                            <th key={month} className={`cursor-pointer border-r border-slate-700 px-1 py-3 text-center ${active ? 'bg-orange-600' : ''}`}
                              onClick={() => setMonthFilter(active ? '0' : String(index + 1))} title={`Filtrar ${month}`}>
                              {month}
                            </th>
                          );
                        })}
                        <th className="border-l-2 border-slate-600 bg-slate-950 px-2 py-3 text-center text-orange-300">Total {yearB}</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12px] font-semibold">
                      {storeVisionData.groupedVisibleStores.map((group) => (
                        <React.Fragment key={`heat-${group.regiao}`}>
                          <tr className="border-y border-slate-300 bg-slate-100">
                            <td colSpan={14} className="px-3 py-2">
                              <button type="button" aria-expanded={!collapsedRegions[group.regiao]}
                                aria-label={`${collapsedRegions[group.regiao] ? 'Expandir' : 'Recolher'} filiais de ${group.regiao}`}
                                onClick={() => toggleRegion(group.regiao)}
                                className="flex w-full items-center gap-2 text-left text-[12px] font-black uppercase text-slate-800 hover:text-orange-700">
                                <span className="rounded bg-slate-900 px-2 py-1 text-white">{regionShortLabel(group.regiao)}</span>
                                <span>{group.regiao}</span><span className="font-bold normal-case text-slate-500">{group.stores.length} filiais</span>
                                <ChevronDown size={16} className={`ml-auto transition-transform ${collapsedRegions[group.regiao] ? '-rotate-90' : ''}`} />
                              </button>
                            </td>
                          </tr>
                          {!collapsedRegions[group.regiao] && group.stores.map((store) => {
                            const totalYearA = (Object.values(store.monthsA) as number[]).reduce((a, b) => a + b, 0);
                            const totalYearB = (Object.values(store.monthsB) as number[]).reduce((a, b) => a + b, 0);
                            return (
                              <tr key={`heat-${group.regiao}-${store.loja}`} className="hover:bg-orange-50/30">
                                <td className="sticky left-0 z-10 max-w-0 truncate border-b border-r border-slate-300 bg-white px-4 py-2.5 text-[12px] font-black text-slate-900" title={store.loja}>
                                  {shortenStoreName(store.loja)}
                                </td>
                                {MONTH_LABELS.map((month, index) => {
                                  const key = String(index + 1).padStart(2, '0');
                                  return (
                                    <td key={key} className="border-b border-r border-slate-200 bg-white px-1 py-2" title={`${store.loja} · ${month}`}>
                                      <HeatCell current={store.monthsB[key] || 0} previous={store.monthsA[key] || 0} previousYear={yearA} />
                                    </td>
                                  );
                                })}
                                <td className="border-b border-l-2 border-slate-300 bg-orange-50/60 px-1.5 py-2">
                                  <HeatCell current={totalYearB} previous={totalYearA} previousYear={yearA} total />
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                      {storeVisionData.visibleStores.length === 0 && (
                        <tr><td colSpan={14} className="p-8 text-center text-slate-500">Nenhuma filial encontrada.</td></tr>
                      )}
                    </tbody>
                    {storeVisionData.visibleStores.length > 0 && (
                      <tfoot className="bg-slate-900 text-white">
                        <tr>
                          <td className="sticky left-0 z-10 bg-slate-900 px-3 py-3 text-[15px] font-black">TOTAL REDE ({storeVisionData.visibleStores.length})</td>
                          {MONTH_LABELS.map((month, index) => {
                            const key = String(index + 1).padStart(2, '0');
                            return <td key={month} className="border-l border-slate-700 px-1 py-2"><HeatCell current={storeVisionData.totals.monthsB[key] || 0} previous={storeVisionData.totals.monthsA[key] || 0} previousYear={yearA} total dark /></td>;
                          })}
                          <td className="border-l-2 border-slate-600 bg-slate-950 px-0.5 py-2"><HeatCell current={storeVisionData.totals.fatB} previous={storeVisionData.totals.fatA} previousYear={yearA} total dark /></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Smartphone e tablet: grade adaptável para leitura sem zoom ou tabela espremida. */}
                <div className="space-y-3 xl:hidden">
                  <div className="px-3 text-[12px] font-semibold text-slate-600">{yearB}: realizado · {yearA}: comparação · verde: crescimento · vermelho: queda</div>
                  {storeVisionData.groupedVisibleStores.map((group) => (
                    <section key={`hm-${group.regiao}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <button type="button" aria-expanded={!collapsedRegions[group.regiao]} onClick={() => toggleRegion(group.regiao)}
                        className="flex w-full items-center gap-2 bg-slate-100 px-3 py-2.5 text-left text-[13px] font-black text-slate-800">
                        <span className="rounded bg-slate-900 px-2 py-1 text-white">{regionShortLabel(group.regiao)}</span>
                        <span className="truncate">{group.regiao}</span>
                        <span className="text-[11px] font-semibold text-slate-500">({group.stores.length})</span>
                        <ChevronDown size={17} className={`ml-auto shrink-0 transition-transform ${collapsedRegions[group.regiao] ? '-rotate-90' : ''}`} />
                      </button>
                      {!collapsedRegions[group.regiao] && group.stores.map((store) => {
                        const totalA = (Object.values(store.monthsA) as number[]).reduce((a, b) => a + b, 0);
                        const totalB = (Object.values(store.monthsB) as number[]).reduce((a, b) => a + b, 0);
                        return (
                          <div key={`hms-${store.loja}`} className="border-t border-slate-200 p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <strong className="text-[13px] uppercase text-slate-900">{store.loja}</strong>
                              <span className="inline-flex items-center gap-2 rounded-md bg-orange-50 px-2 py-1 text-[14px] font-black text-orange-700">
                                {formatMoneyShort(totalB)} <GrowthChip pct={calcVariationPct(totalA, totalB)} previous={totalA} current={totalB} />
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
                              {MONTH_LABELS.map((month, index) => {
                                const key = String(index + 1).padStart(2, '0');
                                return (
                                  <div key={month} className="min-w-0 rounded-lg border border-slate-200 p-1.5">
                                    <div className="px-1 pt-0.5 text-[10px] font-black uppercase text-slate-500">{month}</div>
                                    <HeatCell current={store.monthsB[key] || 0} previous={store.monthsA[key] || 0} previousYear={yearA} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {storeVisionData.visibleStores.length > 0 && (
                    <div className="rounded-xl bg-slate-900 p-3 text-white">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[14px] font-black">
                        <span>TOTAL REDE ({storeVisionData.visibleStores.length})</span>
                        <span className="text-[17px] text-orange-300">{formatMoneyShort(storeVisionData.totals.fatB)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
                        {MONTH_LABELS.map((month, index) => {
                          const key = String(index + 1).padStart(2, '0');
                          return (
                            <div key={month} className="rounded-lg border border-slate-700 bg-slate-800 p-1">
                              <div className="px-1 pt-0.5 text-[10px] font-black text-slate-300">{month}</div>
                              <HeatCell current={storeVisionData.totals.monthsB[key] || 0} previous={storeVisionData.totals.monthsA[key] || 0} previousYear={yearA} total dark />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================================================
          ABA 3: COMPARATIVO DE PRODUTOS
         ========================================================================== */}
      {activeTab === 'produtos' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-orange-100 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-xl"><Package size={24} /></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais vendido ({yearB})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductB?.desc}>{topProductB?.desc || 'N/D'}</h3>
                <p className="text-xs text-orange-600 font-bold mt-0.5">{topProductB ? formatMoney(topProductB.totalB) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl"><Package size={24} /></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais vendido ({yearA})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductA?.desc}>{topProductA?.desc || 'N/D'}</h3>
                <p className="text-xs text-slate-600 font-bold mt-0.5">{topProductA ? formatMoney(topProductA.totalA) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp size={60} /></div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl z-10"><ArrowUpRight size={24} /></div>
              <div className="z-10 overflow-hidden">
                <p className="text-[10px] font-black text-emerald-600/70 uppercase tracking-widest truncate">Destaque de crescimento</p>
                <h3 className="text-sm font-black text-emerald-900 mt-1 truncate" title={maxGrowthProduct?.desc}>{maxGrowthProduct?.desc || 'N/D'}</h3>
                <p className="text-xs text-emerald-600 font-bold mt-0.5">
                  {maxGrowthProduct ? `${maxGrowthProduct.crescimentoPct > 0 ? '+' : ''}${maxGrowthProduct.crescimentoPct.toFixed(1)}% vs ano anterior` : '-'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center bg-slate-50 gap-4">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-orange-500" />
                <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Produtos</h3>
              </div>

              <div className="relative w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar modelo..."
                  value={searchProduct}
                  onChange={(e) => setSearchProduct(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-orange-400 transition-colors uppercase shadow-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="sticky top-0 bg-slate-50 shadow-sm z-10 border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">#</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Produto</th>
                    <th className="p-3 text-center border-l border-slate-200 bg-orange-50/60 text-orange-700 text-[10px] font-black uppercase" colSpan={2}>
                      {yearB}
                    </th>
                    <th className="p-3 text-center border-l border-slate-200 bg-slate-100/70 text-slate-700 text-[10px] font-black uppercase" colSpan={2}>
                      {yearA}
                    </th>
                    <th className="p-3 text-right border-l border-slate-200 text-[9px] font-black text-slate-400 uppercase">
                      Crescimento
                    </th>
                  </tr>
                  <tr className="text-[9px] font-black text-slate-400 uppercase tracking-wider bg-white">
                    <th></th>
                    <th></th>
                    <th className="p-2 text-center border-l border-slate-100">Qtd</th>
                    <th className="p-2 text-right border-r border-slate-100">Valor (R$)</th>
                    <th className="p-2 text-center">Qtd</th>
                    <th className="p-2 text-right border-r border-slate-100">Valor (R$)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="text-xs font-bold text-slate-700 divide-y divide-slate-50">
                  {searchedProducts.map((p, i) => {
                    const isPositive = p.crescimentoPct > 0;
                    const isNegative = p.crescimentoPct < 0;
                    const isNeutral = p.crescimentoPct === 0;

                    return (
                      <tr key={`${p.desc}-${i}`} className="hover:bg-orange-50/30 transition-colors group">
                        <td className="p-3 text-center">
                          <span className={`w-5 h-5 flex items-center justify-center rounded mx-auto text-[9px] ${i < 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="p-3 uppercase text-[10px] max-w-[200px] truncate" title={p.desc}>{p.desc}</td>
                        <td className="p-3 text-center border-l border-slate-50 text-slate-600 bg-orange-50/20 group-hover:bg-orange-50/50 transition-colors">{p.qtdB}</td>
                        <td className="p-3 text-right font-mono text-orange-700 font-black bg-orange-50/20 group-hover:bg-orange-50/50 transition-colors">{formatMoney(p.totalB)}</td>
                        <td className="p-3 text-center border-l border-slate-50 text-slate-500 bg-slate-50/50 group-hover:bg-slate-100/60 transition-colors">{p.qtdA}</td>
                        <td className="p-3 text-right font-mono text-slate-700 bg-slate-50/50 group-hover:bg-slate-100/60 transition-colors">{formatMoney(p.totalA)}</td>
                        <td className="p-3 text-right border-l border-slate-50">
                          <div className="flex justify-end">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black ${
                              isPositive ? 'bg-emerald-100 text-emerald-700' :
                              isNegative ? 'bg-red-100 text-red-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {isPositive && <ArrowUpRight size={12} />}
                              {isNegative && <ArrowDownRight size={12} />}
                              {isNeutral && <Minus size={12} />}
                              {isFinite(p.crescimentoPct) ? `${p.crescimentoPct > 0 ? '+' : ''}${p.crescimentoPct.toFixed(1)}%` : 'NOVO'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {searchedProducts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 text-sm font-bold">
                        Nenhum produto encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}