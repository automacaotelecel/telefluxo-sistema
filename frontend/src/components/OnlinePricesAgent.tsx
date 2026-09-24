import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';

const RENDER_API_URL = 'https://telefluxo-aplicacao.onrender.com';
const SOURCE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/16CRVacxj0DeV8VLEL4toDE7eA85kI_BIrifh50DwTbw/edit?gid=0#gid=0';

function getApiUrl() {
  const envUrl = String(
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    '',
  ).trim();

  if (envUrl) return envUrl.replace(/\/$/, '');
  if (typeof window === 'undefined') return RENDER_API_URL;

  const hostname = window.location.hostname;
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.endsWith('.local');

  return isLocal ? `http://${hostname}:3000` : RENDER_API_URL;
}

const API_URL = getApiUrl();

type OnlineSheetPayload = {
  name: string;
  rows: any[][];
};

type OnlineSheetResponse = {
  ok: boolean;
  sourceUrl: string;
  generatedAt: string;
  sheets: OnlineSheetPayload[];
};

export type OnlineComparativoModel = {
  descricao?: string;
  referencia?: string;
  basicModel?: string;
  modeloPdf?: string;
  precoTelecel?: number;
  hasOferta?: boolean;
  rowKey?: string;
};

type Props = {
  currentUser?: any;
  comparativoModels?: OnlineComparativoModel[];
  embedded?: boolean;
};

type PreparedModel = OnlineComparativoModel & {
  aliases: string[];
};

type StorePriceGroup = {
  key: string;
  name: string;
  cashIndex: number;
  installmentsIndex: number | null;
};

type PreparedOnlineRow = {
  raw: any[];
  matchedModel: PreparedModel | null;
};

const normalizeText = (value: any) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\u00A0/g, ' ')
    .replace(/[‐‑–—−]/g, '-')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCompact = (value: any) =>
  normalizeText(value).replace(/\s+/g, '');

const modelWithoutColor = (value: any) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const match = text.match(/^(.*?\b\d+(?:[.,]\d+)?\s*(?:GB|TB)\b)/i);
  return match?.[1]?.trim() || text;
};

const removeConnectivity = (value: string) =>
  value
    .replace(/\b(?:4G|5G|LTE|WI\s*FI|WIFI)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildModelAliases = (model: OnlineComparativoModel) => {
  const values = [
    model.descricao,
    model.referencia,
    model.basicModel,
    model.modeloPdf,
    modelWithoutColor(model.descricao),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const aliases = new Set<string>();

  values.forEach((value) => {
    const variants = [
      value,
      modelWithoutColor(value),
      removeConnectivity(modelWithoutColor(value)),
      modelWithoutColor(value).replace(/^GALAXY\s+/i, ''),
      removeConnectivity(modelWithoutColor(value).replace(/^GALAXY\s+/i, '')),
    ];

    variants.forEach((variant) => {
      const normalized = normalizeCompact(variant);
      if (normalized.length >= 4) aliases.add(normalized);
    });
  });

  // O alias mais específico é testado primeiro. Isso evita que, por exemplo,
  // S26 256GB ganhe prioridade sobre S26 ULTRA 256GB.
  return Array.from(aliases).sort((a, b) => b.length - a.length);
};

const hasMeaningfulCells = (row: any[]) =>
  (row || []).some((cell) => String(cell ?? '').trim() !== '');

const detectHeaderIndex = (rows: any[][]) => {
  const headerKeywords = [
    'MODELO',
    'MODEL',
    'PRODUTO',
    'DESCRICAO',
    'DESCRIÇÃO',
    'SKU',
    'LOJA',
    'PRECO',
    'PREÇO',
    'POSITION',
    'POSICAO',
    'POSIÇÃO',
  ];

  const candidate = rows.findIndex((row) => {
    const cells = (row || []).map((cell) => normalizeText(cell)).filter(Boolean);
    if (cells.length < 2) return false;
    return cells.some((cell) =>
      headerKeywords.some((keyword) => cell.includes(normalizeText(keyword))),
    );
  });

  if (candidate >= 0) return candidate;
  return Math.max(0, rows.findIndex((row) => hasMeaningfulCells(row)));
};

const findHeaderIndex = (headers: any[], candidates: string[]) => {
  const normalizedCandidates = candidates.map(normalizeText);
  return headers.findIndex((header) => {
    const normalized = normalizeText(header);
    return normalizedCandidates.some(
      (candidate) =>
        normalized === candidate ||
        normalized.startsWith(`${candidate} `) ||
        normalized.includes(candidate),
    );
  });
};

const cleanStoreName = (value: any) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'LOJA';

  return raw
    .replace(/\s+(?:A|À)\s+VISTA\s*$/i, '')
    .replace(/\s+AVISTA\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const isCashHeader = (value: any) => {
  const normalized = normalizeText(value);
  return /(?:^|\s)A VISTA$/.test(normalized) || /(?:^|\s)AVISTA$/.test(normalized);
};

const isInstallmentHeader = (value: any) => {
  const normalized = normalizeText(value);
  return /^12X(?:\s+\d+)?$/.test(normalized) || normalized.includes('12X');
};

const buildStoreGroups = (headers: any[]) => {
  const groups: StorePriceGroup[] = [];
  const used = new Set<number>();

  headers.forEach((header, index) => {
    if (!isCashHeader(header) || used.has(index)) return;

    const nextIndex = index + 1;
    const hasInstallments =
      nextIndex < headers.length && isInstallmentHeader(headers[nextIndex]);

    groups.push({
      key: `${normalizeCompact(cleanStoreName(header)) || 'LOJA'}-${index}`,
      name: cleanStoreName(header),
      cashIndex: index,
      installmentsIndex: hasInstallments ? nextIndex : null,
    });

    used.add(index);
    if (hasInstallments) used.add(nextIndex);
  });

  return groups;
};

const parseCurrencyValue = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  let raw = String(value)
    .replace(/\u00A0/g, ' ')
    .replace(/R\$/gi, '')
    .trim();

  if (!raw || raw === '-' || raw === '—') return null;

  raw = raw.replace(/\s/g, '');

  // Formato brasileiro: 3.999,90
  if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else {
    // O Sheets também pode entregar 3999.9 em formato internacional.
    raw = raw.replace(/[^0-9.-]/g, '');
  }

  const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatMoney = (value: any) => {
  const parsed = parseCurrencyValue(value);
  if (parsed === null) return '—';

  return parsed.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const findMatchedModel = (
  row: any[],
  modelColumnIndex: number,
  models: PreparedModel[],
): PreparedModel | null => {
  if (!models.length) return null;

  const modelCell =
    modelColumnIndex >= 0
      ? normalizeCompact(row?.[modelColumnIndex] ?? '')
      : '';
  const fullRow = normalizeCompact((row || []).join(' '));

  // Primeiro tenta apenas a célula MODELO, que é a comparação mais segura.
  for (const model of models) {
    if (
      model.aliases.some(
        (alias) =>
          modelCell &&
          (modelCell.includes(alias) ||
            (alias.length >= 8 && alias.includes(modelCell))),
      )
    ) {
      return model;
    }
  }

  // Fallback para referências / basic models que possam estar em outra coluna.
  for (const model of models) {
    if (model.aliases.some((alias) => fullRow.includes(alias))) {
      return model;
    }
  }

  return null;
};

const getCheapestKeys = (
  row: PreparedOnlineRow,
  storeGroups: StorePriceGroup[],
) => {
  const marketPrices = storeGroups
    .map((group) => ({
      key: group.key,
      value:
        group.installmentsIndex === null
          ? null
          : parseCurrencyValue(row.raw?.[group.installmentsIndex]),
    }))
    .filter((item): item is { key: string; value: number } => item.value !== null);

  // Só destacamos um vencedor quando existe pelo menos um preço 12x do mercado.
  if (!marketPrices.length) return new Set<string>();

  const telecel = parseCurrencyValue(row.matchedModel?.precoTelecel);
  const candidates = [
    ...marketPrices,
    ...(telecel !== null ? [{ key: 'TELECEL', value: telecel }] : []),
  ];

  const minimum = Math.min(...candidates.map((item) => item.value));
  const epsilon = 0.005;

  return new Set(
    candidates
      .filter((item) => Math.abs(item.value - minimum) <= epsilon)
      .map((item) => item.key),
  );
};

export default function OnlinePricesAgent({
  comparativoModels = [],
  embedded = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<OnlineSheetResponse | null>(null);
  const [activeSheet, setActiveSheet] = useState('ONLINE APARELHOS');
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = async (force = false) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${API_URL}/api/comparativos/online-sheet${force ? '?refresh=1' : ''}`,
        { cache: 'no-store' },
      );

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            'Não foi possível carregar a base ONLINE do Google Sheets.',
        );
      }

      const nextData = json as OnlineSheetResponse;
      setData(nextData);

      if (
        nextData.sheets.length &&
        !nextData.sheets.some((sheet) => sheet.name === activeSheet)
      ) {
        setActiveSheet(nextData.sheets[0].name);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar a base ONLINE.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preparedModels = useMemo<PreparedModel[]>(
    () =>
      comparativoModels.map((model) => ({
        ...model,
        aliases: buildModelAliases(model),
      })),
    [comparativoModels],
  );

  const preparedSheets = useMemo(() => {
    return (data?.sheets || []).map((sheet) => {
      const rawRows = Array.isArray(sheet.rows)
        ? sheet.rows.filter(hasMeaningfulCells)
        : [];
      const columnCount = rawRows.reduce(
        (max, row) => Math.max(max, row?.length || 0),
        0,
      );
      const headerIndex = detectHeaderIndex(rawRows);
      const headerRow = rawRows[headerIndex] || [];
      const headers = Array.from(
        { length: columnCount },
        (_, index) => String(headerRow?.[index] ?? '').trim(),
      );
      const prefixRows = rawRows.slice(0, headerIndex);
      const bodyRows = rawRows.slice(headerIndex + 1);

      const positionIndex = findHeaderIndex(headers, [
        'POSITION',
        'POSIÇÃO',
        'POSICAO',
      ]);
      const modelIndex = findHeaderIndex(headers, [
        'MODELO',
        'MODEL',
        'PRODUTO',
        'DESCRIÇÃO',
        'DESCRICAO',
      ]);
      const storeGroups = buildStoreGroups(headers);

      const modelFilteredRows: PreparedOnlineRow[] = preparedModels.length
        ? bodyRows
            .map((row) => ({
              raw: row,
              matchedModel: findMatchedModel(row, modelIndex, preparedModels),
            }))
            .filter((row) => Boolean(row.matchedModel))
        : bodyRows.map((row) => ({ raw: row, matchedModel: null }));

      const term = normalizeCompact(searchTerm);
      const searchedRows = term
        ? modelFilteredRows.filter((row) => {
            const telecelText = row.matchedModel?.precoTelecel
              ? String(row.matchedModel.precoTelecel)
              : '';
            return normalizeCompact(`${row.raw.join(' ')} ${telecelText}`).includes(
              term,
            );
          })
        : modelFilteredRows;

      return {
        ...sheet,
        headers,
        prefixRows,
        rows: searchedRows,
        totalRows: bodyRows.length,
        matchedRows: modelFilteredRows.length,
        columnCount,
        positionIndex,
        modelIndex,
        storeGroups,
      };
    });
  }, [data, preparedModels, searchTerm]);

  const selectedSheet =
    preparedSheets.find((sheet) => sheet.name === activeSheet) ||
    preparedSheets[0] ||
    null;

  return (
    <div className={embedded ? 'w-full' : 'min-h-full bg-slate-50 p-3 md:p-5'}>
      <div className={embedded ? 'space-y-3' : 'mx-auto max-w-[1800px] space-y-4'}>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={17} className="text-orange-600" />
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
                  Online
                </h2>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {preparedModels.length
                  ? `Cartas + Sem ofertas: ${preparedModels.length} modelo(s) considerados. O Preço Telecel acompanha o comparativo em tempo real.`
                  : 'Nenhum comparativo está filtrando a base. Exibindo a planilha ONLINE completa.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1 xl:w-[360px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar dentro do online"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-semibold outline-none focus:border-orange-400"
                />
              </div>

              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={loading ? 'animate-spin' : ''}
                />
                Atualizar
              </button>

              <a
                href={data?.sourceUrl || SOURCE_SHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2 text-[10px] font-black uppercase text-white shadow-sm hover:bg-orange-700"
              >
                <ExternalLink size={13} />
                Abrir Sheets
              </a>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-black uppercase">Erro ao carregar Online</p>
              <p className="mt-1 text-xs font-semibold">{error}</p>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 text-sm font-black text-slate-600">
              <Loader2 size={20} className="animate-spin text-orange-600" />
              Carregando Google Sheets...
            </div>
          </div>
        )}

        {data && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              {preparedSheets.map((sheet) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheet(sheet.name)}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wide transition ${
                    selectedSheet?.name === sheet.name
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {sheet.name} ({sheet.rows.length})
                </button>
              ))}
            </div>

            {selectedSheet && (
              <>
                {selectedSheet.prefixRows.length > 0 && (
                  <div className="space-y-1 border-b border-slate-100 bg-white px-4 py-3">
                    {selectedSheet.prefixRows.map((row, rowIndex) => (
                      <div
                        key={`prefix-${rowIndex}`}
                        className="text-xs font-bold text-slate-600"
                      >
                        {(row || [])
                          .filter((cell) => String(cell ?? '').trim())
                          .join(' · ')}
                      </div>
                    ))}
                  </div>
                )}

                <div className="max-h-[68vh] overflow-auto">
                  {selectedSheet.storeGroups.length > 0 ? (
                    <table className="w-full min-w-max border-separate border-spacing-0 text-left text-[11px]">
                      <thead className="sticky top-0 z-20 bg-slate-100">
                        <tr>
                          {selectedSheet.positionIndex >= 0 && (
                            <th
                              rowSpan={2}
                              className="min-w-[76px] whitespace-nowrap border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-600"
                            >
                              Position
                            </th>
                          )}

                          <th
                            rowSpan={2}
                            className="min-w-[220px] whitespace-nowrap border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-600"
                          >
                            Modelo
                          </th>

                          <th
                            rowSpan={2}
                            className="min-w-[130px] whitespace-nowrap border-b border-r border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-wide text-emerald-800"
                          >
                            Preço Telecel
                          </th>

                          {selectedSheet.storeGroups.map((group) => (
                            <th
                              key={`store-${group.key}`}
                              colSpan={2}
                              className="whitespace-nowrap border-b border-r border-slate-300 bg-slate-200 px-3 py-2 text-center text-[10px] font-black uppercase tracking-wide text-slate-800"
                            >
                              {group.name}
                            </th>
                          ))}
                        </tr>

                        <tr>
                          {selectedSheet.storeGroups.map((group) => (
                            <>
                              <th
                                key={`cash-${group.key}`}
                                className="min-w-[116px] whitespace-nowrap border-b border-r border-slate-200 bg-slate-100 px-3 py-1.5 text-center text-[9px] font-black uppercase tracking-wide text-slate-500"
                              >
                                À vista
                              </th>
                              <th
                                key={`installments-${group.key}`}
                                className="min-w-[116px] whitespace-nowrap border-b border-r border-slate-300 bg-slate-100 px-3 py-1.5 text-center text-[9px] font-black uppercase tracking-wide text-slate-700"
                              >
                                12x
                              </th>
                            </>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {selectedSheet.rows.map((preparedRow, rowIndex) => {
                          const cheapest = getCheapestKeys(
                            preparedRow,
                            selectedSheet.storeGroups,
                          );
                          const telecelIsCheapest = cheapest.has('TELECEL');
                          const positionValue =
                            selectedSheet.positionIndex >= 0
                              ? preparedRow.raw?.[selectedSheet.positionIndex]
                              : rowIndex + 1;
                          const modelValue =
                            selectedSheet.modelIndex >= 0
                              ? preparedRow.raw?.[selectedSheet.modelIndex]
                              : preparedRow.matchedModel?.descricao || '—';

                          return (
                            <tr
                              key={`${selectedSheet.name}-${rowIndex}-${String(modelValue)}`}
                              className={
                                rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                              }
                            >
                              {selectedSheet.positionIndex >= 0 && (
                                <td className="whitespace-nowrap border-b border-r border-slate-100 px-3 py-2 text-center font-bold text-slate-500">
                                  {String(positionValue ?? '') || '—'}
                                </td>
                              )}

                              <td className="whitespace-nowrap border-b border-r border-slate-100 px-3 py-2 font-black text-slate-800">
                                {String(modelValue ?? '') || '—'}
                              </td>

                              <td
                                className={`whitespace-nowrap border-b border-r px-3 py-2 text-right font-black ${
                                  telecelIsCheapest
                                    ? 'border-emerald-300 bg-emerald-200 text-emerald-950'
                                    : 'border-emerald-100 bg-emerald-50 text-emerald-800'
                                }`}
                                title={
                                  telecelIsCheapest
                                    ? 'Telecel é o menor preço considerando o comparativo 12x'
                                    : 'Preço promocional atual do comparativo TeleFluxo'
                                }
                              >
                                {formatMoney(preparedRow.matchedModel?.precoTelecel)}
                              </td>

                              {selectedSheet.storeGroups.map((group) => {
                                const isCheapest = cheapest.has(group.key);
                                const winningClass = isCheapest
                                  ? 'bg-emerald-200 text-emerald-950 border-emerald-300'
                                  : 'border-slate-100 text-slate-700';

                                return (
                                  <>
                                    <td
                                      key={`cash-cell-${group.key}`}
                                      className={`whitespace-nowrap border-b border-r px-3 py-2 text-right font-semibold ${winningClass}`}
                                    >
                                      {formatMoney(
                                        preparedRow.raw?.[group.cashIndex],
                                      )}
                                    </td>
                                    <td
                                      key={`installments-cell-${group.key}`}
                                      className={`whitespace-nowrap border-b border-r px-3 py-2 text-right font-black ${winningClass}`}
                                      title={
                                        isCheapest
                                          ? 'Menor preço 12x deste modelo'
                                          : undefined
                                      }
                                    >
                                      {group.installmentsIndex === null
                                        ? '—'
                                        : formatMoney(
                                            preparedRow.raw?.[
                                              group.installmentsIndex
                                            ],
                                          )}
                                    </td>
                                  </>
                                );
                              })}
                            </tr>
                          );
                        })}

                        {selectedSheet.rows.length === 0 && (
                          <tr>
                            <td
                              colSpan={
                                2 +
                                (selectedSheet.positionIndex >= 0 ? 1 : 0) +
                                selectedSheet.storeGroups.length * 2
                              }
                              className="px-4 py-16 text-center text-sm font-semibold text-slate-400"
                            >
                              {preparedModels.length
                                ? 'Nenhum item dessa aba corresponde aos modelos das cartas + Sem ofertas.'
                                : 'Nenhum registro encontrado nessa aba.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
                      <thead className="sticky top-0 z-20 bg-slate-100">
                        <tr>
                          {selectedSheet.headers.map((header, index) => (
                            <th
                              key={`${header}-${index}`}
                              className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-600 last:border-r-0"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSheet.rows.map((preparedRow, rowIndex) => (
                          <tr
                            key={`${selectedSheet.name}-${rowIndex}`}
                            className={
                              rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                            }
                          >
                            {selectedSheet.headers.map((_, columnIndex) => (
                              <td
                                key={`${rowIndex}-${columnIndex}`}
                                className="whitespace-nowrap border-b border-r border-slate-100 px-3 py-2 font-semibold text-slate-700 last:border-r-0"
                              >
                                {String(preparedRow.raw?.[columnIndex] ?? '') || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-bold text-slate-500">
                  <span>
                    Exibidos:{' '}
                    <strong className="text-slate-800">
                      {selectedSheet.rows.length}
                    </strong>
                    {preparedModels.length
                      ? ` de ${selectedSheet.totalRows} linhas da aba · ${preparedModels.length} modelo(s) considerados`
                      : ' registros'}
                  </span>
                  <span>
                    Verde = menor preço considerando somente 12x · Fonte:{' '}
                    {selectedSheet.name}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
