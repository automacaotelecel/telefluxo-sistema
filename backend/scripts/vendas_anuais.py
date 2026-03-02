# ===========================================
# ⚡ RELATÓRIO DE VENDAS MICROVIX – ACUMULADO (ANO ATÉ MÊS PASSADO)
# Lógica: Puxa do dia 01/01 do ano atual até o último dia do mês anterior.
# Se estiver em janeiro: puxa o ano anterior inteiro.
# Substitui todos os dados do banco para evitar duplicatas.
#
# ✅ Patch 2026-03-02:
# - Garante timestamp=0 no LinxMovimento (evita retorno vazio por validação da API)
# - Loga trecho do XML de resposta quando vier 0 linhas (diagnóstico de ResponseSuccess/mensagem)
# - Parse mais robusto (BOM / erro de XML)
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
import pandas as pd
from lxml import etree
from datetime import datetime
import sqlite3, os, time
import logging
import sys
import calendar

# --- Fixa o diretório de trabalho na pasta do script/EXE ---
if getattr(sys, 'frozen', False):   # executável (PyInstaller)
    os.chdir(os.path.dirname(sys.executable))
else:   # script .py
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

# === CONFIGURAÇÕES GERAIS ===
USUARIO = "linx_export"
SENHA = "linx_export"
CHAVE = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL = "https://webapi.microvix.com.br/1.0/api/integracao"
headers = {"Content-Type": "application/xml; charset=utf-8", "Accept": "application/xml"}
auth = HTTPBasicAuth(USUARIO, SENHA)

# === BANCOS LOCAIS ===
CACHE_PRODUTOS   = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\produtos_completos.db"
CACHE_LOJAS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\lojas_fixas.db"
CACHE_IMEIS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\serial_cache.db"
CACHE_VENDEDORES = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\vendedores_cache.db"

# === DESTINO DO SQLITE FINAL ===
DB_DEST_DIR  = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
os.makedirs(DB_DEST_DIR, exist_ok=True)
DB_DEST_PATH = os.path.join(DB_DEST_DIR, "samsung_anual.db")

# === LISTA DE CNPJs ===
CNPJS = [
    "12309173001732","12309173001066","12309173001651","12309173000841","12309173001813",
    "12309173000507","12309173000175","12309173000337","12309173000922","12309173000256",
    "12309173001228","12309173000760","12309173001309","12309173001147","12309173000680",
    "12309173000418","12309173002461","12309173002208","12309173001570","12309173001902",
    "12309173002119","12309173002038","12309173002380","12309173002542","12309173002895",
    "12309173002976",
]

COLUNAS_FINAIS = [
    "NOME_FANTASIA","NOTA_FISCAL","CANCELADO","TIPO_TRANSACAO","OPERACAO_TIPO","NATUREZA_OPERACAO",
    "DATA_EMISSAO","HORA","NOME_VENDEDOR","CODIGO_PRODUTO","REFERENCIA","DESCRICAO",
    "CATEGORIA","IMEI","QUANTIDADE","TOTAL_LIQUIDO"
]

# === CACHE DE NATUREZAS POR CNPJ ===
NATUREZAS_CACHE = {}
OPER_MAP = {
    "E":  "Entrada",
    "S":  "Saída",
    "DE": "Devolução de Entrada",
    "DS": "Devolução de Saída",
    "N":  "Neutro",
    "C":  "Nota Substitutiva de CF",
}

# ===========================================
# 🧾 LOG
# ===========================================
def setup_logger():
    log_dir = r"C:\Users\Usuario\Desktop\API_LINX\logs"
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"vendas_anual_{datetime.now().strftime('%Y%m%d')}.log")

    logger = logging.getLogger("vendas_anual")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    return logger, log_path

logger, LOG_FILE = setup_logger()
logger.info("=== Início da execução do relatório de vendas (ANO ATÉ MÊS PASSADO) ===")

# ===========================================
# 🔧 CÁLCULO DA DATA FECHADA
# ===========================================
def get_datas_fechadas():
    """
    Calcula:
      - do dia 01/01 do ano atual
      - até o último dia do mês anterior
    Se estivermos em janeiro, mês anterior é dezembro do ano anterior,
    então puxa o ano anterior inteiro.
    """
    agora = datetime.now()

    if agora.month == 1:
        ano_alvo = agora.year - 1
        d_ini = f"{ano_alvo}-01-01"
        d_fim = f"{ano_alvo}-12-31"
    else:
        ano_alvo = agora.year
        mes_anterior = agora.month - 1
        ultimo_dia = calendar.monthrange(ano_alvo, mes_anterior)[1]

        d_ini = f"{ano_alvo}-01-01"
        d_fim = f"{ano_alvo}-{mes_anterior:02d}-{ultimo_dia:02d}"

    return d_ini, d_fim

DATA_INI, DATA_FIM = get_datas_fechadas()
logger.info(f"Período de extração definido: {DATA_INI} até {DATA_FIM}")

# ===========================================
# 🔧 FUNÇÕES DE API E DADOS
# ===========================================
def achar_coluna_tolerante(df, nomes):
    for n in nomes:
        for c in df.columns:
            if n.lower() in c.lower():
                return c
    return None

def _preview_text(s, n=900):
    if not s:
        return ""
    s = str(s)
    return s[:n] + ("..." if len(s) > n else "")

def montar_xml(cnpj, metodo, d_ini, d_fim, parametros=None):
    """
    XML com janela definida (anual até mês passado).
    ✅ Patch: garante timestamp=0 se não for passado.
    """
    if parametros is None:
        parametros = {}

    parametros = dict(parametros)      # cópia
    parametros.setdefault("timestamp", "0")  # ✅ garante

    params = f"""
        <Parameter id="chave">{CHAVE}</Parameter>
        <Parameter id="cnpjEmp">{cnpj}</Parameter>
        <Parameter id="data_inicial">{d_ini}</Parameter>
        <Parameter id="data_fim">{d_fim}</Parameter>
        <Parameter id="hora_inicial">00:00</Parameter>
        <Parameter id="hora_fim">23:59</Parameter>
    """
    for k, v in parametros.items():
        params += f'<Parameter id="{k}">{v}</Parameter>'

    return f"""<?xml version="1.0" encoding="utf-8"?>
<LinxMicrovix>
  <Authentication user="{USUARIO}" password="{SENHA}" />
  <ResponseFormat>xml</ResponseFormat>
  <Command>
    <Name>{metodo}</Name>
    <Parameters>{params}</Parameters>
  </Command>
</LinxMicrovix>"""

def xml_fix(cnpj, metodo, parametros=None):
    """XML sem janela de datas (para métodos baseados em timestamp)."""
    if parametros is None:
        parametros = {}
    params = f"""
        <Parameter id="chave">{CHAVE}</Parameter>
        <Parameter id="cnpjEmp">{cnpj}</Parameter>
    """
    for k, v in parametros.items():
        params += f'<Parameter id="{k}">{v}</Parameter>'
    return f"""<?xml version="1.0" encoding="utf-8"?>
<LinxMicrovix>
  <Authentication user="{USUARIO}" password="{SENHA}" />
  <ResponseFormat>xml</ResponseFormat>
  <Command>
    <Name>{metodo}</Name>
    <Parameters>{params}</Parameters>
  </Command>
</LinxMicrovix>"""

def chamar_api(cnpj, metodo, parametros=None, usa_datas=True):
    """Chama API e retorna DataFrame."""
    if usa_datas:
        xml = montar_xml(cnpj, metodo, DATA_INI, DATA_FIM, parametros)
    else:
        xml = xml_fix(cnpj, metodo, parametros)

    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=180)

        if r.status_code != 200:
            logger.warning(f"Status HTTP {r.status_code} para {metodo} ({cnpj}). Conteúdo: {_preview_text(r.text, 500)}")
            return pd.DataFrame()

        # ✅ remove BOM se vier e parseia com segurança
        content = r.content
        if content.startswith(b"\xef\xbb\xbf"):
            content = content.lstrip(b"\xef\xbb\xbf")

        try:
            root = etree.fromstring(content)
        except Exception as ex_parse:
            logger.warning(f"Falha ao parsear XML em {metodo} ({cnpj}): {ex_parse}. Trecho: {_preview_text(r.text, 900)}")
            return pd.DataFrame()

        ok_nodes = root.xpath(".//ResponseSuccess/text()")
        if ok_nodes and ok_nodes[0].strip().lower() == "false":
            logger.warning(f"API retornou ResponseSuccess=false para {metodo} ({cnpj}). Resposta: {_preview_text(r.text, 900)}")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D") if d.text]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        df = pd.DataFrame(data)

        if df.empty:
            logger.warning(f"API {metodo} ({cnpj}) retornou 0 linhas. Resposta: {_preview_text(r.text, 900)}")
        else:
            logger.info(f"API {metodo} ({cnpj}) retornou {len(df)} linhas. Colunas: {list(df.columns)[:20]}")

        return df

    except Exception as e:
        logger.exception(f"Erro em {metodo} ({cnpj}): {e}")
        return pd.DataFrame()

def carregar_sqlite(path, tabela):
    if not os.path.exists(path):
        logger.warning(f"Cache ausente: {path}")
        return pd.DataFrame()
    conn = sqlite3.connect(path)
    try:
        df = pd.read_sql_query(f"SELECT * FROM {tabela}", conn)
    except Exception as e:
        logger.warning(f"Falha ao ler tabela '{tabela}' de {path}: {e}")
        df = pd.DataFrame()
    conn.close()
    return df

# ------------------ Naturezas ------------------
def carregar_naturezas(cnpj):
    if cnpj in NATUREZAS_CACHE:
        return NATUREZAS_CACHE[cnpj]

    todos = []
    ts = 0
    while True:
        df_nat = chamar_api(cnpj, "LinxNaturezaOperacao", {"timestamp": str(ts)}, usa_datas=False)
        if df_nat.empty:
            break
        df_nat.columns = [c.lower() for c in df_nat.columns]
        keep = [c for c in ["cod_natureza_operacao","descricao","operacao","timestamp"] if c in df_nat.columns]
        if keep:
            todos.append(df_nat[keep].copy())

        if "timestamp" in df_nat.columns:
            try:
                ts = int(pd.to_numeric(df_nat["timestamp"], errors="coerce").max())
            except Exception:
                break
        else:
            break
        time.sleep(0.3)

    if todos:
        nat = pd.concat(todos, ignore_index=True).drop_duplicates(subset=["cod_natureza_operacao"])
    else:
        nat = pd.DataFrame(columns=["cod_natureza_operacao","descricao","operacao"])
    NATUREZAS_CACHE[cnpj] = nat
    return nat

def compor_natureza_operacao(df):
    op_col = achar_coluna_tolerante(df, ["operacao", "operacao_nat"])
    desc_col = achar_coluna_tolerante(df, ["natureza_operacao", "descricao_nat"])

    if op_col:
        op_code = df[op_col].astype(str).str.upper().fillna("")
        df["OPERACAO_TIPO"] = op_code.map(OPER_MAP).fillna(op_code)
    else:
        df["OPERACAO_TIPO"] = None

    if op_col and desc_col:
        df["NATUREZA_OPERACAO"] = "(" + df[op_col].astype(str).str.upper().fillna("") + ") - " + df[desc_col].astype(str)
    return df

# ===========================================
# 🧩 ENRIQUECIMENTO
# ===========================================
def enriquecer(df_mov, cnpj):
    if df_mov.empty:
        return df_mov

    df_mov.columns = [c.lower() for c in df_mov.columns]

    cod_col = achar_coluna_tolerante(df_mov, ["cod_produto", "codigo_produto", "produto"])
    if cod_col and cod_col != "cod_produto":
        df_mov.rename(columns={cod_col: "cod_produto"}, inplace=True)
    df_mov["CODIGO_PRODUTO_ORIGINAL"] = df_mov.get("cod_produto", "").astype(str)

    lojas = carregar_sqlite(CACHE_LOJAS, "lojas_fixas")
    if not lojas.empty:
        lojas.columns = [c.upper() for c in lojas.columns]
        if "cnpj_emp" in df_mov.columns:
            df_mov["cnpj_emp"] = df_mov["cnpj_emp"].astype(str)
        lojas["CNPJ"] = lojas["CNPJ"].astype(str)
        df_mov = pd.merge(df_mov, lojas[["CNPJ", "NOME_FANTASIA"]],
                          left_on="cnpj_emp", right_on="CNPJ", how="left").drop(columns="CNPJ", errors="ignore")

    produtos = carregar_sqlite(CACHE_PRODUTOS, "produtos_completos")
    if not produtos.empty:
        produtos.columns = [c.lower() for c in produtos.columns]
        keep = [c for c in ["cod_produto","referencia","nome","descricao_basica","desc_setor","categoria"] if c in produtos.columns]
        df_mov = pd.merge(df_mov, produtos[keep], on="cod_produto", how="left")
        df_mov["REFERENCIA"] = df_mov.get("referencia")
        df_mov["DESCRICAO"] = df_mov.get("nome").combine_first(df_mov.get("descricao_basica"))
        df_mov["CATEGORIA"] = df_mov.get("desc_setor", df_mov.get("categoria"))

    imei = carregar_sqlite(CACHE_IMEIS, "serial_cache")
    if not imei.empty:
        imei.columns = [c.lower() for c in imei.columns]
        tcol = achar_coluna_tolerante(imei, ["transacao"])
        icol = achar_coluna_tolerante(imei, ["imei", "serial"])
        if tcol and icol and "transacao" in df_mov.columns:
            df_mov = pd.merge(df_mov, imei[[tcol, icol]].rename(columns={icol: "IMEI"}),
                              left_on="transacao", right_on=tcol, how="left").drop(columns=tcol, errors="ignore")

    vendedores = carregar_sqlite(CACHE_VENDEDORES, "vendedores_cache")
    if not vendedores.empty and {"cod_vendedor","cnpj_emp"}.issubset(df_mov.columns):
        vendedores.columns = [c.lower() for c in vendedores.columns]
        df_mov = pd.merge(df_mov, vendedores, how="left",
                          left_on=["cod_vendedor", "cnpj_emp"],
                          right_on=["cod_vendedor", "cnpj_origem"]
                          ).drop(columns="cnpj_origem", errors="ignore")

    campo_tipo = achar_coluna_tolerante(df_mov, ["tipo_transacao"])
    if campo_tipo:
        df_mov.rename(columns={campo_tipo: "TIPO_TRANSACAO"}, inplace=True)
        mapa_tipos = {
            "J": "Ajuste de Estoque", "P": "Faturamento de Pedido", "S": "Normal", "": "Normal",
            "E": "Entrada", "D": "Transferência entre Depósitos", "T": "Transferência entre Filiais",
            "R": "Reserva de Estoque", "V": "Venda", "C": "Nota Substitutiva de CF",
            "I": "Complemento ICMS", "M": "Manufatura", "A": "Faturamento de OS", "O": "Baixa de Consumo de OS"
        }
        df_mov["TIPO_TRANSACAO"] = df_mov["TIPO_TRANSACAO"].fillna("").map(mapa_tipos).fillna("Normal")

    campo_op = achar_coluna_tolerante(df_mov, ["operacao"])
    campo_nat_txt = achar_coluna_tolerante(df_mov, ["natureza_operacao"])
    if campo_op:
        df_mov.rename(columns={campo_op: "operacao"}, inplace=True)
    if campo_nat_txt:
        df_mov.rename(columns={campo_nat_txt: "natureza_operacao"}, inplace=True)
    if "operacao" in df_mov.columns or "natureza_operacao" in df_mov.columns:
        df_mov = compor_natureza_operacao(df_mov)

    if "NATUREZA_OPERACAO" not in df_mov.columns:
        cod_nat_col = achar_coluna_tolerante(df_mov, ["cod_natureza_operacao", "cod_nat_operacao", "natureza"])
        if cod_nat_col:
            nat = carregar_naturezas(cnpj)
            if not nat.empty:
                nat_ren = nat.rename(columns={"descricao": "descricao_nat", "operacao": "operacao_nat"})
                df_mov = pd.merge(df_mov, nat_ren, how="left",
                                  left_on=cod_nat_col, right_on="cod_natureza_operacao")
                df_mov = compor_natureza_operacao(df_mov)

    if "NATUREZA_OPERACAO" not in df_mov.columns:
        pedidos = chamar_api(cnpj, "LinxPedidosVenda", parametros=None, usa_datas=True)
        if not pedidos.empty:
            pedidos.columns = [c.lower() for c in pedidos.columns]
            if "documento" in pedidos.columns and "natureza_operacao" in pedidos.columns and "documento" in df_mov.columns:
                df_mov = pd.merge(df_mov, pedidos[["documento", "natureza_operacao"]], on="documento", how="left")
                df_mov.rename(columns={"natureza_operacao": "NATUREZA_OPERACAO"}, inplace=True)

    campo_hora = achar_coluna_tolerante(df_mov, ["hora_lancamento"])
    if campo_hora:
        df_mov.rename(columns={campo_hora: "HORA"}, inplace=True)
    else:
        df_mov["HORA"] = None

    df_mov["CODIGO_PRODUTO"] = df_mov["CODIGO_PRODUTO_ORIGINAL"]
    return df_mov

# ===========================================
# 🧾 EXECUÇÃO
# ===========================================
todos = []
logger.info(f"Extração multi-CNPJ (vendas de {DATA_INI} até {DATA_FIM}) para {len(CNPJS)} CNPJs.")

for cnpj in CNPJS:
    logger.info("Buscando vendas para CNPJ %s ...", cnpj)

    # ✅ timestamp=0 é injetado automaticamente pelo montar_xml()
    df = chamar_api(cnpj, "LinxMovimento", parametros=None, usa_datas=True)

    if not df.empty:
        df["CNPJ_ORIGEM"] = cnpj
        df = enriquecer(df, cnpj)
        logger.info("CNPJ %s enriquecido com %d linhas.", cnpj, len(df))
        todos.append(df)
    else:
        logger.warning("Nenhum dado retornado para %s neste período.", cnpj)

    time.sleep(2)

if not todos:
    logger.error("Nenhum dado retornado em nenhum CNPJ. Encerrando.")
    print("❌ Nenhum dado retornado em nenhum CNPJ.")
    sys.exit(1)

df_final = pd.concat(todos, ignore_index=True)

# ===========================================
# 🔢 CONVERSÕES E EXPORTAÇÃO
# ===========================================
df_final.columns = [c.upper() for c in df_final.columns]
df_final.rename(columns={
    "DOCUMENTO": "NOTA_FISCAL",
    "DATA_DOCUMENTO": "DATA_EMISSAO",
    "VALOR_LIQUIDO": "TOTAL_LIQUIDO"
}, inplace=True)

for c in COLUNAS_FINAIS:
    if c not in df_final.columns:
        df_final[c] = None

def to_float_safe(series):
    return pd.to_numeric(series.astype(str)
        .str.replace(",", ".", regex=False)
        .str.replace(r"[^\d\.\-]", "", regex=True),
        errors="coerce"
    )

for col in ["TOTAL_LIQUIDO", "QUANTIDADE"]:
    if col in df_final.columns:
        df_final[col] = to_float_safe(df_final[col])

if "DATA_EMISSAO" in df_final.columns:
    df_final["DATA_EMISSAO"] = pd.to_datetime(df_final["DATA_EMISSAO"], errors="coerce").dt.strftime("%d/%m/%Y")

df_saida = df_final[COLUNAS_FINAIS].copy()
df_saida = df_saida.loc[:, ~df_saida.columns.duplicated()].copy()

linhas_preparadas = len(df_saida)
logger.info("Linhas preparadas para inserção no .db: %d", linhas_preparadas)

# ===========================================
# 🔁 ATUALIZAÇÃO DO BANCO (SOBRESCREVE TUDO)
# ===========================================
conn = sqlite3.connect(DB_DEST_PATH)
cur = conn.cursor()

try:
    cur.execute("SELECT 1 FROM vendas LIMIT 1")
except Exception:
    df_saida.head(0).to_sql("vendas", conn, if_exists="append", index=False)
    logger.info("Tabela 'vendas' criada no SQLite.")

logger.info("Apagando dados antigos da tabela 'vendas' para evitar duplicatas...")
try:
    cur.execute("DELETE FROM vendas")
    deletadas = cur.rowcount
    logger.info("Linhas removidas: %d", deletadas)
except Exception as e:
    logger.warning(f"Erro ao limpar banco: {e}")

conn.commit()

df_saida.to_sql("vendas", conn, if_exists="append", index=False)
conn.close()

logger.info("Banco SQLite atualizado.")
logger.info("Total inserido: %d linhas.", linhas_preparadas)
logger.info("=== Fim da execução. Log salvo em: %s ===", LOG_FILE)

print(f"💾 Banco SQLite atualizado: {DB_DEST_PATH}")
print(f"📦 Total inserido: {linhas_preparadas} linhas referentes ao período {DATA_INI} a {DATA_FIM}.")
print("\n✅ Processo concluído com sucesso!")