import os
import re
import sqlite3
from datetime import datetime
from typing import Any

import pandas as pd


# ============================================================
# CONFIG
# ============================================================
DB_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
EXCEL_PATH = os.path.join(DB_DIR, "db_samsung.xlsx")
DB_PATH = os.path.join(DB_DIR, "samsung_vendas_anuais.db")


# ============================================================
# MAPA DE LOJAS (CNPJ -> NOME)  [mantive o seu]
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
    cur = con.cursor()

    # DROPS (recria tudo sempre)
    cur.executescript(
        """
        DROP TABLE IF EXISTS vendas_anuais;
        DROP TABLE IF EXISTS seguros_anuais;

        DROP TABLE IF EXISTS agg_lojas_mensal;
        DROP TABLE IF EXISTS agg_vendedores_mensal;

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

        -- Agregado por LOJA/MÊS/ANO (vendas e seguros juntos)
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

        -- Agregado por VENDEDOR/MÊS/ANO (vendas e seguros juntos)
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


def build_db(excel_path: str, db_path: str) -> None:
    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"Excel não encontrado: {excel_path}")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    xls = pd.ExcelFile(excel_path)

    # ✅ nomes reais / fallbacks
    sheet_vendas = pick_sheet(xls, ["BASE_VENDAS", "VENDAS"])
    sheet_seguros = pick_sheet(xls, ["BASE_SEGURO", "SEGUROS", "seguros"])

    df_v = pd.read_excel(excel_path, sheet_name=sheet_vendas, engine="openpyxl")
    df_s = pd.read_excel(excel_path, sheet_name=sheet_seguros, engine="openpyxl")

    # ------------------------
    # VENDAS: normalização
    # ------------------------
    if "CANCELADO" in df_v.columns:
        df_v = df_v[df_v["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    # colunas esperadas na sua BASE_VENDAS (vi no arquivo):
    # DATA_EMISSAO, NOME_VENDEDOR, DESCRICAO, CATEGORIA REAL, LOJA, REGIAO, QTD REAL, TOTAL REAL
    required_v = ["DATA_EMISSAO", "NOME_VENDEDOR", "DESCRICAO", "LOJA"]
    for c in required_v:
        if c not in df_v.columns:
            raise ValueError(f"Coluna obrigatória ausente em vendas: {c}. Colunas: {list(df_v.columns)}")

    dt_v = parse_any_date(df_v["DATA_EMISSAO"])
    df_v = df_v.loc[dt_v.notna()].copy()
    dt_v = dt_v.loc[dt_v.notna()]

    df_v["data_emissao"] = dt_v.dt.strftime("%Y-%m-%d")
    df_v["ano"] = dt_v.dt.year.astype(int)
    df_v["mes"] = dt_v.dt.month.astype(int)

    df_v["loja"] = df_v["LOJA"].apply(get_clean_store_name)
    df_v["cnpj_empresa"] = df_v["loja"].map(loja_para_cnpj)

    df_v["nome_vendedor"] = df_v["NOME_VENDEDOR"].astype(str).str.strip().str.upper()
    df_v["descricao"] = df_v["DESCRICAO"].astype(str).str.strip().str.upper()

    df_v["familia"] = (
        df_v["CATEGORIA REAL"].astype(str).str.strip().str.upper()
        if "CATEGORIA REAL" in df_v.columns
        else (df_v["CATEGORIA"].astype(str).str.strip().str.upper() if "CATEGORIA" in df_v.columns else "OUTROS")
    )

    df_v["regiao"] = df_v["REGIAO"].astype(str).str.strip().str.upper() if "REGIAO" in df_v.columns else ""

    df_v["quantidade"] = pd.to_numeric(df_v["QTD REAL"], errors="coerce").fillna(
        pd.to_numeric(df_v.get("QUANTIDADE", 0), errors="coerce")
    ).fillna(0)

    # total
    if "TOTAL REAL" in df_v.columns:
        df_v["total_liquido"] = pd.to_numeric(df_v["TOTAL REAL"], errors="coerce").fillna(0)
    elif "TOTAL_LIQUIDO" in df_v.columns:
        df_v["total_liquido"] = pd.to_numeric(df_v["TOTAL_LIQUIDO"], errors="coerce").fillna(0)
    else:
        df_v["total_liquido"] = 0.0

    df_v = df_v[(df_v["total_liquido"].abs() > 0.01) | (df_v["quantidade"].abs() > 0.001)].copy()

    vendas_out = df_v[
        ["data_emissao", "ano", "mes", "loja", "cnpj_empresa", "nome_vendedor", "descricao", "familia", "regiao", "quantidade", "total_liquido"]
    ].copy()

    # ------------------------
    # SEGUROS: normalização
    # ------------------------
    # No seu arquivo vi colunas: DataEmissao, PREMIO REAL, QTD REAL, LOJA, NOME_VENDEDOR, DESCRIÇÃO, REGIAO, CnpjEmp, NF
    # data: tenta DataEmissao (ou DataNF como fallback)
    if "DataEmissao" in df_s.columns:
        dt_s = parse_any_date(df_s["DataEmissao"])
    elif "DataNF" in df_s.columns:
        dt_s = parse_any_date(df_s["DataNF"])
    else:
        raise ValueError(f"SEGUROS: não achei DataEmissao nem DataNF. Colunas: {list(df_s.columns)}")

    df_s = df_s.loc[dt_s.notna()].copy()
    dt_s = dt_s.loc[dt_s.notna()]

    df_s["data_emissao"] = dt_s.dt.strftime("%Y-%m-%d")
    df_s["ano"] = dt_s.dt.year.astype(int)
    df_s["mes"] = dt_s.dt.month.astype(int)

    if "LOJA" not in df_s.columns:
        raise ValueError(f"SEGUROS: coluna LOJA ausente. Colunas: {list(df_s.columns)}")

    df_s["loja"] = df_s["LOJA"].apply(get_clean_store_name)

    # CNPJ do seguro pode existir como CnpjEmp
    if "CnpjEmp" in df_s.columns:
        df_s["cnpj_empresa"] = df_s["CnpjEmp"].astype(str).str.replace(r"\D", "", regex=True)
        df_s.loc[df_s["cnpj_empresa"].str.len() == 0, "cnpj_empresa"] = None
    else:
        df_s["cnpj_empresa"] = df_s["loja"].map(loja_para_cnpj)

    if "NOME_VENDEDOR" not in df_s.columns:
        raise ValueError("SEGUROS: coluna NOME_VENDEDOR ausente (precisa para união).")

    df_s["nome_vendedor"] = df_s["NOME_VENDEDOR"].astype(str).str.strip().str.upper()

    # descrição do seguro
    if "DESCRIÇÃO" in df_s.columns:
        df_s["descricao"] = df_s["DESCRIÇÃO"].astype(str).str.strip().str.upper()
    elif "DescServico" in df_s.columns:
        df_s["descricao"] = df_s["DescServico"].astype(str).str.strip().str.upper()
    else:
        df_s["descricao"] = ""

    df_s["regiao"] = df_s["REGIAO"].astype(str).str.strip().str.upper() if "REGIAO" in df_s.columns else ""

    df_s["qtd"] = pd.to_numeric(df_s.get("QTD REAL", 0), errors="coerce").fillna(0)
    df_s["premio"] = pd.to_numeric(df_s.get("PREMIO REAL", 0), errors="coerce").fillna(0)

    df_s["nf"] = df_s.get("NF", "").astype(str) if "NF" in df_s.columns else ""

    df_s = df_s[(df_s["premio"].abs() > 0.01) | (df_s["qtd"].abs() > 0.001)].copy()

    seguros_out = df_s[
        ["data_emissao", "ano", "mes", "loja", "cnpj_empresa", "nome_vendedor", "descricao", "regiao", "qtd", "premio", "nf"]
    ].copy()

    # ------------------------
    # SQLITE: grava e cria agregados
    # ------------------------
    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA busy_timeout=15000;")

        recreate_db_schema(con)

        vendas_out.to_sql("vendas_anuais", con, if_exists="append", index=False)
        seguros_out.to_sql("seguros_anuais", con, if_exists="append", index=False)

        # Agregado lojas/mês
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

        # Agregado vendedores/mês (união por loja+vendedor+ano+mes)
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
        print(f"📊 Vendas:   {len(vendas_out)} registros")
        print(f"🛡️ Seguros:  {len(seguros_out)} registros")
        print(f"🏬 Lojas(mensal):     {len(lojas)} linhas")
        print(f"🧑‍💼 Vendedores(mensal): {len(vendedores)} linhas")

    finally:
        con.close()


if __name__ == "__main__":
    build_db(EXCEL_PATH, DB_PATH)