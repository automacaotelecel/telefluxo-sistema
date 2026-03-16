import os
import re
import sqlite3
import time
import requests
from typing import Any

import pandas as pd


# ============================================================
# CONFIG
# ============================================================
DB_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
EXCEL_PATH = os.path.join(DB_DIR, "db_samsung.xlsx")
DB_PATH = os.path.join(DB_DIR, "samsung_vendas_anuais.db")


# ============================================================
# MAPA DE LOJAS (CNPJ -> NOME)
# ============================================================
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

CORRECAO_NOMES = {
    "UBERABA": "UBERABA SHOPPING",
    "UBERLÂNDIA": "UBERLÂNDIA SHOPPING",
    "UBERLANDIA": "UBERLÂNDIA SHOPPING",
    "CNB SHOPPING": "CONJUNTO NACIONAL",
    "CNB QUIOSQUE": "CONJUNTO NACIONAL QUIOSQUE",
    "QQ TAGUATINGA SHOPPING": "TAGUATINGA SHOPPING QQ",
    "ESTOQUE CD": "CD TAGUATINGA",
    "CD": "CD TAGUATINGA",
    "PASSEIO DAS ÁGUAS": "PASSEIO DAS AGUAS",
    "TERRACO SHOPPING": "TERRAÇO SHOPPING",
    "PARK": "PARK SHOPPING",
}

ALIASES = {
    "ESTOQUE CD": "CD TAGUATINGA",
    "CD": "CD TAGUATINGA",
    "UBERLÂNDIA": "UBERLÂNDIA SHOPPING",
    "UBERLANDIA": "UBERLÂNDIA SHOPPING",
    "UBERABA": "UBERABA SHOPPING",
    "CNB SHOPPING": "CONJUNTO NACIONAL",
    "CNB QUIOSQUE": "CONJUNTO NACIONAL QUIOSQUE",
    "QQ TAGUATINGA SHOPPING": "TAGUATINGA SHOPPING QQ",
    "PASSEIO DAS ÁGUAS": "PASSEIO DAS AGUAS",
    "TERRACO SHOPPING": "TERRAÇO SHOPPING",
}


def norm(s: Any) -> str:
    s = "" if s is None else str(s)
    s = s.strip().upper()
    s = re.sub(r"\s+", " ", s)
    return s


REVERSE_LOJAS = {norm(nome): cnpj for cnpj, nome in LOJAS_MAP.items()}
ALIASES_N = {norm(k): norm(v) for k, v in ALIASES.items()}


def loja_para_cnpj(loja: Any) -> str | None:
    t = norm(loja)

    if t in CORRECAO_NOMES:
        t = CORRECAO_NOMES[t]

    for prefix in ["SAMSUNG - MRF - ", "SSG "]:
        if t.startswith(prefix):
            t = norm(t[len(prefix):])

    t = ALIASES_N.get(t, t)
    return REVERSE_LOJAS.get(t)


def get_clean_store_name(raw_name: Any) -> str:
    nome = norm(raw_name)
    if nome in CORRECAO_NOMES:
        return CORRECAO_NOMES[nome]
    if nome in REVERSE_LOJAS:
        return LOJAS_MAP[REVERSE_LOJAS[nome]]
    cnpj = loja_para_cnpj(nome)
    if cnpj and cnpj in LOJAS_MAP:
        return LOJAS_MAP[cnpj]
    return nome


def parse_any_date(series: pd.Series) -> pd.Series:
    """Blindagem: datetime / serial excel / strings dd/mm/yyyy ou yyyy-mm-dd."""
    s = series.copy()

    if pd.api.types.is_datetime64_any_dtype(s):
        return s

    # serial excel
    s_num = pd.to_numeric(s, errors="coerce")
    dt_excel = pd.to_datetime(s_num, unit="D", origin="1899-12-30", errors="coerce")

    # strings
    s_str = s.astype(str).str.strip()
    s_date_only = s_str.str.split(" ").str[0].str.replace(".", "/", regex=False)

    dt1 = pd.to_datetime(s_date_only, format="%Y-%m-%d", errors="coerce")
    m = dt1.isna()
    if m.any():
        dt1.loc[m] = pd.to_datetime(s_date_only[m], format="%d/%m/%Y", errors="coerce")
    m = dt1.isna()
    if m.any():
        dt1.loc[m] = pd.to_datetime(s_date_only[m], dayfirst=True, errors="coerce")

    # fallback excel serial
    m = dt1.isna()
    if m.any():
        dt1.loc[m] = dt_excel.loc[m]

    return dt1


def pick_sheet(xls: pd.ExcelFile, candidates: list[str]) -> str:
    for name in candidates:
        if name in xls.sheet_names:
            return name
    raise ValueError(f"Nenhuma aba encontrada entre: {candidates}. Abas no arquivo: {xls.sheet_names}")


def recreate_db_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        DROP TABLE IF EXISTS vendas_anuais;
        DROP TABLE IF EXISTS vendas_anuais_raw;
        DROP TABLE IF EXISTS seguros_anuais;
        DROP TABLE IF EXISTS agg_lojas_mensal;
        DROP TABLE IF EXISTS agg_vendedores_mensal;

        CREATE TABLE vendas_anuais_raw (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nota_fiscal TEXT,
          cancelado TEXT,
          tipo_transacao TEXT,
          natureza_operacao TEXT,
          data_emissao TEXT,
          nome_vendedor TEXT,
          codigo_produto TEXT,
          referencia TEXT,
          descricao TEXT,
          categoria TEXT,
          imei TEXT,
          quantidade REAL,
          total_liquido REAL,
          qtd_real REAL,
          total_real REAL,
          categoria_real TEXT,
          loja TEXT,
          regiao TEXT,
          ano INTEGER,
          mes INTEGER,
          cnpj_empresa TEXT
        );

        CREATE TABLE vendas_anuais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_emissao TEXT,
            ano INTEGER,
            mes INTEGER,
            loja TEXT,
            cnpj_empresa TEXT,
            nome_vendedor TEXT,
            descricao TEXT,
            familia TEXT,
            regiao TEXT,
            quantidade REAL,
            total_liquido REAL
        );

        CREATE TABLE seguros_anuais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_emissao TEXT,
            ano INTEGER,
            mes INTEGER,
            loja TEXT,
            cnpj_empresa TEXT,
            nome_vendedor TEXT,
            descricao TEXT,
            regiao TEXT,
            qtd REAL,
            premio REAL,
            nf TEXT
        );

        CREATE TABLE agg_lojas_mensal (
            ano INTEGER,
            mes INTEGER,
            loja TEXT,
            cnpj_empresa TEXT,
            regiao TEXT,
            vendas_total REAL,
            vendas_qtd REAL,
            seguros_total REAL,
            seguros_qtd REAL,
            PRIMARY KEY (ano, mes, loja)
        );

        CREATE TABLE agg_vendedores_mensal (
            ano INTEGER,
            mes INTEGER,
            loja TEXT,
            cnpj_empresa TEXT,
            regiao TEXT,
            vendedor TEXT,
            vendas_total REAL,
            vendas_qtd REAL,
            seguros_total REAL,
            seguros_qtd REAL,
            PRIMARY KEY (ano, mes, loja, vendedor)
        );
        """
    )
    con.commit()


# ============================================================
# ✅ FUNÇÕES DE SINCRONIZAÇÃO (ADICIONADAS AQUI)
# ============================================================
URL_BACKEND = "https://telefluxo-aplicacao.onrender.com"
MAX_RETRIES = 6
BASE_WAIT_SECONDS = 8
RETRY_STATUS = {502, 503, 504}

def limpar_valores_json(dados):
    cleaned = []
    for row in dados:
        new_row = {}
        for k, v in row.items():
            new_row[k] = None if pd.isna(v) else v
        cleaned.append(new_row)
    return cleaned

def enviar_dados_para_api(endpoint: str, dados: list) -> bool:
    if not dados:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    dados = limpar_valores_json(dados)
    
    # Lotes maiores para o anual já que é histórico pesado
    BATCH_SIZE = 250
    total_lotes = (len(dados) // BATCH_SIZE) + 1
    
    print(f"📡 Preparando envio de {len(dados)} registros em {total_lotes} lotes...")
    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados), BATCH_SIZE):
        lote = dados[i : i + BATCH_SIZE]
        lote_num = (i // BATCH_SIZE) + 1
        
        # O primeiro lote reseta o banco anual na nuvem, os demais empilham
        param_reset = "true" if i == 0 else "false"
        url_lote = f"{URL_BACKEND}{endpoint}?reset={param_reset}"

        print(f"   📦 Enviando Lote {lote_num}/{total_lotes} ({len(lote)} itens)...")

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=120)
                
                if 200 <= response.status_code < 300:
                    break 
                
                if response.status_code == 413:
                    print("   ❌ ERRO 413: Lote muito grande. Diminua o BATCH_SIZE.")
                    return False

                if response.status_code in RETRY_STATUS or "SQLITE_BUSY" in response.text:
                    wait_time = BASE_WAIT_SECONDS * attempt
                    print(f"      ⏳ Servidor ocupado ({response.status_code})... Aguardando {wait_time}s")
                    time.sleep(wait_time)
                    continue
                
                print(f"   ❌ Erro Fatal no Lote {lote_num}: {response.status_code} - {response.text[:200]}")
                return False 

            except Exception as e:
                print(f"   ⚠️ Erro conexão Lote {lote_num}: {e}")
                time.sleep(BASE_WAIT_SECONDS * attempt)
        else:
            print(f"   ❌ Falha fatal no Lote {lote_num} após todas tentativas.")
            return False

    print("✅ Todos os lotes anuais enviados com sucesso!")
    return True


def build_db(excel_path: str, db_path: str) -> None:
    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"Excel não encontrado: {excel_path}")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    xls = pd.ExcelFile(excel_path)

    sheet_vendas = pick_sheet(xls, ["BASE_VENDAS", "VENDAS"])
    sheet_seguros = pick_sheet(xls, ["BASE_SEGURO", "SEGUROS", "seguros"])

    df_v = pd.read_excel(excel_path, sheet_name=sheet_vendas, engine="openpyxl")
    df_s = pd.read_excel(excel_path, sheet_name=sheet_seguros, engine="openpyxl")

    # ✅ tira espaços dos headers
    df_v.columns = [str(c).strip() for c in df_v.columns]
    df_s.columns = [str(c).strip() for c in df_s.columns]

    # helper: pega coluna mesmo se vier com variação de nome
    def col(df: pd.DataFrame, name: str, default=None) -> pd.Series:
        if name in df.columns:
            return df[name]
        # tenta variações com normalização de espaço/underscore
        wanted = norm(name).replace("_", " ")
        for c in df.columns:
            if norm(c).replace("_", " ") == wanted:
                return df[c]
        if default is None:
            return pd.Series([None] * len(df))
        return pd.Series([default] * len(df))

    # ============================================================
    # ✅ RAW (espelha Excel) - filtra só datas válidas
    # ============================================================
    raw = df_v.copy()
    raw_dt = parse_any_date(col(raw, "DATA_EMISSAO"))
    raw = raw.loc[raw_dt.notna()].copy()
    raw_dt = raw_dt.loc[raw_dt.notna()]

    raw["data_emissao"] = raw_dt.dt.strftime("%Y-%m-%d")
    raw["ano"] = raw_dt.dt.year.astype(int)
    raw["mes"] = raw_dt.dt.month.astype(int)

    raw["loja_clean"] = col(raw, "LOJA", "").apply(get_clean_store_name)
    raw["cnpj_empresa"] = raw["loja_clean"].map(loja_para_cnpj)

    raw_out = pd.DataFrame({
        "nota_fiscal": col(raw, "NOTA FISCAL", "").astype(str),
        "cancelado": col(raw, "CANCELADO", "").astype(str),
        "tipo_transacao": col(raw, "TIPO_TRANSACAO", "").astype(str),
        "natureza_operacao": col(raw, "NATUREZA_OPERACAO", "").astype(str),

        "data_emissao": raw["data_emissao"],

        "nome_vendedor": col(raw, "NOME_VENDEDOR", "").astype(str),
        "codigo_produto": col(raw, "CODIGO_PRODUTO", "").astype(str),
        "referencia": col(raw, "REFERENCIA", "").astype(str),
        "descricao": col(raw, "DESCRICAO", "").astype(str),

        "categoria": col(raw, "CATEGORIA", "").astype(str),
        "imei": col(raw, "IMEI", "").astype(str),

        "quantidade": pd.to_numeric(col(raw, "QUANTIDADE", 0), errors="coerce").fillna(0),
        "total_liquido": pd.to_numeric(col(raw, "TOTAL_LIQUIDO", 0), errors="coerce").fillna(0),

        "qtd_real": pd.to_numeric(col(raw, "QTD REAL", 0), errors="coerce").fillna(0),
        "total_real": pd.to_numeric(col(raw, "TOTAL REAL", 0), errors="coerce").fillna(0),

        "categoria_real": col(raw, "CATEGORIA REAL", "").astype(str),
        "loja": raw["loja_clean"].astype(str),
        "regiao": col(raw, "REGIAO", "").astype(str),

        "ano": raw["ano"],
        "mes": raw["mes"],
        "cnpj_empresa": raw["cnpj_empresa"],
    })

    # ============================================================
    # ✅ NORMALIZADA (pro BI) - usa QTD REAL / TOTAL REAL
    # ============================================================
    dfv = df_v.copy()

    if "CANCELADO" in dfv.columns:
        dfv = dfv[dfv["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    # obrigatórias
    for c in ["DATA_EMISSAO", "NOME_VENDEDOR", "DESCRICAO", "LOJA"]:
        if c not in dfv.columns:
            raise ValueError(f"Coluna obrigatória ausente em vendas: {c}. Colunas: {list(dfv.columns)}")

    dt_v = parse_any_date(dfv["DATA_EMISSAO"])
    dfv = dfv.loc[dt_v.notna()].copy()
    dt_v = dt_v.loc[dt_v.notna()]

    dfv["data_emissao"] = dt_v.dt.strftime("%Y-%m-%d")
    dfv["ano"] = dt_v.dt.year.astype(int)
    dfv["mes"] = dt_v.dt.month.astype(int)

    dfv["loja"] = dfv["LOJA"].apply(get_clean_store_name)
    dfv["cnpj_empresa"] = dfv["loja"].map(loja_para_cnpj)

    dfv["nome_vendedor"] = dfv["NOME_VENDEDOR"].astype(str).str.strip().str.upper()
    dfv["descricao"] = dfv["DESCRICAO"].astype(str).str.strip().str.upper()

    if "CATEGORIA REAL" in dfv.columns:
        dfv["familia"] = dfv["CATEGORIA REAL"].astype(str).str.strip().str.upper()
    elif "CATEGORIA" in dfv.columns:
        dfv["familia"] = dfv["CATEGORIA"].astype(str).str.strip().str.upper()
    else:
        dfv["familia"] = "OUTROS"

    dfv["regiao"] = dfv["REGIAO"].astype(str).str.strip().str.upper() if "REGIAO" in dfv.columns else ""

    # prioridade: QTD REAL
    if "QTD REAL" in dfv.columns:
        dfv["quantidade"] = pd.to_numeric(dfv["QTD REAL"], errors="coerce").fillna(0)
    else:
        dfv["quantidade"] = pd.to_numeric(dfv.get("QUANTIDADE", 0), errors="coerce").fillna(0)

    # prioridade: TOTAL REAL
    if "TOTAL REAL" in dfv.columns:
        dfv["total_liquido"] = pd.to_numeric(dfv["TOTAL REAL"], errors="coerce").fillna(0)
    elif "TOTAL_LIQUIDO" in dfv.columns:
        dfv["total_liquido"] = pd.to_numeric(dfv["TOTAL_LIQUIDO"], errors="coerce").fillna(0)
    else:
        dfv["total_liquido"] = 0.0

    dfv = dfv[(dfv["total_liquido"].abs() > 0.01) | (dfv["quantidade"].abs() > 0.001)].copy()

    vendas_out = dfv[
        ["data_emissao", "ano", "mes", "loja", "cnpj_empresa", "nome_vendedor",
         "descricao", "familia", "regiao", "quantidade", "total_liquido"]
    ].copy()

    # ============================================================
    # ✅ SEGUROS (mantido)
    # ============================================================
    if "DataEmissao" in df_s.columns:
        dt_s = parse_any_date(df_s["DataEmissao"])
    elif "DataNF" in df_s.columns:
        dt_s = parse_any_date(df_s["DataNF"])
    else:
        raise ValueError(f"SEGUROS: não achei DataEmissao nem DataNF. Colunas: {list(df_s.columns)}")

    dfs = df_s.loc[dt_s.notna()].copy()
    dt_s = dt_s.loc[dt_s.notna()]

    dfs["data_emissao"] = dt_s.dt.strftime("%Y-%m-%d")
    dfs["ano"] = dt_s.dt.year.astype(int)
    dfs["mes"] = dt_s.dt.month.astype(int)

    if "LOJA" not in dfs.columns:
        raise ValueError(f"SEGUROS: coluna LOJA ausente. Colunas: {list(dfs.columns)}")

    dfs["loja"] = dfs["LOJA"].apply(get_clean_store_name)

    if "CnpjEmp" in dfs.columns:
        dfs["cnpj_empresa"] = dfs["CnpjEmp"].astype(str).str.replace(r"\D", "", regex=True)
        dfs.loc[dfs["cnpj_empresa"].str.len() == 0, "cnpj_empresa"] = None
    else:
        dfs["cnpj_empresa"] = dfs["loja"].map(loja_para_cnpj)

    if "NOME_VENDEDOR" not in dfs.columns:
        raise ValueError("SEGUROS: coluna NOME_VENDEDOR ausente (precisa para união).")

    dfs["nome_vendedor"] = dfs["NOME_VENDEDOR"].astype(str).str.strip().str.upper()

    if "DESCRIÇÃO" in dfs.columns:
        dfs["descricao"] = dfs["DESCRIÇÃO"].astype(str).str.strip().str.upper()
    elif "DescServico" in dfs.columns:
        dfs["descricao"] = dfs["DescServico"].astype(str).str.strip().str.upper()
    else:
        dfs["descricao"] = ""

    dfs["regiao"] = dfs["REGIAO"].astype(str).str.strip().str.upper() if "REGIAO" in dfs.columns else ""

    dfs["qtd"] = pd.to_numeric(dfs.get("QTD REAL", 0), errors="coerce").fillna(0)
    dfs["premio"] = pd.to_numeric(dfs.get("PREMIO REAL", 0), errors="coerce").fillna(0)
    dfs["nf"] = dfs.get("NF", "").astype(str) if "NF" in dfs.columns else ""

    dfs = dfs[(dfs["premio"].abs() > 0.01) | (dfs["qtd"].abs() > 0.001)].copy()

    seguros_out = dfs[
        ["data_emissao", "ano", "mes", "loja", "cnpj_empresa", "nome_vendedor",
         "descricao", "regiao", "qtd", "premio", "nf"]
    ].copy()

    # ============================================================
    # SQLITE: grava tudo + agregados
    # ============================================================
    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA busy_timeout=15000;")

        recreate_db_schema(con)

        # ✅ grava RAW primeiro
        raw_out.to_sql("vendas_anuais_raw", con, if_exists="append", index=False)

        # ✅ grava normalizadas
        vendas_out.to_sql("vendas_anuais", con, if_exists="append", index=False)
        seguros_out.to_sql("seguros_anuais", con, if_exists="append", index=False)

        # agregados loja/mês
        v_loja = (
            vendas_out.groupby(["ano", "mes", "loja", "cnpj_empresa", "regiao"], dropna=False)
            .agg(vendas_total=("total_liquido", "sum"), vendas_qtd=("quantidade", "sum"))
            .reset_index()
        )
        s_loja = (
            seguros_out.groupby(["ano", "mes", "loja", "cnpj_empresa", "regiao"], dropna=False)
            .agg(seguros_total=("premio", "sum"), seguros_qtd=("qtd", "sum"))
            .reset_index()
        )
        lojas = pd.merge(
            v_loja, s_loja,
            on=["ano", "mes", "loja", "cnpj_empresa", "regiao"],
            how="outer"
        ).fillna({"vendas_total": 0, "vendas_qtd": 0, "seguros_total": 0, "seguros_qtd": 0})
        lojas.to_sql("agg_lojas_mensal", con, if_exists="append", index=False)

        # agregados vendedor/mês
        v_vend = (
            vendas_out.groupby(["ano", "mes", "loja", "cnpj_empresa", "regiao", "nome_vendedor"], dropna=False)
            .agg(vendas_total=("total_liquido", "sum"), vendas_qtd=("quantidade", "sum"))
            .reset_index()
            .rename(columns={"nome_vendedor": "vendedor"})
        )
        s_vend = (
            seguros_out.groupby(["ano", "mes", "loja", "cnpj_empresa", "regiao", "nome_vendedor"], dropna=False)
            .agg(seguros_total=("premio", "sum"), seguros_qtd=("qtd", "sum"))
            .reset_index()
            .rename(columns={"nome_vendedor": "vendedor"})
        )
        vendedores = pd.merge(
            v_vend, s_vend,
            on=["ano", "mes", "loja", "cnpj_empresa", "regiao", "vendedor"],
            how="outer"
        ).fillna({"vendas_total": 0, "vendas_qtd": 0, "seguros_total": 0, "seguros_qtd": 0})
        vendedores.to_sql("agg_vendedores_mensal", con, if_exists="append", index=False)

        con.commit()

        print("✅ Banco recriado com sucesso!")
        print(f"📌 Excel: {excel_path}")
        print(f"📌 DB:    {db_path}")
        print(f"📊 Vendas normalizadas: {len(vendas_out)} registros")
        print(f"📦 Vendas RAW:          {len(raw_out)} registros")
        print(f"🛡️ Seguros:            {len(seguros_out)} registros")
        print(f"🏬 Lojas(mensal):       {len(lojas)} linhas")
        print(f"🧑‍💼 Vendedores(mensal): {len(vendedores)} linhas")

    finally:
        con.close()

    # ============================================================
    # ✅ NOVO: SINCRONIZAÇÃO COM A NUVEM (RENDER)
    # ============================================================
    print("\n🚀 Iniciando sincronização do Banco Anual com a Nuvem...")
    
    dados_anuais = vendas_out.to_dict(orient="records")
    
    # Envia para a API (Atenção: Garanta que esta rota existe no seu backend!)
    ok = enviar_dados_para_api("/api/sync/vendas_anuais", dados_anuais)
    
    if ok:
        print("✅ Base Anual sincronizada com sucesso na nuvem!")
    else:
        print("❌ Falha ao enviar Base Anual para a nuvem.")


if __name__ == "__main__":
    build_db(EXCEL_PATH, DB_PATH)