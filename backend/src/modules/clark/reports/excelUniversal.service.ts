import ExcelJS from 'exceljs';

type GerarExcelUniversalClarkInput = {
  titulo?: string;
  pergunta?: string;
  dados?: any;
};

type ToolResultNormalizado = {
  tool: string;
  result: any;
  ok?: boolean;
};

function safeString(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function limparNomeAba(nome: string): string {
  return safeString(nome)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Aba';
}

function limparDescricaoProduto(descricao: any): string {
  return safeString(descricao)
    .replace(/\bSM-[A-Z0-9]{6,}\b/gi, '')
    .replace(/\b[A-Z]{1,4}-?[A-Z0-9]{8,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getProdutoPesquisado(result: any): string {
  return (
    safeString(result?.produto?.family) ||
    safeString(result?.produto_planejado?.family) ||
    safeString(result?.produto?.query) ||
    safeString(result?.produto_planejado?.model) ||
    safeString(result?.termo_pesquisado) ||
    safeString(result?.produto) ||
    'Produto pesquisado'
  );
}

function aplicarEstiloCabecalho(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);

  header.font = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };

  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  header.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  };

  header.height = 22;

  header.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
}

function aplicarEstiloTabela(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  aplicarEstiloCabecalho(ws);

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.eachCell((cell) => {
      cell.alignment = {
        vertical: 'top',
        wrapText: true,
      };

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columnCount || 1 },
  };
}

function ajustarLarguras(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((column) => {
    let maxLength = 10;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const text =
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

      maxLength = Math.max(maxLength, Math.min(text.length + 2, 60));
    });

    column.width = Math.max(Number(column.width || 10), maxLength);
  });
}

function criarAbaComColunas(
  workbook: ExcelJS.Workbook,
  nome: string,
  columns: Partial<ExcelJS.Column>[],
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(limparNomeAba(nome));
  ws.columns = columns;
  return ws;
}

function getToolResults(dados: any): ToolResultNormalizado[] {
  const candidatos: any[] = [];

  if (Array.isArray(dados?.toolResults)) candidatos.push(...dados.toolResults);
  if (Array.isArray(dados?.results)) candidatos.push(...dados.results);
  if (Array.isArray(dados?.resultado?.toolResults)) candidatos.push(...dados.resultado.toolResults);
  if (Array.isArray(dados?.data?.toolResults)) candidatos.push(...dados.data.toolResults);
  if (Array.isArray(dados?.dados?.toolResults)) candidatos.push(...dados.dados.toolResults);

  if (dados?.tool && dados?.result) candidatos.push(dados);

  if (!candidatos.length && dados?.result) {
    candidatos.push({
      tool: dados.tool || dados.nome || 'dados_genericos',
      result: dados.result,
      ok: true,
    });
  }

  return candidatos
    .map((item) => {
      const tool = safeString(item?.tool || item?.name || item?.nome || item?.tipo || '');
      const result = item?.result ?? item?.resultado ?? item?.data ?? item;

      return { tool, result, ok: item?.ok };
    })
    .filter((item) => item.tool || item.result);
}

function criarAbaResumo(params: {
  workbook: ExcelJS.Workbook;
  titulo: string;
  pergunta: string;
  toolResults: ToolResultNormalizado[];
}) {
  const ws = params.workbook.addWorksheet('Resumo');

  ws.columns = [
    { header: 'Campo', key: 'campo', width: 28 },
    { header: 'Valor', key: 'valor', width: 90 },
  ];

  ws.addRow({ campo: 'Título', valor: params.titulo });
  ws.addRow({ campo: 'Pergunta', valor: params.pergunta });
  ws.addRow({ campo: 'Gerado em', valor: new Date().toLocaleString('pt-BR') });
  ws.addRow({
    campo: 'Ferramentas encontradas',
    valor: params.toolResults.map((t) => t.tool || 'sem_nome').join(', '),
  });

  aplicarEstiloTabela(ws);
}

function criarAbaEstoqueProduto(workbook: ExcelJS.Workbook, result: any) {
  const produtos = Array.isArray(result?.produtos) ? result.produtos : [];
  const produtoPesquisado = getProdutoPesquisado(result);

  const wsProdutos = criarAbaComColunas(workbook, 'Produtos', [
    { header: 'Produto pesquisado', key: 'produto_pesquisado', width: 28 },
    { header: 'Variação', key: 'variacao', width: 45 },
    { header: 'Quantidade total', key: 'quantidade_total', width: 18 },
    { header: 'Total de lojas', key: 'total_lojas', width: 16 },
  ]);

  for (const produto of produtos) {
    const lojas = Array.isArray(produto?.lojas)
      ? produto.lojas
      : Array.isArray(produto?.principais_lojas)
        ? produto.principais_lojas
        : [];

    wsProdutos.addRow({
      produto_pesquisado: produtoPesquisado,
      variacao: limparDescricaoProduto(produto?.descricao || produto?.variacao),
      quantidade_total: safeNumber(produto?.quantidade_total),
      total_lojas: lojas.length,
    });
  }

  aplicarEstiloTabela(wsProdutos);

  const wsLojas = criarAbaComColunas(workbook, 'Estoque por Loja', [
    { header: 'Produto pesquisado', key: 'produto_pesquisado', width: 28 },
    { header: 'Variação', key: 'variacao', width: 45 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Quantidade', key: 'quantidade', width: 14 },
  ]);

  for (const produto of produtos) {
    const variacao = limparDescricaoProduto(produto?.descricao || produto?.variacao);

    const lojas = Array.isArray(produto?.lojas)
      ? produto.lojas
      : Array.isArray(produto?.principais_lojas)
        ? produto.principais_lojas
        : [];

    for (const loja of lojas) {
      wsLojas.addRow({
        produto_pesquisado: produtoPesquisado,
        variacao,
        loja: loja?.loja || '',
        quantidade: safeNumber(loja?.quantidade),
      });
    }
  }

  aplicarEstiloTabela(wsLojas);
}

function criarAbaRankingEstoque(workbook: ExcelJS.Workbook, result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];

  const wsRanking = criarAbaComColunas(workbook, 'Ranking Estoque', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Produto', key: 'produto', width: 50 },
    { header: 'Quantidade total', key: 'quantidade_total', width: 18 },
    { header: 'Total de lojas', key: 'total_lojas', width: 16 },
  ]);

  for (const item of ranking) {
    const lojas = Array.isArray(item?.lojas)
      ? item.lojas
      : Array.isArray(item?.principais_lojas)
        ? item.principais_lojas
        : [];

    wsRanking.addRow({
      posicao: item?.posicao || '',
      produto: limparDescricaoProduto(item?.descricao || item?.produto || item?.modelo),
      quantidade_total: safeNumber(item?.quantidade_total),
      total_lojas: lojas.length,
    });
  }

  aplicarEstiloTabela(wsRanking);

  const wsLojas = criarAbaComColunas(workbook, 'Lojas por Produto', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Produto', key: 'produto', width: 50 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Quantidade', key: 'quantidade', width: 14 },
  ]);

  for (const item of ranking) {
    const lojas = Array.isArray(item?.lojas)
      ? item.lojas
      : Array.isArray(item?.principais_lojas)
        ? item.principais_lojas
        : [];

    for (const loja of lojas) {
      wsLojas.addRow({
        posicao: item?.posicao || '',
        produto: limparDescricaoProduto(item?.descricao || item?.produto || item?.modelo),
        loja: loja?.loja || '',
        quantidade: safeNumber(loja?.quantidade),
      });
    }
  }

  aplicarEstiloTabela(wsLojas);
}

function criarAbaVendasPorLoja(workbook: ExcelJS.Workbook, result: any, nomeAba = 'Vendas por Loja') {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : Array.isArray(result?.lojas) ? result.lojas : [];

  const ws = criarAbaComColunas(workbook, nomeAba, [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Total vendas', key: 'total_vendas', width: 18 },
    { header: 'Total vendas formatado', key: 'total_vendas_formatado', width: 24 },
    { header: 'Peças', key: 'total_pecas', width: 14 },
    { header: 'Ticket médio', key: 'ticket_medio', width: 18 },
    { header: 'Ticket médio formatado', key: 'ticket_medio_formatado', width: 24 },
  ]);

  for (const item of ranking) {
    ws.addRow({
      posicao: item?.posicao || '',
      loja: item?.loja || '',
      total_vendas: safeNumber(item?.total_vendas),
      total_vendas_formatado: item?.total_vendas_formatado || '',
      total_pecas: safeNumber(item?.total_pecas),
      ticket_medio: safeNumber(item?.ticket_medio),
      ticket_medio_formatado: item?.ticket_medio_formatado || '',
    });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaVendasPorVendedor(workbook: ExcelJS.Workbook, result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : Array.isArray(result?.vendedores) ? result.vendedores : [];

  const ws = criarAbaComColunas(workbook, 'Vendas por Vendedor', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Vendedor', key: 'vendedor', width: 34 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Total vendas', key: 'total_vendas', width: 18 },
    { header: 'Total vendas formatado', key: 'total_vendas_formatado', width: 24 },
    { header: 'Peças', key: 'total_pecas', width: 14 },
    { header: 'Ticket médio', key: 'ticket_medio', width: 18 },
    { header: 'Ticket médio formatado', key: 'ticket_medio_formatado', width: 24 },
  ]);

  for (const item of ranking) {
    ws.addRow({
      posicao: item?.posicao || '',
      vendedor: item?.vendedor || '',
      loja: item?.loja || '',
      total_vendas: safeNumber(item?.total_vendas),
      total_vendas_formatado: item?.total_vendas_formatado || '',
      total_pecas: safeNumber(item?.total_pecas),
      ticket_medio: safeNumber(item?.ticket_medio),
      ticket_medio_formatado: item?.ticket_medio_formatado || '',
    });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaVendasPorCategoria(workbook: ExcelJS.Workbook, result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];

  const ws = criarAbaComColunas(workbook, 'Vendas por Categoria', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Categoria', key: 'categoria', width: 34 },
    { header: 'Total vendas', key: 'total_vendas', width: 18 },
    { header: 'Total vendas formatado', key: 'total_vendas_formatado', width: 24 },
    { header: 'Peças', key: 'total_pecas', width: 14 },
    { header: 'Ticket médio', key: 'ticket_medio', width: 18 },
    { header: 'Ticket médio formatado', key: 'ticket_medio_formatado', width: 24 },
  ]);

  for (const item of ranking) {
    ws.addRow({
      posicao: item?.posicao || '',
      categoria: item?.categoria || '',
      total_vendas: safeNumber(item?.total_vendas),
      total_vendas_formatado: item?.total_vendas_formatado || '',
      total_pecas: safeNumber(item?.total_pecas),
      ticket_medio: safeNumber(item?.ticket_medio),
      ticket_medio_formatado: item?.ticket_medio_formatado || '',
    });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaVendasResumo(workbook: ExcelJS.Workbook, result: any) {
  const ws = criarAbaComColunas(workbook, 'Resumo Vendas', [
    { header: 'Campo', key: 'campo', width: 34 },
    { header: 'Valor', key: 'valor', width: 40 },
  ]);

  ws.addRow({ campo: 'Período', valor: result?.periodo?.descricao || '' });
  ws.addRow({ campo: 'Total vendas', valor: safeNumber(result?.total_vendas) });
  ws.addRow({ campo: 'Total vendas formatado', valor: result?.total_vendas_formatado || '' });
  ws.addRow({ campo: 'Peças vendidas', valor: safeNumber(result?.total_pecas) });
  ws.addRow({ campo: 'Ticket médio', valor: safeNumber(result?.ticket_medio) });
  ws.addRow({ campo: 'Ticket médio formatado', valor: result?.ticket_medio_formatado || '' });

  aplicarEstiloTabela(ws);
}

function criarAbaSegurosPorLoja(workbook: ExcelJS.Workbook, result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];

  const ws = criarAbaComColunas(workbook, 'Seguros por Loja', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Total seguros', key: 'seguros_total', width: 18 },
    { header: 'Total seguros formatado', key: 'seguros_total_formatado', width: 26 },
    { header: 'Quantidade', key: 'seguros_qtd', width: 14 },
  ]);

  for (const item of ranking) {
    ws.addRow({
      posicao: item?.posicao || '',
      loja: item?.loja || '',
      seguros_total: safeNumber(item?.seguros_total),
      seguros_total_formatado: item?.seguros_total_formatado || '',
      seguros_qtd: safeNumber(item?.seguros_qtd),
    });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaSegurosPorVendedor(workbook: ExcelJS.Workbook, result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];

  const ws = criarAbaComColunas(workbook, 'Seguros por Vendedor', [
    { header: 'Posição', key: 'posicao', width: 10 },
    { header: 'Vendedor', key: 'vendedor', width: 34 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Total seguros', key: 'seguros_total', width: 18 },
    { header: 'Total seguros formatado', key: 'seguros_total_formatado', width: 26 },
    { header: 'Quantidade', key: 'seguros_qtd', width: 14 },
  ]);

  for (const item of ranking) {
    ws.addRow({
      posicao: item?.posicao || '',
      vendedor: item?.vendedor || '',
      loja: item?.loja || '',
      seguros_total: safeNumber(item?.seguros_total),
      seguros_total_formatado: item?.seguros_total_formatado || '',
      seguros_qtd: safeNumber(item?.seguros_qtd),
    });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaSqlAnalitico(workbook: ExcelJS.Workbook, result: any) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];

  if (!rows.length) {
    const ws = criarAbaComColunas(workbook, 'Consulta Analítica', [
      { header: 'Mensagem', key: 'mensagem', width: 80 },
    ]);

    ws.addRow({ mensagem: 'Consulta executada, mas sem registros.' });
    aplicarEstiloTabela(ws);
    return;
  }

  const keys = Array.from(
    rows.reduce((set: Set<string>, row: any) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  ) as string[];

  const ws = criarAbaComColunas(
    workbook,
    'Consulta Analítica',
    keys.map((key) => ({ header: key, key, width: 24 })),
  );

  for (const row of rows) {
    const rowData: Record<string, any> = {};
    for (const key of keys) rowData[key] = row?.[key] ?? '';
    ws.addRow(rowData);
  }

  aplicarEstiloTabela(ws);
}

function criarAbaRelatorioExecutivo(workbook: ExcelJS.Workbook, result: any) {
  const ws = criarAbaComColunas(workbook, 'Relatório Executivo', [
    { header: 'Campo', key: 'campo', width: 34 },
    { header: 'Valor', key: 'valor', width: 100 },
  ]);

  if (result?.relatorio) ws.addRow({ campo: 'Relatório', valor: safeString(result.relatorio) });
  if (result?.resumo) ws.addRow({ campo: 'Resumo', valor: safeString(result.resumo) });

  if (!result?.relatorio && !result?.resumo) {
    ws.addRow({ campo: 'Dados', valor: JSON.stringify(result, null, 2) });
  }

  aplicarEstiloTabela(ws);
}

function criarAbaAnaliseProdutoComercial(workbook: ExcelJS.Workbook, result: any) {
  const produto = getProdutoPesquisado(result);
  const estoque = result?.estoque || {};
  const vendas = result?.vendas || {};
  const diagnostico = result?.diagnostico || {};

  const wsResumo = criarAbaComColunas(workbook, 'Análise Produto', [
    { header: 'Campo', key: 'campo', width: 36 },
    { header: 'Valor', key: 'valor', width: 50 },
  ]);

  wsResumo.addRow({ campo: 'Produto', valor: produto });
  wsResumo.addRow({ campo: 'Período', valor: vendas?.periodo?.descricao || result?.periodo?.descricao || '' });
  wsResumo.addRow({ campo: 'Estoque atual', valor: safeNumber(estoque?.total_estoque) });
  wsResumo.addRow({ campo: 'Vendas em peças', valor: safeNumber(vendas?.total_pecas) });
  wsResumo.addRow({ campo: 'Vendas em valor', valor: safeNumber(vendas?.total_vendas) });
  wsResumo.addRow({ campo: 'Vendas formatado', valor: vendas?.total_vendas_formatado || '' });
  wsResumo.addRow({ campo: 'Média diária de peças', valor: safeNumber(diagnostico?.media_diaria_pecas) });
  wsResumo.addRow({ campo: 'Cobertura em dias', valor: diagnostico?.cobertura_dias === null ? '' : safeNumber(diagnostico?.cobertura_dias) });
  wsResumo.addRow({ campo: 'Variações em estoque', valor: safeNumber(estoque?.total_variacoes) });
  wsResumo.addRow({ campo: 'Lojas com estoque', valor: safeNumber(estoque?.total_lojas) });
  aplicarEstiloTabela(wsResumo);

  const wsEstoque = criarAbaComColunas(workbook, 'Produto Estoque Loja', [
    { header: 'Produto', key: 'produto', width: 28 },
    { header: 'Variação', key: 'variacao', width: 45 },
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Quantidade', key: 'quantidade', width: 14 },
  ]);

  const variacoes = Array.isArray(estoque?.variacoes) ? estoque.variacoes : [];
  for (const variacao of variacoes) {
    const lojas = Array.isArray(variacao?.lojas) ? variacao.lojas : [];
    for (const loja of lojas) {
      wsEstoque.addRow({
        produto,
        variacao: limparDescricaoProduto(variacao?.variacao),
        loja: loja?.loja || '',
        quantidade: safeNumber(loja?.quantidade),
      });
    }
  }
  aplicarEstiloTabela(wsEstoque);

  criarAbaVendasPorLoja(workbook, vendas, 'Produto Vendas Loja');
  criarAbaVendasPorVendedor(workbook, vendas);

  const excesso = Array.isArray(diagnostico?.lojas_com_possivel_excesso) ? diagnostico.lojas_com_possivel_excesso : [];
  const wsExcesso = criarAbaComColunas(workbook, 'Possível Excesso', [
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Estoque', key: 'estoque', width: 14 },
    { header: 'Vendas no período', key: 'vendas_periodo', width: 18 },
    { header: 'Cobertura dias', key: 'cobertura_dias', width: 18 },
    { header: 'Motivo', key: 'motivo', width: 60 },
  ]);
  excesso.forEach((item: any) => wsExcesso.addRow({
    loja: item?.loja || '',
    estoque: safeNumber(item?.estoque),
    vendas_periodo: safeNumber(item?.vendas_periodo),
    cobertura_dias: item?.cobertura_dias === null ? '' : safeNumber(item?.cobertura_dias),
    motivo: item?.motivo || '',
  }));
  aplicarEstiloTabela(wsExcesso);

  const ruptura = Array.isArray(diagnostico?.lojas_com_risco_ruptura) ? diagnostico.lojas_com_risco_ruptura : [];
  const wsRuptura = criarAbaComColunas(workbook, 'Risco Ruptura', [
    { header: 'Loja', key: 'loja', width: 34 },
    { header: 'Estoque', key: 'estoque', width: 14 },
    { header: 'Vendas no período', key: 'vendas_periodo', width: 18 },
    { header: 'Motivo', key: 'motivo', width: 60 },
  ]);
  ruptura.forEach((item: any) => wsRuptura.addRow({
    loja: item?.loja || '',
    estoque: safeNumber(item?.estoque),
    vendas_periodo: safeNumber(item?.vendas_periodo),
    motivo: item?.motivo || '',
  }));
  aplicarEstiloTabela(wsRuptura);

  const redistribuicao = Array.isArray(diagnostico?.sugestoes_redistribuicao) ? diagnostico.sugestoes_redistribuicao : [];
  const wsRedistribuicao = criarAbaComColunas(workbook, 'Redistribuição', [
    { header: 'Origem', key: 'origem', width: 34 },
    { header: 'Destino', key: 'destino', width: 34 },
    { header: 'Quantidade sugerida', key: 'quantidade_sugerida', width: 22 },
    { header: 'Motivo', key: 'motivo', width: 70 },
  ]);
  redistribuicao.forEach((item: any) => wsRedistribuicao.addRow({
    origem: item?.origem || '',
    destino: item?.destino || '',
    quantidade_sugerida: safeNumber(item?.quantidade_sugerida),
    motivo: item?.motivo || '',
  }));
  aplicarEstiloTabela(wsRedistribuicao);
}

function criarAbaModoDiretoria(workbook: ExcelJS.Workbook, result: any) {
  const resumo = result?.resumo || {};

  const wsResumo = criarAbaComColunas(workbook, 'Modo Diretoria', [
    { header: 'Campo', key: 'campo', width: 36 },
    { header: 'Valor', key: 'valor', width: 60 },
  ]);

  wsResumo.addRow({ campo: 'Período', valor: result?.periodo?.descricao || '' });
  wsResumo.addRow({ campo: 'Total vendas', valor: safeNumber(resumo?.total_vendas) });
  wsResumo.addRow({ campo: 'Total vendas formatado', valor: resumo?.total_vendas_formatado || '' });
  wsResumo.addRow({ campo: 'Peças vendidas', valor: safeNumber(resumo?.total_pecas) });
  wsResumo.addRow({ campo: 'Estoque total', valor: safeNumber(resumo?.estoque_total) });
  wsResumo.addRow({ campo: 'Lojas com venda', valor: safeNumber(resumo?.lojas_com_venda) });
  wsResumo.addRow({ campo: 'Produtos em estoque', valor: safeNumber(resumo?.produtos_em_estoque) });
  aplicarEstiloTabela(wsResumo);

  criarAbaVendasPorLoja(workbook, { lojas: result?.top_lojas_vendas || [] }, 'Top Lojas Vendas');

  const wsProdutos = criarAbaComColunas(workbook, 'Top Produtos Estoque', [
    { header: 'Produto', key: 'produto', width: 55 },
    { header: 'Estoque', key: 'estoque', width: 14 },
    { header: 'Total lojas', key: 'total_lojas', width: 16 },
  ]);

  const produtos = Array.isArray(result?.top_produtos_estoque) ? result.top_produtos_estoque : [];
  produtos.forEach((item: any) => wsProdutos.addRow({
    produto: limparDescricaoProduto(item?.produto),
    estoque: safeNumber(item?.estoque),
    total_lojas: safeNumber(item?.total_lojas),
  }));
  aplicarEstiloTabela(wsProdutos);

  const wsAlertas = criarAbaComColunas(workbook, 'Alertas e Ações', [
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Descrição', key: 'descricao', width: 90 },
  ]);

  const alertas = Array.isArray(result?.alertas) ? result.alertas : [];
  const recomendacoes = Array.isArray(result?.recomendacoes) ? result.recomendacoes : [];
  alertas.forEach((item: any) => wsAlertas.addRow({ tipo: 'Alerta', descricao: safeString(item) }));
  recomendacoes.forEach((item: any) => wsAlertas.addRow({ tipo: 'Recomendação', descricao: safeString(item) }));
  aplicarEstiloTabela(wsAlertas);
}

function criarAbaDadosBrutos(workbook: ExcelJS.Workbook, nome: string, result: any) {
  const ws = criarAbaComColunas(workbook, nome || 'Dados Brutos', [
    { header: 'Campo', key: 'campo', width: 40 },
    { header: 'Valor', key: 'valor', width: 100 },
  ]);

  if (Array.isArray(result)) {
    result.forEach((item, index) => {
      ws.addRow({
        campo: `Item ${index + 1}`,
        valor: typeof item === 'object' ? JSON.stringify(item, null, 2) : safeString(item),
      });
    });
  } else if (result && typeof result === 'object') {
    Object.entries(result).forEach(([key, value]) => {
      ws.addRow({
        campo: key,
        valor: typeof value === 'object' ? JSON.stringify(value, null, 2) : safeString(value),
      });
    });
  } else {
    ws.addRow({ campo: 'Valor', valor: safeString(result) });
  }

  aplicarEstiloTabela(ws);
}

function processarToolResult(workbook: ExcelJS.Workbook, toolResult: ToolResultNormalizado) {
  const tool = safeString(toolResult.tool);
  const result = toolResult.result;

  switch (tool) {
    case 'consultar_estoque_produto':
      criarAbaEstoqueProduto(workbook, result);
      return;

    case 'consultar_ranking_estoque':
      criarAbaRankingEstoque(workbook, result);
      return;

    case 'consultar_vendas_resumo':
      criarAbaVendasResumo(workbook, result);
      return;

    case 'consultar_vendas_por_loja':
      criarAbaVendasPorLoja(workbook, result);
      return;

    case 'consultar_vendas_por_vendedor':
      criarAbaVendasPorVendedor(workbook, result);
      return;

    case 'consultar_vendas_por_categoria':
      criarAbaVendasPorCategoria(workbook, result);
      return;

    case 'consultar_seguros_por_loja':
      criarAbaSegurosPorLoja(workbook, result);
      return;

    case 'consultar_seguros_por_vendedor':
      criarAbaSegurosPorVendedor(workbook, result);
      return;

    case 'executar_sql_analitico':
      criarAbaSqlAnalitico(workbook, result);
      return;

    case 'gerar_relatorio_executivo':
    case 'consultar_relatorio_vendas':
      criarAbaRelatorioExecutivo(workbook, result);
      return;

    case 'consultar_analise_produto_comercial':
    case 'consultar_vendas_vs_estoque':
    case 'consultar_risco_stockout':
    case 'consultar_excesso_estoque':
    case 'consultar_redistribuicao_estoque':
      criarAbaAnaliseProdutoComercial(workbook, result);
      return;

    case 'consultar_modo_diretoria':
      criarAbaModoDiretoria(workbook, result);
      return;

    default:
      criarAbaDadosBrutos(
        workbook,
        tool ? `Dados ${tool}`.slice(0, 31) : 'Dados Brutos',
        result,
      );
  }
}

export async function gerarExcelUniversalClark(input: GerarExcelUniversalClarkInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Clark IA - TeleFluxo';
  workbook.created = new Date();
  workbook.modified = new Date();

  const titulo = input.titulo || 'Exportação Clark IA';
  const pergunta = input.pergunta || '';
  const dados = input.dados || {};

  const toolResults = getToolResults(dados);

  criarAbaResumo({
    workbook,
    titulo,
    pergunta,
    toolResults,
  });

  if (toolResults.length) {
    for (const toolResult of toolResults) {
      processarToolResult(workbook, toolResult);
    }
  } else {
    criarAbaDadosBrutos(workbook, 'Dados Brutos', dados);
  }

  workbook.eachSheet((worksheet) => {
    ajustarLarguras(worksheet);

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
        }
      });
    });
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
