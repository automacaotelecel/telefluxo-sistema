export const CLARK_SCHEMA_CONTEXT = `
BANCOS E TABELAS AUTORIZADAS DA CLARK

1) samsung_vendas.db
Tabela vendas:
- DATA_EMISSAO ou data_emissao: data da venda em texto
- NOME_VENDEDOR ou nome_vendedor
- DESCRICAO ou descricao
- QUANTIDADE ou quantidade
- TOTAL_LIQUIDO ou total_liquido
- CNPJ_EMPRESA ou cnpj_empresa
- FAMILIA ou familia
- REGIAO ou regiao
Uso: vendas resumidas, ranking por vendedor, categoria/família e região.

Tabela vendedores_kpi:
- LOJA, VENDEDOR, FAT_ATUAL, TENDENCIA, FAT_ANTERIOR, CRESCIMENTO, SEGUROS, PA, QTD, TICKET, REGIAO, PCT_SEGURO
Uso: ranking comercial e indicadores por vendedor/loja.

Tabela stock (via Prisma, ferramenta de estoque):
- storeName, productCode, reference, description, category, quantity, costPrice, salePrice, serial, emLinha, cluster
Uso: estoque atual por produto, loja, categoria, IMEI/serial.

2) samsung_vendas_anuais.db
Tabela vendas_anuais_raw:
- data_emissao, nome_vendedor, codigo_produto, referencia, descricao, categoria, imei, quantidade, total_liquido, qtd_real, total_real, categoria_real, loja, regiao, ano, mes, cnpj_empresa
Uso: análise anual detalhada.

Tabela vendas_anuais:
- data_emissao, ano, mes, loja, cnpj_empresa, nome_vendedor, descricao, familia, regiao, quantidade, total_liquido
Uso: análises históricas consolidadas.

Tabela seguros_anuais:
- data_emissao, ano, mes, loja, cnpj_empresa, nome_vendedor, descricao, regiao, qtd, premio, nf
Uso: ranking e análise de seguros.

Tabela agg_lojas_mensal:
- ano, mes, loja, cnpj_empresa, regiao, vendas_total, vendas_qtd, seguros_total, seguros_qtd
Uso: comparativos mensais por loja.

Tabela agg_vendedores_mensal:
- ano, mes, loja, cnpj_empresa, regiao, vendedor, vendas_total, vendas_qtd, seguros_total, seguros_qtd
Uso: comparativos mensais por vendedor.

REGRAS DE NEGÓCIO:
- Produto específico deve ser rígido: família/modelo + memória + cor + categoria.
- Galaxy S26 não pode retornar Galaxy S25.
- 512GB não pode retornar 256GB.
- Preto não pode retornar cinza/azul/verde.
- Se não houver produto exato, informe claramente que não encontrou.
- Nunca mostre JSON bruto, trace, score ou candidates ao usuário final.
- Para diretoria, responda com resumo, ranking, insight e recomendação quando houver dados.
- Não invente números. Toda métrica deve vir de ferramenta ou SQL SELECT.
`;
