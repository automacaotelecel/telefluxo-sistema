# ===========================================
# ⚡ RELATÓRIO DE COMPRAS MICROVIX – ANUAL (ACUMULADO DO ANO ATUAL)
# Andre – Versão Ajustada para Auditoria
# Puxa do dia 01/01 do ano atual até HOJE.
# Lógica: Mantém APENAS notas de entrada/compra e salva em um DB isolado.
# Ralatório para verificar se todas as peças compradas estão no estoque.
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
import pandas as pd
from lxml import etree
from datetime import datetime
import sqlite3, os, time
import logging
import sys
import re
import unicodedata

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

# === BANCOS LOCAIS (CACHES) ===
CACHE_PRODUTOS   = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\produtos_completos.db"
CACHE_LOJAS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\lojas_fixas.db"
CACHE_IMEIS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\serial_cache.db"
CACHE_VENDEDORES = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\vendedores_cache.db"

# === DIRETÓRIO DO NOVO BANCO DE COMPRAS ===
DB_COMPRAS_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\compras"
os.makedirs(DB_COMPRAS_DIR, exist_ok=True)
DB_COMPRAS_PATH = os.path.join(DB_COMPRAS_DIR, "compras_anual.db")

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
    log_path = os.path.join(log_dir, f"compras_anual_{datetime.now().strftime('%Y%m%d')}.log")

    logger = logging.getLogger("compras_anual")
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
logger.info("=== Início da extração de COMPRAS (ANO ATUAL) ===")

# ===========================================
# 🔧 FUNÇÕES AUXILIARES DE DATA
# ===========================================
def get_datas_ano():
    """Retorna (data_ini_iso, data_fim_iso) para o ano inteiro"""
    agora = datetime.now()
    primeiro_dia_ano = agora.replace(month=1, day=1)

    d_ini = primeiro_dia_ano.strftime("%Y-%m-%d")
    d_fim = agora.strftime("%Y-%m-%d")

    return d_ini, d_fim

DATA_INI, DATA_FIM = get_datas_ano()
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

def normalizar_texto(valor):
    if pd.isna(valor):
        return ""
    valor = str(valor).strip().upper()
    valor = unicodedata.normalize("NFKD", valor)
    valor = "".join(ch for ch in valor if not unicodedata.combining(ch))
    valor = re.sub(r"\s+", " ", valor)
    return valor

def montar_xml(cnpj, metodo, d_ini, d_fim, parametros=None):
    if parametros is None:
        parametros = {}

    parametros = dict(parametros)
    parametros.setdefault("timestamp", "0")

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
    if usa_datas:
        xml = montar_xml(cnpj, metodo, DATA_INI, DATA_FIM, parametros)
    else:
        xml = xml_fix(cnpj, metodo, parametros)

    try:
        r = requests.post(
            URL,
            data=xml.encode("utf-8"),
            headers=headers,
            auth=auth,
            timeout=180
        )

        if r.status_code != 200:
            logger.warning(f"Status HTTP {r.status_code} para {metodo} ({cnpj}).")
            return pd.DataFrame()

        content = r.content
        if content.startswith(b"\xef\xbb\xbf"):
            content = content.lstrip(b"\xef\xbb\xbf")

        try:
            root = etree.fromstring(content)
        except Exception as ex_parse:
            logger.warning(f"Falha ao parsear XML em {metodo} ({cnpj}): {ex_parse}")
            return pd.DataFrame()

        ok_nodes = root.xpath(".//ResponseSuccess/text()")
        if ok_nodes and ok_nodes[0].strip().lower() == "false":
            logger.warning(f"API retornou ResponseSuccess=false para {metodo} ({cnpj}).")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D") if d.text]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        df = pd.DataFrame(data)

        if not df.empty:
            logger.info(f"API {metodo} ({cnpj}) retornou {len(df)} linhas.")

        return df

    except Exception as e:
        logger.exception(f"Erro em {metodo} ({cnpj}): {e}")
        return pd.DataFrame()

def carregar_sqlite(path, tabela):
    if not os.path.exists(path):
        return pd.DataFrame()
    conn = sqlite3.connect(path)
    try:
        df = pd.read_sql_query(f"SELECT * FROM {tabela}", conn)
    except Exception as e:
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
        keep = [c for c in ["cod_natureza_operacao", "descricao", "operacao", "timestamp"] if c in df_nat.columns]
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
        nat = pd.DataFrame(columns=["cod_natureza_operacao", "descricao", "operacao"])
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

    # --- Produto ---
    cod_col = achar_coluna_tolerante(df_mov, ["cod_produto", "codigo_produto", "produto"])
    if cod_col and cod_col != "cod_produto":
        df_mov.rename(columns={cod_col: "cod_produto"}, inplace=True)
    df_mov["CODIGO_PRODUTO_ORIGINAL"] = df_mov.get("cod_produto", "").astype(str)

    # --- Lojas ---
    lojas = carregar_sqlite(CACHE_LOJAS, "lojas_fixas")
    if not lojas.empty:
        lojas.columns = [c.upper() for c in lojas.columns]
        if "cnpj_emp" in df_mov.columns:
            df_mov["cnpj_emp"] = df_mov["cnpj_emp"].astype(str)
        lojas["CNPJ"] = lojas["CNPJ"].astype(str)
        df_mov = pd.merge(
            df_mov,
            lojas[["CNPJ", "NOME_FANTASIA"]],
            left_on="cnpj_emp",
            right_on="CNPJ",
            how="left"
        ).drop(columns="CNPJ", errors="ignore")

    # --- Produtos ---
    produtos = carregar_sqlite(CACHE_PRODUTOS, "produtos_completos")
    if not produtos.empty:
        produtos.columns = [c.lower() for c in produtos.columns]
        keep = [c for c in ["cod_produto", "referencia", "nome", "descricao_basica", "desc_setor", "categoria"] if c in produtos.columns]
        df_mov = pd.merge(df_mov, produtos[keep], on="cod_produto", how="left")
        df_mov["REFERENCIA"] = df_mov.get("referencia")
        df_mov["DESCRICAO"] = df_mov.get("nome").combine_first(df_mov.get("descricao_basica"))
        df_mov["CATEGORIA"] = df_mov.get("desc_setor", df_mov.get("categoria"))

    # --- IMEIs ---
    imei = carregar_sqlite(CACHE_IMEIS, "serial_cache")
    if not imei.empty:
        imei.columns = [c.lower() for c in imei.columns]
        tcol = achar_coluna_tolerante(imei, ["transacao"])
        icol = achar_coluna_tolerante(imei, ["imei", "serial"])
        if tcol and icol and "transacao" in df_mov.columns:
            df_mov = pd.merge(
                df_mov,
                imei[[tcol, icol]].rename(columns={icol: "IMEI"}),
                left_on="transacao",
                right_on=tcol,
                how="left"
            ).drop(columns=tcol, errors="ignore")

    # --- Vendedores ---
    vendedores = carregar_sqlite(CACHE_VENDEDORES, "vendedores_cache")
    if not vendedores.empty and {"cod_vendedor", "cnpj_emp"}.issubset(df_mov.columns):
        vendedores.columns = [c.lower() for c in vendedores.columns]
        df_mov = pd.merge(
            df_mov,
            vendedores,
            how="left",
            left_on=["cod_vendedor", "cnpj_emp"],
            right_on=["cod_vendedor", "cnpj_origem"]
        ).drop(columns="cnpj_origem", errors="ignore")

    # --- Tipo de Transação ---
    campo_tipo = achar_coluna_tolerante(df_mov, ["tipo_transacao"])
    if campo_tipo:
        df_mov.rename(columns={campo_tipo: "TIPO_TRANSACAO"}, inplace=True)
        mapa_tipos = {
            "J": "Ajuste de Estoque",
            "P": "Faturamento de Pedido",
            "S": "Normal",
            "": "Normal",
            "E": "Entrada",
            "D": "Transferência entre Depósitos",
            "T": "Transferência entre Filiais",
            "R": "Reserva de Estoque",
            "V": "Venda",
            "C": "Nota Substitutiva de CF",
            "I": "Complemento ICMS",
            "M": "Manufatura",
            "A": "Faturamento de OS",
            "O": "Baixa de Consumo de OS"
        }
        df_mov["TIPO_TRANSACAO"] = df_mov["TIPO_TRANSACAO"].fillna("").map(mapa_tipos).fillna("Normal")

    # --- Natureza / Operação ---
    campo_op = achar_coluna_tolerante(df_mov, ["operacao"])
    campo_nat_txt = achar_coluna_tolerante(df_mov, ["natureza_operacao"])
    if campo_op:
        df_mov.rename(columns={campo_op: "operacao"}, inplace=True)
    if campo_nat_txt:
        df_mov.rename(columns={campo_nat_txt: "natureza_operacao"}, inplace=True)
    if "operacao" in df_mov.columns or "natureza_operacao" in df_mov.columns:
        df_mov = compor_natureza_operacao(df_mov)

    # Fallback LinxNaturezaOperacao
    if "NATUREZA_OPERACAO" not in df_mov.columns:
        cod_nat_col = achar_coluna_tolerante(df_mov, ["cod_natureza_operacao", "cod_nat_operacao", "natureza"])
        if cod_nat_col:
            nat = carregar_naturezas(cnpj)
            if not nat.empty:
                nat_ren = nat.rename(columns={"descricao": "descricao_nat", "operacao": "operacao_nat"})
                df_mov = pd.merge(
                    df_mov,
                    nat_ren,
                    how="left",
                    left_on=cod_nat_col,
                    right_on="cod_natureza_operacao"
                )
                df_mov = compor_natureza_operacao(df_mov)

    campo_hora = achar_coluna_tolerante(df_mov, ["hora_lancamento"])
    if campo_hora:
        df_mov.rename(columns={campo_hora: "HORA"}, inplace=True)
    else:
        df_mov["HORA"] = None

    df_mov["CODIGO_PRODUTO"] = df_mov["CODIGO_PRODUTO_ORIGINAL"]
    return df_mov

# ===========================================
# 🎯 FILTRO EXCLUSIVO DE COMPRAS
# ===========================================
def manter_apenas_compras(df, cnpj=None):
    if df.empty:
        return df

    colunas_verificacao = ["TIPO_TRANSACAO", "NATUREZA_OPERACAO", "OPERACAO_TIPO"]
    colunas_existentes = [c for c in colunas_verificacao if c in df.columns]

    if not colunas_existentes:
        logger.warning("Nenhuma coluna de verificação encontrada para aplicar filtro de compras.")
        return pd.DataFrame(columns=df.columns) # Retorna vazio se não puder avaliar

    texto_combinado = pd.Series("", index=df.index, dtype="object")
    for col in colunas_existentes:
        texto_combinado = texto_combinado + " " + df[col].fillna("").astype(str).map(normalizar_texto)

    # Verifica se a natureza contém a palavra COMPRA ou MERCADORIAS PARA REVENDA
    mask_compra = (
        texto_combinado.str.contains("COMPRA", na=False) |
        texto_combinado.str.contains("ENTRADA", na=False) | # Adicionado para pegar todas as entradas
        texto_combinado.str.contains("MERCADORIAS PARA REVENDA", na=False)
    )

    df_filtrado = df.loc[mask_compra].copy()
    
    if cnpj:
        logger.info("CNPJ %s: %d linhas MANTIDAS (são compras/entradas).", cnpj, len(df_filtrado))

    return df_filtrado

# ===========================================
# 🧾 EXECUÇÃO
# ===========================================
todos = []
logger.info(f"Extração multi-CNPJ (COMPRAS de {DATA_INI} até {DATA_FIM}) para {len(CNPJS)} CNPJs.")

for cnpj in CNPJS:
    logger.info("Buscando dados do ANO ATUAL para CNPJ %s ...", cnpj)
    df = chamar_api(cnpj, "LinxMovimento", parametros=None, usa_datas=True)

    if not df.empty:
        df["CNPJ_ORIGEM"] = cnpj
        df = enriquecer(df, cnpj)
        
        # ✅ Filtra para manter APENAS as compras
        df = manter_apenas_compras(df, cnpj)

        if not df.empty:
            todos.append(df)
    else:
        logger.warning("Nenhum dado retornado para %s neste período.", cnpj)

    time.sleep(2)

if not todos:
    logger.error("Nenhuma COMPRA retornada em nenhum CNPJ. Encerrando.")
    print("❌ Nenhuma COMPRA retornada no ano em nenhum CNPJ.")
    raise SystemExit(1)

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
    return pd.to_numeric(
        series.astype(str)
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
logger.info("Linhas preparadas para inserção no DB exclusivo de compras: %d", linhas_preparadas)

# ===========================================
# 🔁 ATUALIZAÇÃO DO BANCO (RECRIA A TABELA ANUAL)
# ===========================================
conn = sqlite3.connect(DB_COMPRAS_PATH)
try:
    # Salva substituindo tudo, pois extraímos o ano inteiro. Isso evita duplicatas.
    df_saida.to_sql("compras", conn, if_exists="replace", index=False)
    logger.info("Banco SQLite de compras atualizado/recriado com sucesso no caminho: %s", DB_COMPRAS_PATH)
except Exception as e:
    logger.error("Erro ao salvar no banco SQLite: %s", e)
finally:
    conn.close()

logger.info("Total inserido: %d linhas.", linhas_preparadas)
logger.info("=== Fim da execução. Log salvo em: %s ===", LOG_FILE)

print(f"✅ Relatório ANUAL de COMPRAS concluído. Salvo em: {DB_COMPRAS_PATH}")