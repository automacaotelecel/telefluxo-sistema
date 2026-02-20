# ===========================================
# ⚡ CÓDIGO USADO PARA BAIXAR AS VENDAS ATRAVÉS DA API
# O CÓDIGO  PARA ENVIAR AO SISTEMA É OUTRO.
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
import pandas as pd
from lxml import etree
from datetime import datetime
import sqlite3, os, time
import sys

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

# === BANCOS LOCAIS (caches) ===
CACHE_PRODUTOS   = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\produtos_completos.db"
CACHE_LOJAS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\lojas_fixas.db"
CACHE_IMEIS      = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\serial_cache.db"
CACHE_VENDEDORES = r"C:\Users\Usuario\Desktop\API_LINX\data_bases\vendedores_cache.db"

# === DESTINO DO SQLITE FINAL (NOVO) ===
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
# 🔧 META: detectar primeira execução
# ===========================================

def ensure_meta_table(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_meta (
            k TEXT PRIMARY KEY,
            v TEXT
        )
    """)
    conn.commit()

def get_meta(conn: sqlite3.Connection, key: str):
    cur = conn.execute("SELECT v FROM sync_meta WHERE k = ?", (key,))
    row = cur.fetchone()
    return row[0] if row else None

def set_meta(conn: sqlite3.Connection, key: str, value: str):
    conn.execute(
        "INSERT INTO sync_meta (k, v) VALUES (?, ?) "
        "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (key, value)
    )
    conn.commit()

def is_first_full_load(conn: sqlite3.Connection) -> bool:
    ensure_meta_table(conn)
    return get_meta(conn, "full_loaded") != "1"

def today_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def today_br() -> str:
    return datetime.now().strftime("%d/%m/%Y")

# ===========================================
# 🔧 FUNÇÕES DE API E DADOS
# ===========================================

def achar_coluna_tolerante(df, nomes):
    for n in nomes:
        for c in df.columns:
            if n.lower() in c.lower():
                return c
    return None

def montar_xml(cnpj, metodo, d_ini, d_fim, parametros=None):
    """XML com janela definida (data_ini -> data_fim)."""
    if parametros is None:
        parametros = {}

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
            <Command><Name>{metodo}</Name><Parameters>{params}</Parameters></Command>
        </LinxMicrovix>"""

def xml_fix(cnpj, metodo, parametros=None):
    """XML sem janela de datas (para métodos timestamp)."""
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
            <Command><Name>{metodo}</Name><Parameters>{params}</Parameters></Command>
        </LinxMicrovix>"""

def chamar_api(cnpj, metodo, parametros=None, usa_datas=True, d_ini=None, d_fim=None):
    """Chama API e retorna DataFrame."""
    if usa_datas:
        if not d_ini or not d_fim:
            raise ValueError("d_ini e d_fim são obrigatórios quando usa_datas=True")
        xml = montar_xml(cnpj, metodo, d_ini, d_fim, parametros)
    else:
        xml = xml_fix(cnpj, metodo, parametros)

    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=180)
        if r.status_code != 200:
            print(f"[WARN] Status HTTP {r.status_code} para {metodo} ({cnpj}).")
            return pd.DataFrame()

        root = etree.fromstring(r.content)
        ok_nodes = root.xpath(".//ResponseSuccess/text()")
        if ok_nodes and ok_nodes[0].lower() == "false":
            print(f"[WARN] API retornou False para {metodo} ({cnpj}).")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D") if d.text]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        df = pd.DataFrame(data)
        print(f"[INFO] API {metodo} ({cnpj}) retornou {len(df)} linhas.")
        return df
    except Exception as e:
        print(f"[ERRO] Falha em {metodo} ({cnpj}): {e}")
        return pd.DataFrame()

def carregar_sqlite(path, tabela):
    if not os.path.exists(path):
        print(f"[WARN] Cache ausente: {path}")
        return pd.DataFrame()
    conn = sqlite3.connect(path)
    try:
        df = pd.read_sql_query(f"SELECT * FROM {tabela}", conn)
    except Exception:
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
        df_mov = pd.merge(df_mov, lojas[["CNPJ", "NOME_FANTASIA"]],
                          left_on="cnpj_emp", right_on="CNPJ", how="left").drop(columns="CNPJ", errors="ignore")

    # --- Produtos ---
    produtos = carregar_sqlite(CACHE_PRODUTOS, "produtos_completos")
    if not produtos.empty:
        produtos.columns = [c.lower() for c in produtos.columns]
        keep = [c for c in ["cod_produto","referencia","nome","descricao_basica","desc_setor","categoria"] if c in produtos.columns]
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
            df_mov = pd.merge(df_mov, imei[[tcol, icol]].rename(columns={icol: "IMEI"}),
                              left_on="transacao", right_on=tcol, how="left").drop(columns=tcol, errors="ignore")

    # --- Vendedores ---
    vendedores = carregar_sqlite(CACHE_VENDEDORES, "vendedores_cache")
    if not vendedores.empty and {"cod_vendedor","cnpj_emp"}.issubset(df_mov.columns):
        vendedores.columns = [c.lower() for c in vendedores.columns]
        df_mov = pd.merge(df_mov, vendedores, how="left",
                          left_on=["cod_vendedor", "cnpj_emp"],
                          right_on=["cod_vendedor", "cnpj_origem"]
                          ).drop(columns="cnpj_origem", errors="ignore")

    # --- Tipo de Transação ---
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
                df_mov = pd.merge(df_mov, nat_ren, how="left",
                                  left_on=cod_nat_col, right_on="cod_natureza_operacao")
                df_mov = compor_natureza_operacao(df_mov)

    # Fallback LinxPedidosVenda (pode ser pesado)
    if "NATUREZA_OPERACAO" not in df_mov.columns:
        pedidos = chamar_api(cnpj, "LinxPedidosVenda", parametros=None, usa_datas=True, d_ini=DATA_INI, d_fim=DATA_FIM)
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
# 🧾 DEFINIÇÃO DO PERÍODO (1a vez vs diário)
# ===========================================

conn_meta = sqlite3.connect(DB_DEST_PATH)
primeira_vez = is_first_full_load(conn_meta)
conn_meta.close()

if primeira_vez:
    DATA_INI = "2024-01-01"
    DATA_FIM = today_iso()
    print(f"[INFO] Primeira execução detectada. Carga histórica: {DATA_INI} até {DATA_FIM}")
else:
    DATA_INI = today_iso()
    DATA_FIM = today_iso()
    print(f"[INFO] Execução diária. Buscando somente HOJE: {DATA_INI}")

# ===========================================
# 🧾 EXECUÇÃO (multi-CNPJ)
# ===========================================

todos = []
print(f"[INFO] Extração para {len(CNPJS)} CNPJs...")

for cnpj in CNPJS:
    print(f"[INFO] Buscando vendas para CNPJ {cnpj} ({DATA_INI} até {DATA_FIM}) ...")

    df = chamar_api(cnpj, "LinxMovimento", parametros=None, usa_datas=True, d_ini=DATA_INI, d_fim=DATA_FIM)

    if not df.empty:
        df["CNPJ_ORIGEM"] = cnpj
        df = enriquecer(df, cnpj)
        print(f"[INFO] CNPJ {cnpj} enriquecido com {len(df)} linhas.")
        todos.append(df)
    else:
        print(f"[WARN] Nenhum dado retornado para {cnpj} neste período.")

    time.sleep(2)

if not todos:
    print("❌ Nenhum dado retornado em nenhum CNPJ.")
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
    return pd.to_numeric(series.astype(str)
        .str.replace(",", ".", regex=False)
        .str.replace(r"[^\d\.\-]", "", regex=True),
        errors="coerce"
    )

for col in ["TOTAL_LIQUIDO", "QUANTIDADE"]:
    if col in df_final.columns:
        df_final[col] = to_float_safe(df_final[col])

# Padroniza para DD/MM/YYYY (como você já usa no banco)
if "DATA_EMISSAO" in df_final.columns:
    df_final["DATA_EMISSAO"] = pd.to_datetime(df_final["DATA_EMISSAO"], errors="coerce").dt.strftime("%d/%m/%Y")

df_saida = df_final[COLUNAS_FINAIS].copy()
df_saida = df_saida.loc[:, ~df_saida.columns.duplicated()].copy()

linhas_preparadas = len(df_saida)
print(f"[INFO] Linhas preparadas para inserção: {linhas_preparadas}")

# ===========================================
# 🔁 ATUALIZAÇÃO DO BANCO (1a vez vs diário)
# ===========================================

conn = sqlite3.connect(DB_DEST_PATH)
cur = conn.cursor()

# garante tabela vendas
try:
    cur.execute("SELECT 1 FROM vendas LIMIT 1")
except Exception:
    df_saida.head(0).to_sql("vendas", conn, if_exists="append", index=False)
    print("[INFO] Tabela 'vendas' criada.")

# garante meta
ensure_meta_table(conn)

try:
    if primeira_vez:
        # Primeira carga: zerar para evitar qualquer duplicata histórica
        print("[INFO] Limpando tabela 'vendas' (primeira carga)...")
        cur.execute("DELETE FROM vendas")
        print(f"[INFO] Linhas removidas: {cur.rowcount}")
    else:
        # Diário: apaga somente HOJE (DATA_EMISSAO em DD/MM/YYYY)
        hoje = today_br()
        print(f"[INFO] Removendo dados de HOJE ({hoje}) para evitar duplicatas...")
        cur.execute("DELETE FROM vendas WHERE DATA_EMISSAO = ?", (hoje,))
        print(f"[INFO] Linhas removidas hoje: {cur.rowcount}")

    conn.commit()
except Exception as e:
    print(f"[WARN] Erro ao limpar dados antes do insert: {e}")
    conn.commit()

# Insere novo lote
df_saida.to_sql("vendas", conn, if_exists="append", index=False)

# marca meta
set_meta(conn, "full_loaded", "1")
set_meta(conn, "last_run_date", today_iso())

conn.close()

print(f"✅ Banco SQLite atualizado: {DB_DEST_PATH}")
print(f"📌 Período usado: {DATA_INI} até {DATA_FIM}")
print(f"📦 Total inserido: {linhas_preparadas}")
