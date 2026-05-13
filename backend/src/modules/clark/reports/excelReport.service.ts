import ExcelJS from 'exceljs';

type ExcelReportInput = {
  titulo: string;
  periodo?: {
    inicio?: string;
    fim?: string;
  };
  resumo?: {
    vendasTotais?: number;
    pecasVendidas?: number;
    ticketMedio?: number;
  };
  vendasPorLoja?: Array<{
    loja: string;
    valor: number;
    quantidade?: number;
  }>;
  vendasPorVendedor?: Array<{
    vendedor: string;
    loja?: string;
    valor: number;
    quantidade?: number;
  }>;
  estoqueDestaque?: Array<{
    produto: string;
    quantidade: number;
    lojas?: string;
  }>;
  segurosPorLoja?: Array<{
    loja: string;
    valor?: number;
    quantidade?: number;
  }>;
  segurosPorVendedor?: Array<{
    vendedor: string;
    loja?: string;
    valor?: number;
    quantidade?: number;
  }>;
  recomendacoes?: string[];
};

function moeda(value: number | undefined | null) {
  return Number(value || 0);
}

function aplicarEstiloCabecalho(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
}

function aplicarTabela(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  
  const lastColumnLetter = ws.getColumn(ws.columnCount).letter || 'A';

    ws.autoFilter = {
    from: 'A1',
    to: `${lastColumnLetter}1`,
    };

  ws.columns.forEach((column) => {
    let maxLength = 12;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = String(cell.value || '');
      maxLength = Math.max(maxLength, value.length + 2);
    });

    column.width = Math.min(maxLength, 45);
  });
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; key: string; width?: number; style?: any }>,
  rows: any[]
) {
  const ws = workbook.addWorksheet(name);

  ws.columns = columns;
  ws.addRows(rows);

  aplicarEstiloCabecalho(ws.getRow(1));
  aplicarTabela(ws);

  return ws;
}

export async function gerarExcelRelatorioClark(input: ExcelReportInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Clark IA - TeleFluxo';
  workbook.created = new Date();
  workbook.modified = new Date();

  const periodoTexto =
    input.periodo?.inicio && input.periodo?.fim
      ? `${input.periodo.inicio} até ${input.periodo.fim}`
      : 'Não informado';

  const resumoWs = workbook.addWorksheet('Resumo');

  resumoWs.addRows([
    ['Relatório', input.titulo],
    ['Período', periodoTexto],
    ['Vendas totais', moeda(input.resumo?.vendasTotais)],
    ['Peças vendidas', input.resumo?.pecasVendidas || 0],
    ['Ticket médio', moeda(input.resumo?.ticketMedio)],
  ]);

  resumoWs.getColumn(1).width = 24;
  resumoWs.getColumn(2).width = 38;

  resumoWs.getCell('A1').font = { bold: true };
  resumoWs.getCell('A2').font = { bold: true };
  resumoWs.getCell('A3').font = { bold: true };
  resumoWs.getCell('A4').font = { bold: true };
  resumoWs.getCell('A5').font = { bold: true };

  resumoWs.getCell('B3').numFmt = 'R$ #,##0.00';
  resumoWs.getCell('B5').numFmt = 'R$ #,##0.00';

  if (input.vendasPorLoja?.length) {
    const ws = addSheet(
      workbook,
      'Vendas por Loja',
      [
        { header: 'Loja', key: 'loja' },
        { header: 'Valor', key: 'valor' },
        { header: 'Quantidade', key: 'quantidade' },
      ],
      input.vendasPorLoja.map((item) => ({
        loja: item.loja,
        valor: moeda(item.valor),
        quantidade: item.quantidade || 0,
      }))
    );

    ws.getColumn('B').numFmt = 'R$ #,##0.00';
  }

  if (input.vendasPorVendedor?.length) {
    const ws = addSheet(
      workbook,
      'Vendas por Vendedor',
      [
        { header: 'Vendedor', key: 'vendedor' },
        { header: 'Loja', key: 'loja' },
        { header: 'Valor', key: 'valor' },
        { header: 'Quantidade', key: 'quantidade' },
      ],
      input.vendasPorVendedor.map((item) => ({
        vendedor: item.vendedor,
        loja: item.loja || '',
        valor: moeda(item.valor),
        quantidade: item.quantidade || 0,
      }))
    );

    ws.getColumn('C').numFmt = 'R$ #,##0.00';
  }

  if (input.estoqueDestaque?.length) {
    addSheet(
      workbook,
      'Estoque em Destaque',
      [
        { header: 'Produto', key: 'produto' },
        { header: 'Quantidade', key: 'quantidade' },
        { header: 'Lojas', key: 'lojas' },
      ],
      input.estoqueDestaque.map((item) => ({
        produto: item.produto,
        quantidade: item.quantidade,
        lojas: item.lojas || '',
      }))
    );
  }

  if (input.segurosPorLoja?.length) {
    const ws = addSheet(
      workbook,
      'Seguros por Loja',
      [
        { header: 'Loja', key: 'loja' },
        { header: 'Valor', key: 'valor' },
        { header: 'Quantidade', key: 'quantidade' },
      ],
      input.segurosPorLoja.map((item) => ({
        loja: item.loja,
        valor: moeda(item.valor),
        quantidade: item.quantidade || 0,
      }))
    );

    ws.getColumn('B').numFmt = 'R$ #,##0.00';
  }

  if (input.segurosPorVendedor?.length) {
    const ws = addSheet(
      workbook,
      'Seguros por Vendedor',
      [
        { header: 'Vendedor', key: 'vendedor' },
        { header: 'Loja', key: 'loja' },
        { header: 'Valor', key: 'valor' },
        { header: 'Quantidade', key: 'quantidade' },
      ],
      input.segurosPorVendedor.map((item) => ({
        vendedor: item.vendedor,
        loja: item.loja || '',
        valor: moeda(item.valor),
        quantidade: item.quantidade || 0,
      }))
    );

    ws.getColumn('C').numFmt = 'R$ #,##0.00';
  }

  if (input.recomendacoes?.length) {
    const ws = workbook.addWorksheet('Recomendações');

    ws.columns = [
      { header: 'Nº', key: 'numero', width: 8 },
      { header: 'Recomendação', key: 'recomendacao', width: 90 },
    ];

    ws.addRows(
      input.recomendacoes.map((rec, index) => ({
        numero: index + 1,
        recomendacao: rec,
      }))
    );

    aplicarEstiloCabecalho(ws.getRow(1));
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}