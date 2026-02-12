import os
import re
import sqlite3
from datetime import datetime, date
import pandas as pd
import xml.etree.ElementTree as ET

from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context
from zeep import Client
from zeep.transports import Transport

WSDL_URL = "https://www.bestflowserver.com.br/samsung/service/soap/bestflow.php?wsdl"
DS_LOGIN = os.getenv("BESTFLOW_LOGIN", "mrf.ws")
DS_SENHA = os.getenv("BESTFLOW_SENHA", "424DAsp2LZ@c")

TIMEOUT = 60

# ============================================================
# ✅ CONFIGURAÇÃO DE CAMINHOS (UNIVERSAL: PC E RENDER)
# ============================================================
# Identifica onde este arquivo python está rodando
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Se a pasta 'database' existir ao lado do script, usa ela. Se não, usa a própria pasta.
if os.path.exists(os.path.join(BASE_DIR, "database")):
    DB_DIR = os.path.join(BASE_DIR, "database")
else:
    DB_DIR = BASE_DIR

DB_PATH = os.path.join(DB_DIR, "bestflow.db")
SAMSUNG_VENDAS_DB_PATH = os.path.join(DB_DIR, "samsung_vendas.db")

print(f"📂 Diretório de Banco: {DB_DIR}")
print(f"📂 Caminho Bestflow: {DB_PATH}")

# ✅ config tabela/colunas do samsung_vendas.db
TBL_VENDAS = "vendas"
COL_DATA_VENDA = "DATA_EMISSAO"
COL_LOJA_VENDA = "CNPJ_EMPRESA"

# ✅ Colunas preferenciais (novas) + fallback (antigas)
COL_QTD_VENDA_PREFER = "QTD_REAL"
COL_VALOR_VENDA_PREFER = "TOTAL_REAL"
COL_QTD_VENDA_FALLBACK = "QUANTIDADE"
COL_VALOR_VENDA_FALLBACK = "TOTAL_LIQUIDO"

LOJAS_MAP = {
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
}

# ============================================================
# SSL Adapter (para compatibilidade TLS)
# ============================================================
class LegacySSLAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        ctx = create_urllib3_context()
        ctx.load_default_certs()
        try:
            ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        except Exception:
            pass
        pool_kwargs["ssl_context"] = ctx
        return super().init_poolmanager(connections, maxsize, block, **pool_kwargs)

# ============================================================
# Helpers
# ============================================================
def digits_only(x) -> str:
    return re.sub(r"\D+", "", "" if x is None else str(x))

def parse_any_datetime(s: str):
    if not s:
        return pd.NaT
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return pd.to_datetime(s, errors="coerce", dayfirst=True)

def parse_data_mista(series: pd.Series) -> pd.Series:
    """
    Parse robusto:
    - ISO: YYYY-MM-DD (ou YYYY-MM-DD HH:MM:SS) => parse como ISO (sem dayfirst)
    - Senão => tenta dayfirst=True
    """
    s = series.astype(str).str.strip()
    iso = s.str.match(r"^\d{4}-\d{2}-\d{2}")
    out = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")

    out.loc[iso] = pd.to_datetime(s.loc[iso].str.slice(0, 10), errors="coerce", format="%Y-%m-%d")
    out.loc[~iso] = pd.to_datetime(s.loc[~iso], errors="coerce", dayfirst=True)

    return out

def quote_ident(name: str) -> str:
    name = str(name).replace('"', '""')
    return f'"{name}"'

# ============================================================
# Bestflow: parse
# ============================================================
def parse_contagem(xml_text: str) -> pd.DataFrame:
    xml_text = (xml_text or "").strip()
    if not xml_text:
        return pd.DataFrame()

    root = ET.fromstring(xml_text)
    rows = []
    for c in root.findall(".//CONTAGEM"):
        row = {}
        for k, v in c.attrib.items():
            row[k.lower()] = (v or "").strip()
        for child in list(c):
            row[(child.tag or "").strip().lower()] = (child.text or "").strip()
        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["entradas"] = pd.to_numeric(df.get("entradas", 0), errors="coerce").fillna(0).astype(int)
    df["saidas"]   = pd.to_numeric(df.get("saidas", 0), errors="coerce").fillna(0).astype(int)

    # cnpj14
    id_col = "idloja" if "idloja" in df.columns else None
    if not id_col:
        for c in df.columns:
            if "idloja" in c.lower() or "cnpj" in c.lower():
                id_col = c
                break
    if not id_col:
        raise ValueError("Não encontrei coluna idloja/cnpj no XML.")

    df["cnpj14"] = df[id_col].apply(digits_only).str[:14]
    df["loja"] = df["cnpj14"].map(LOJAS_MAP).fillna(df.get("nome_loja", ""))

    # data/hora
    dt_col = "datahora_inicio" if "datahora_inicio" in df.columns else None
    if dt_col is None:
        for c in df.columns:
            if "inicio" in c.lower():
                dt_col = c
                break
    if dt_col is None:
        dt_col = "dataliberacaofluxo" if "dataliberacaofluxo" in df.columns else df.columns[0]

    df["_dt"] = df[dt_col].apply(parse_any_datetime)
    df["data"] = pd.to_datetime(df["_dt"], errors="coerce").dt.date.astype(str)

    return df

def resumo_diario(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby(["data", "cnpj14", "loja"], as_index=False)[["entradas", "saidas"]]
          .sum()
          .sort_values(["data", "loja"])
          .reset_index(drop=True)
    )

# ============================================================
# Bestflow DB: upsert do fluxo
# ============================================================
def upsert_sqlite(db_path: str, summary: pd.DataFrame):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS resumo_diario (
        data   TEXT NOT NULL,
        cnpj14 TEXT NOT NULL,
        loja   TEXT NOT NULL,
        entradas INTEGER NOT NULL,
        saidas   INTEGER NOT NULL,
        PRIMARY KEY (data, cnpj14)
    )
    """)

    for _, r in summary.iterrows():
        cur.execute("""
        INSERT INTO resumo_diario (data, cnpj14, loja, entradas, saidas)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(data, cnpj14) DO UPDATE SET
            loja=excluded.loja,
            entradas=excluded.entradas,
            saidas=excluded.saidas
        """, (r["data"], r["cnpj14"], r["loja"], int(r["entradas"]), int(r["saidas"])))

    conn.commit()
    conn.close()

# ============================================================
# Período
# ============================================================
def periodo_mes_atual_ptbr():
    hoje = date.today()
    ini = date(hoje.year, hoje.month, 1)
    return ini.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y")

# ============================================================
# Bestflow: fetch
# ============================================================
def fetch_xml(dt_ini: str, dt_fim: str) -> str:
    session = Session()
    session.mount("https://", LegacySSLAdapter())
    transport = Transport(session=session, timeout=TIMEOUT, operation_timeout=TIMEOUT)
    client = Client(WSDL_URL, transport=transport)
    return str(client.service.obterContagem(DS_LOGIN, DS_SENHA, dt_ini, dt_fim) or "")

# ============================================================
# Vendas: leitura SOMENTE LEITURA + agregação
# ============================================================
def carregar_vendas_agregadas_por_dia_loja(samsung_db_path: str) -> pd.DataFrame:
    """
    Lê o samsung_vendas.db em modo READ ONLY e retorna vendas agregadas por (data, cnpj14).
    - Parse robusto de data (ISO/BR) para casar com o bestflow
    - Usa QTD_REAL/TOTAL_REAL se existirem; se não, QUANTIDADE/TOTAL_LIQUIDO
    """
    uri = "file:" + samsung_db_path.replace("\\", "/") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({quote_ident(TBL_VENDAS)})").fetchall()]
        if not cols:
            cols = [r[1] for r in con.execute(f"PRAGMA table_info({TBL_VENDAS})").fetchall()]

        qtd_col = COL_QTD_VENDA_PREFER if COL_QTD_VENDA_PREFER in cols else COL_QTD_VENDA_FALLBACK
        val_col = COL_VALOR_VENDA_PREFER if COL_VALOR_VENDA_PREFER in cols else COL_VALOR_VENDA_FALLBACK

        sql = f"""
            SELECT
                {quote_ident(COL_DATA_VENDA)} AS data_raw,
                {quote_ident(COL_LOJA_VENDA)} AS cnpj_raw,
                {quote_ident(qtd_col)} AS qtd_raw,
                {quote_ident(val_col)} AS val_raw
            FROM {quote_ident(TBL_VENDAS)}
        """
        df = pd.read_sql_query(sql, con)
    finally:
        con.close()

    if df.empty:
        return df

    df["data"] = parse_data_mista(df["data_raw"]).dt.date.astype(str)
    df["cnpj14"] = df["cnpj_raw"].apply(digits_only).str[:14]
    df["qtd_vendida"] = pd.to_numeric(df["qtd_raw"], errors="coerce").fillna(0).astype(int)
    df["valor_vendido"] = pd.to_numeric(df["val_raw"], errors="coerce").fillna(0.0).astype(float)

    ag = (
        df[df["data"].notna() & (df["cnpj14"] != "")]
        .groupby(["data", "cnpj14"], as_index=False)[["qtd_vendida", "valor_vendido"]]
        .sum()
    )
    return ag

def garantir_colunas_vendas_no_bestflow(conn: sqlite3.Connection):
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE resumo_diario ADD COLUMN qtd_vendida INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE resumo_diario ADD COLUMN valor_vendido REAL NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE resumo_diario ADD COLUMN conversao REAL NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

def recalcular_conversao(conn: sqlite3.Connection):
    cur = conn.cursor()
    cur.execute("""
        UPDATE resumo_diario
        SET conversao = CASE
            WHEN COALESCE(entradas, 0) > 0 THEN CAST(COALESCE(qtd_vendida, 0) AS REAL) / entradas
            ELSE 0
        END
    """)

def aplicar_vendas_no_bestflow(bestflow_db_path: str, samsung_db_path: str) -> int:
    vendas_ag = carregar_vendas_agregadas_por_dia_loja(samsung_db_path)

    con = sqlite3.connect(bestflow_db_path)
    try:
        garantir_colunas_vendas_no_bestflow(con)
        cur = con.cursor()

        cur.execute("DROP TABLE IF EXISTS _tmp_vendas_ag")
        cur.execute("""
            CREATE TEMP TABLE _tmp_vendas_ag (
                data TEXT NOT NULL,
                cnpj14 TEXT NOT NULL,
                qtd_vendida INTEGER NOT NULL,
                valor_vendido REAL NOT NULL,
                PRIMARY KEY (data, cnpj14)
            )
        """)

        if not vendas_ag.empty:
            cur.executemany(
                "INSERT OR REPLACE INTO _tmp_vendas_ag (data, cnpj14, qtd_vendida, valor_vendido) VALUES (?,?,?,?)",
                list(vendas_ag[["data", "cnpj14", "qtd_vendida", "valor_vendido"]].itertuples(index=False, name=None))
            )

        cur.execute("""
            UPDATE resumo_diario
            SET qtd_vendida = COALESCE((
                    SELECT t.qtd_vendida
                    FROM _tmp_vendas_ag t
                    WHERE t.data = resumo_diario.data
                      AND t.cnpj14 = resumo_diario.cnpj14
                ), 0),
                valor_vendido = COALESCE((
                    SELECT t.valor_vendido
                    FROM _tmp_vendas_ag t
                    WHERE t.data = resumo_diario.data
                      AND t.cnpj14 = resumo_diario.cnpj14
                ), 0)
        """)

        recalcular_conversao(con)

        matches = cur.execute("""
            SELECT COUNT(*)
            FROM resumo_diario r
            JOIN _tmp_vendas_ag t
              ON t.data = r.data AND t.cnpj14 = r.cnpj14
        """).fetchone()[0]

        con.commit()
        return int(matches)
    finally:
        con.close()

# ============================================================
# MAIN
# ============================================================
def main():
    # Cria a pasta database se ela nao existir
    os.makedirs(DB_DIR, exist_ok=True)

    # ✅ sobrescreve o arquivo bestflow.db se já existir
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except PermissionError as e:
            # Em servidores, as vezes nao da pra remover, entao tentamos rodar por cima
            print(f"⚠️ Aviso: Arquivo em uso, farei update sem remover: {DB_PATH}")

    dt_ini, dt_fim = periodo_mes_atual_ptbr()
    print(f"--- ✅ BESTFLOW (API) -> bestflow.db (mês atual) ---")
    print(f"Período automático: {dt_ini} até {dt_fim}")
    print(f"Destino DB: {DB_PATH}")

    xml_text = fetch_xml(dt_ini, dt_fim)
    
    # Comentei essa linha abaixo para evitar erro de permissão no Render
    # with open("bestflow_return.xml", "w", encoding="utf-8") as f: f.write(xml_text)

    if "<CONTAGEM" not in (xml_text or ""):
        print("⚠️ Sem <CONTAGEM> no retorno.")
        return

    df = parse_contagem(xml_text)
    daily = resumo_diario(df)

    if daily.empty:
        print("⚠️ Sem dados após agregação.")
        return

    upsert_sqlite(DB_PATH, daily)
    print(f"✅ Banco criado/atualizado (UPSERT): {DB_PATH}")
    print(f"📌 Dias no retorno: {daily['data'].nunique()} | Lojas-dia: {len(daily)}")

    if os.path.exists(SAMSUNG_VENDAS_DB_PATH):
        print("🔄 Aplicando vendas e conversão (READ ONLY no samsung_vendas.db) ...")
        matches = aplicar_vendas_no_bestflow(DB_PATH, SAMSUNG_VENDAS_DB_PATH)
        print(f"✅ Vendas aplicadas. Matches (data+cnpj14): {matches}")
    else:
        print(f"⚠️ samsung_vendas.db não encontrado em: {SAMSUNG_VENDAS_DB_PATH}")

if __name__ == "__main__":
    main()