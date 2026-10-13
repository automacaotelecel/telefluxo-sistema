import React, { useMemo, useRef, useState } from 'react';

// Visual e controles equivalentes ao Montar Comparativo.
// Os dados são os valores persistidos no envio, não uma nova consulta ao estoque.
export type MarketSnapshot = {
  storeName?: string;
  marketStoreName?: string;
  marketPrice?: number | null;
  differenceToTelecel?: number | null;
};

type ColumnKey =
  | 'descricao' | 'precoSamsung' | 'precoTelecel'
  | 'totalDescontoTelecel' | 'descontoRebate' | 'descontoTradeIn'
  | 'descontoBogo' | 'descontoSip' | 'descontoGeral' | 'discountsCollapsed'
  | 'totalDesconto' | 'precoPromocional' | 'qtdEstoque' | 'custoMedioEstoque'
  | 'margemEstoque' | 'novoCustoMedio' | 'margemPrice' | 'qtdVendida'
  | 'priceRebate' | 'priceTradeIn' | 'priceBogo' | 'priceSip' | 'pricesCollapsed'
  | 'ofertaAtual' | 'status' | 'offerCollapsed' | 'online';

const baseWidths: Record<ColumnKey, number> = {
  descricao: 245, precoSamsung: 96, precoTelecel: 96,
  totalDescontoTelecel: 110, descontoRebate: 100, descontoTradeIn: 105,
  descontoBogo: 95, descontoSip: 92, descontoGeral: 105, discountsCollapsed: 62,
  totalDesconto: 105, precoPromocional: 118, qtdEstoque: 68, custoMedioEstoque: 105,
  margemEstoque: 88, novoCustoMedio: 110, margemPrice: 92, qtdVendida: 72,
  priceRebate: 95, priceTradeIn: 102, priceBogo: 96, priceSip: 88,
  pricesCollapsed: 58, ofertaAtual: 104, status: 88, offerCollapsed: 58, online: 140,
};
const discountFields = [
  { key: 'totalDescontoTelecel', label: 'Desc. Telecel' },
  { key: 'descontoRebate', label: 'Desc. Rebate' },
  { key: 'descontoTradeIn', label: 'Desc. Trade In' },
  { key: 'descontoBogo', label: 'Desc. Bogo' },
  { key: 'descontoSip', label: 'Desc. SIP' },
  { key: 'descontoGeral', label: 'Descontos Gerais' },
] as const;
const priceFields = ['priceRebate', 'priceTradeIn', 'priceBogo', 'priceSip'] as const;
const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : `${(Number(n) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const signed = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' :
    `${n > 0.005 ? '+ ' : n < -0.005 ? '− ' : ''}${money(Math.abs(n))}`;

export type AnalysisDisplayRow = {
  rowKey?: string;
  descricao: string;
  referencia?: string;
  precoSamsung: number;
  precoTelecel: number;
  totalDescontoTelecel: number;
  descontoRebate: number;
  descontoTradeIn: number;
  descontoBogo: number;
  descontoSip: number;
  descontoGeral: number;
  totalDesconto: number;
  precoPromocional: number;
  qtdEstoque: number;
  custoMedioEstoque: number;
  margemEstoque: number | null;
  novoCustoMedio: number | null;
  margemPrice: number | null;
  qtdVendida: number;
  priceRebate: number;
  priceTradeIn: number;
  priceBogo: number;
  priceSip: number;
  ofertaAtual: number;
  status: string;
  descTelecelInput?: string;
};

// Identificador do modelo revisado, independentemente da aba Com/Sem Ofertas.
export const analysisReviewKey = (row: Pick<AnalysisDisplayRow, 'descricao' | 'referencia'>): string =>
  `${String(row.referencia || '').trim().toUpperCase()}|${String(row.descricao || '').trim().toUpperCase()}`;

type Props = {
  rows: AnalysisDisplayRow[];
  editable: boolean;
  online: Record<string, MarketSnapshot>;
  reviewedKeys: ReadonlySet<string>;
  onToggleReviewed: (row: AnalysisDisplayRow) => void;
  onEditTelecel: (row: AnalysisDisplayRow, value: string) => void;
  onBlurTelecel: (row: AnalysisDisplayRow) => void;
};

export default function FluxoComparativoTabela({ rows, editable, online, reviewedKeys, onToggleReviewed, onEditTelecel, onBlurTelecel }: Props) {
  const [discountOpen, setDiscountOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [visibleDiscounts, setVisibleDiscounts] = useState<string[]>(discountFields.map(f => f.key));
  const [widths, setWidths] = useState<Record<string, number>>(baseWidths);
  const [height, setHeight] = useState(440);
  const viewport = useRef<HTMLDivElement>(null);
  const topScroll = useRef<HTMLDivElement>(null);

  const keys = useMemo<ColumnKey[]>(() => [
    'descricao', 'precoSamsung', 'precoTelecel',
    ...(discountOpen && visibleDiscounts.length ? visibleDiscounts as ColumnKey[] : ['discountsCollapsed'] as ColumnKey[]),
    'totalDesconto', 'precoPromocional', 'qtdEstoque', 'custoMedioEstoque', 'margemEstoque',
    'novoCustoMedio', 'margemPrice', 'qtdVendida',
    ...(priceOpen ? [...priceFields] : ['pricesCollapsed'] as ColumnKey[]),
    ...(offerOpen ? ['ofertaAtual', 'status'] as ColumnKey[] : ['offerCollapsed'] as ColumnKey[]),
    'online',
  ], [discountOpen, visibleDiscounts, priceOpen, offerOpen]);
  const widthsFor = (key: ColumnKey) => {
    const width = widths[key] ?? baseWidths[key];
    return { width, minWidth: width, maxWidth: width };
  };
  const totalWidth = keys.reduce((sum, key) => sum + (widths[key] ?? baseWidths[key]), 0);
  const resizeColumn = (key: ColumnKey, event: React.MouseEvent) => {
    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = widths[key] ?? baseWidths[key];
    const move = (e: MouseEvent) => {
      setWidths(v => ({ ...v, [key]: Math.min(560, Math.max(55, initialWidth + e.clientX - initialX)) }));
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  };
  const groupToggle = (name: string, open: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} className="rounded-md border border-sky-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-sky-700 hover:bg-sky-50">
      {open ? '−' : '+'} {name}
    </button>
  );
  const group = (span: number, className: string, children: React.ReactNode) => (
    <th colSpan={span} className={`border-b border-r border-[#9fb3c8] px-1.5 py-1 text-center text-[9px] font-black uppercase tracking-wider ${className}`}>
      {children}
    </th>
  );
  const labels: Record<ColumnKey, string> = {
    descricao: 'Descrição', precoSamsung: 'Preço Samsung', precoTelecel: 'Preço Telecel',
    totalDescontoTelecel: 'Desc. Telecel', descontoRebate: 'Desc. Rebate', descontoTradeIn: 'Desc. Trade In',
    descontoBogo: 'Desc. Bogo', descontoSip: 'Desc. SIP', descontoGeral: 'Descontos Gerais',
    discountsCollapsed: '+', totalDesconto: 'Total Desconto', precoPromocional: 'Preço Final',
    qtdEstoque: 'Qtd. Est.', custoMedioEstoque: 'Custo Médio', margemEstoque: 'Margem Est.',
    novoCustoMedio: 'Novo Custo Médio', margemPrice: 'Margem Price', qtdVendida: 'Qtd. Vend.',
    priceRebate: 'Price Rebate', priceTradeIn: 'Price Trade In', priceBogo: 'Price Bogo',
    priceSip: 'Price SIP', pricesCollapsed: '+', ofertaAtual: 'Oferta Atual', status: 'Status',
    offerCollapsed: '+', online: 'Diferença p/ mais barata',
  };
  const headers = (key: ColumnKey) => {
    const className = key === 'precoPromocional' ? 'bg-emerald-200 text-emerald-950' :
      key === 'totalDesconto' || key === 'online' ? 'bg-[#fff2cc] text-[#7f6000]' :
      key === 'precoTelecel' || key === 'totalDescontoTelecel' ? 'bg-[#edffed] text-emerald-800' :
      key.startsWith('desconto') || key === 'discountsCollapsed' ? 'bg-[#dff1ff] text-sky-800' :
      key.startsWith('price') || key === 'pricesCollapsed' ? 'bg-[#e2f0d9] text-emerald-800' :
      key === 'ofertaAtual' || key === 'status' || key === 'offerCollapsed' ? 'bg-[#92d050] text-slate-800' :
      'bg-white text-slate-600';
    return (
      <th key={key} style={widthsFor(key)} className={`relative border-b border-r border-[#9fb3c8] px-1.5 py-1 text-center text-[9px] font-black uppercase leading-tight ${className} ${key === 'descricao' ? 'sticky left-0 z-30 shadow-[1px_0_0_#94a3b8]' : ''}`}>
        <div className="truncate pr-2" title={labels[key]}>{labels[key]}</div>
        <div role="separator" aria-orientation="vertical" title="Arraste para ajustar a largura" onMouseDown={(event) => resizeColumn(key, event)} className="absolute inset-y-0 right-0 z-40 w-2 cursor-col-resize hover:bg-slate-400/30" />
      </th>
    );
  };
  const cell = (key: ColumnKey, row: AnalysisDisplayRow, reviewed: boolean) => {
    const market = row.rowKey ? online[row.rowKey] : undefined;
    // Cotação da planilha ONLINE atual, atualizada pelo mesmo componente da montagem.
    const onlineDifference = market?.marketPrice !== null && market?.marketPrice !== undefined
      ? market.marketPrice - row.precoPromocional
      : market?.differenceToTelecel ?? null;
    const numberFields: ColumnKey[] = ['precoSamsung', 'precoTelecel', 'totalDescontoTelecel', 'descontoRebate', 'descontoTradeIn', 'descontoBogo', 'descontoSip', 'descontoGeral', 'totalDesconto', 'precoPromocional', 'custoMedioEstoque', 'novoCustoMedio', 'priceRebate', 'priceTradeIn', 'priceBogo', 'priceSip', 'ofertaAtual'];
    const value = row[key as keyof AnalysisDisplayRow];
    // Prioridade visual da Margem Price: vermelho <25%, verde discreto >40%.
    // Valores negativos permanecem negativos (inclusive com fundo vermelho).
    const marginPriceTone = key === 'margemPrice' && typeof row.margemPrice === 'number' && Number.isFinite(row.margemPrice)
      ? row.margemPrice < 0.25
        ? 'bg-red-500 text-white font-black'
        : row.margemPrice > 0.40
          ? 'bg-emerald-100 text-emerald-900 font-black'
          : 'bg-white text-slate-700 font-black'
      : null;
    const bg = marginPriceTone || (key === 'precoPromocional' ? 'bg-emerald-100 text-[#005e36] font-black' :
      key === 'totalDesconto' ? 'bg-[#fff2cc] font-black' :
      key === 'totalDescontoTelecel' ? 'bg-[#edffed]' :
      key.startsWith('desconto') || key === 'discountsCollapsed' ? 'bg-[#dff1ff]' :
      key.startsWith('price') || key === 'pricesCollapsed' ? 'bg-[#edf7e8]' :
      key === 'ofertaAtual' || key === 'status' || key === 'offerCollapsed' ? 'bg-[#e2f0d9]' :
      key === 'online' ? (onlineDifference == null ? 'bg-slate-50 text-slate-400' : onlineDifference > 0.005 ? 'bg-emerald-100 text-emerald-800 font-black' : onlineDifference < -0.005 ? 'bg-red-100 text-red-700 font-black' : 'bg-slate-100') :
      'bg-white');
    let contents: React.ReactNode;
    if (key === 'descricao') contents = (
      <label className="flex min-w-0 cursor-pointer items-center gap-2" title={reviewed ? 'Marcar como não revisado' : 'Marcar modelo como revisado'}>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={() => onToggleReviewed(row)}
          aria-label={`${reviewed ? 'Desmarcar' : 'Marcar'} ${row.descricao} como revisado`}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-orange-600"
        />
        <span className={`block min-w-0 truncate font-black uppercase ${reviewed ? 'text-orange-900' : 'text-slate-900'}`} title={row.descricao}>
          {row.descricao}
        </span>
      </label>
    );
    else if (key === 'online') contents = <span title={market?.marketStoreName || 'Sem cotação disponível na planilha ONLINE atual'}>{signed(onlineDifference)}</span>;
    else if (key === 'totalDescontoTelecel' && editable) contents = (
      <div className="flex items-center gap-1 rounded border border-orange-200 bg-white px-1">
        <span className="text-[9px] font-black text-orange-600">R$</span>
        <input inputMode="decimal" type="text" value={row.descTelecelInput ?? String(row.totalDescontoTelecel).replace('.', ',')} onChange={(event) => onEditTelecel(row, event.target.value)} onBlur={() => onBlurTelecel(row)} className="min-w-0 w-full py-0.5 text-right text-[10px] font-black text-orange-700 outline-none" />
      </div>
    );
    else if (key === 'margemEstoque' || key === 'margemPrice') contents = pct(value as number | null);
    else if (key === 'qtdEstoque' || key === 'qtdVendida') contents = Number(value || 0).toLocaleString('pt-BR');
    else if (numberFields.includes(key)) contents = money(value as number | null);
    else if (key === 'status') contents = String(value || '—');
    else if (key === 'discountsCollapsed') contents = <button type="button" onClick={() => setDiscountOpen(true)} className="rounded-full bg-white px-2 font-black text-sky-700">+</button>;
    else if (key === 'pricesCollapsed') contents = <button type="button" onClick={() => setPriceOpen(true)} className="rounded-full bg-white px-2 font-black text-emerald-700">+</button>;
    else if (key === 'offerCollapsed') contents = <button type="button" onClick={() => setOfferOpen(true)} className="rounded-full bg-white px-2 font-black text-emerald-700">+</button>;
    else contents = '—';
    return (
      <td
        key={key}
        style={{
          ...widthsFor(key),
          // Tom sutil em toda a linha, preservando as cores da tabela e as margens de risco.
          ...(reviewed && key !== 'margemPrice' ? { backgroundImage: 'linear-gradient(rgba(251,191,36,0.25), rgba(251,191,36,0.25))' } : {}),
        }}
        className={`overflow-hidden border-b border-r border-[#b7c3cf] px-1.5 py-1 text-right text-[10px] leading-tight ${bg} ${reviewed ? 'border-b-orange-200' : ''} ${key === 'descricao' ? `sticky left-0 z-20 text-left shadow-[1px_0_0_#94a3b8] ${reviewed ? 'border-l-[3px] border-l-orange-500' : ''}` : ''}`}
      >
        {contents}
      </td>
    );
  };
  const syncScroll = (source: 'top' | 'body') => {
    if (!viewport.current || !topScroll.current) return;
    if (source === 'body') topScroll.current.scrollLeft = viewport.current.scrollLeft;
    else viewport.current.scrollLeft = topScroll.current.scrollLeft;
  };
  const startHeightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const y = e.clientY;
    const current = height;
    const move = (ev: MouseEvent) => setHeight(Math.max(220, Math.min(800, current + ev.clientY - y)));
    const end = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end); document.body.style.userSelect = ''; };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div ref={topScroll} onScroll={() => syncScroll('top')} className="h-4 overflow-x-auto overflow-y-hidden bg-slate-100"><div style={{ width: totalWidth }} className="h-1" /></div>
      <div ref={viewport} onScroll={() => syncScroll('body')} className="w-full overflow-auto" style={{ height, maxHeight: '72vh' }}>
        <table style={{ width: totalWidth, minWidth: totalWidth }} className="table-fixed border-separate border-spacing-0 border-l border-t border-[#9fb3c8] bg-white">
          <colgroup>{keys.map(k => <col key={k} style={widthsFor(k)} />)}</colgroup>
          <thead className="sticky top-0 z-30 bg-white">
            <tr>
              {group(1, 'sticky left-0 z-40 bg-white text-[#003366]', 'Produto')}
              {group(2, 'bg-white text-[#003366]', 'Preços')}
              {group(discountOpen ? visibleDiscounts.length : 1, 'bg-[#dff1ff] text-[#003366]',
                <div className="flex flex-col items-center gap-1">
                  {groupToggle('Descontos', discountOpen, () => setDiscountOpen(!discountOpen))}
                  {discountOpen && <div className="flex flex-wrap justify-center gap-1">{discountFields.map(f =>
                    <button key={f.key} type="button" onClick={() => setVisibleDiscounts(v => v.includes(f.key) ? (v.length > 1 ? v.filter(x => x !== f.key) : v) : [...v, f.key])} className={`rounded-full border px-1.5 text-[8px] font-bold ${visibleDiscounts.includes(f.key) ? 'bg-white text-sky-800 border-sky-300' : 'bg-slate-100 text-slate-400'}`}>{visibleDiscounts.includes(f.key) ? '−' : '+'} {f.label}</button>
                  )}</div>}
                </div>)}
              {group(2, 'bg-[#fff2cc] text-[#7f6000]', 'Preço Promo')}
              {group(6, 'bg-white text-[#1f4e79]', 'Operação')}
              {group(priceOpen ? 4 : 1, 'bg-[#e2f0d9] text-[#003b8f]', groupToggle('Prices', priceOpen, () => setPriceOpen(!priceOpen)))}
              {group(offerOpen ? 2 : 1, 'bg-[#92d050] text-[#003b8f]', groupToggle('Oferta', offerOpen, () => setOfferOpen(!offerOpen)))}
              {group(1, 'bg-[#fff2cc] text-[#7f6000]', 'Mercado Online')}
            </tr>
            <tr>{keys.map(headers)}</tr>
          </thead>
          <tbody>{rows.map((row, index) => {
            const reviewed = reviewedKeys.has(analysisReviewKey(row));
            return (
              <tr
                key={`${row.rowKey || row.referencia || row.descricao}-${index}`}
                className={`hover:brightness-[0.985] ${reviewed ? 'bg-orange-50/60' : ''}`}
                aria-label={reviewed ? `${row.descricao} revisado` : undefined}
              >
                {keys.map(k => cell(k, row, reviewed))}
              </tr>
            );
          })}
            {rows.length === 0 && <tr><td colSpan={keys.length} className="p-8 text-center text-slate-400">Nenhum produto encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex h-4 cursor-row-resize items-center justify-center border-t border-slate-200 bg-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-400" onMouseDown={startHeightResize}>⋮ Ajustar altura ⋮</div>
    </div>
  );
}
