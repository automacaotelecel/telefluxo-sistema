# ============================================================
# ✅ EXTRATOR / INTEGRADOR (ANUAL) - SEM EXIGIR USER_ID
# Mantém o comportamento do script antigo (não trava sem ID)
# + Envia para endpoints anuais: /api/sync/vendas_anuais e /api/sync/vendedores_anuais
# + Banco local separado: samsung_vendas_anuais.db
# + Tabelas locais separadas: vendas_anuais / vendedores_anuais
# + Excel anual: vendas_anuais.xlsm
# ============================================================

import pandas as pd
import requests
import os
import re
from typing import List, Dict, Any
import sqlite3
from datetime import datetime
import time

# ============================================================
# ✅ CONFIGURAÇÃO DE URL AUTOMÁTICA (HÍBRIDA)
# ============================================================
def get_backend_url():
    """
    Tenta conectar no localhost. Se conseguir, usa LOCAL.
    Se falhar (servidor local desligado), usa PRODUÇÃO.
    """
    local_url = "http://localhost:3000"
    prod_url = "https://telefluxo-aplicacao.onrender.com"

    print("🔍 Detectando ambiente...")
    try:
        requests.get(local_url, timeout=1)
        print(f"🏠 Servidor Local encontrado! Usando: {local_url}")
        return local_url
    except Exception:
        print(f"☁️ Servidor Local offline. Usando PRODUÇÃO: {prod_url}")
        return prod_url


# ============================================================
# ✅ CONFIGURAÇÕES (ANUAL)
# ============================================================
DB_COPIA_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
DB_COPIA_PATH = os.path.join(DB_COPIA_DIR, "samsung_vendas_anuais.db")

# Excel anual (seu arquivo consolidado anual)
CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\vendas_anuais.xlsm"

URL_BACKEND = get_backend_url()
TIMEOUT = (10, 180)  # (conexão, resposta)

# política de retry
RETRY_STATUS = {502, 503, 504}
MAX_RETRIES = 6
BASE_WAIT_SECONDS = 8

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

# correções
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

    # Correção manual primeiro
    if t in CORRECAO_NOMES:
        t = CORRECAO_NOMES[t]

    # Remove prefixos comuns
    for prefix in ["SAMSUNG - MRF - ", "SSG "]:
        if t.startswith(prefix):
            t = norm(t[len(prefix):])

    # Aplica aliases
    t = ALIASES_N.get(t, t)

    return REVERSE_LOJAS.get(t)


def get_clean_store_name(raw_name: Any) -> str:
    nome_sujo = norm(raw_name)

    if nome_sujo in CORRECAO_NOMES:
        return CORRECAO_NOMES[nome_sujo]

    if nome_sujo in REVERSE_LOJAS:
        return LOJAS_MAP[REVERSE_LOJAS[nome_sujo]]

    cnpj = loja_para_cnpj(nome_sujo)
    if cnpj and cnpj in LOJAS_MAP:
        return LOJAS_MAP[cnpj]

    return nome_sujo


def limpar_valores_json(dados: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for row in dados:
        new_row = {}
        for k, v in row.items():
            new_row[k] = None if pd.isna(v) else v
        cleaned.append(new_row)
    return cleaned


# ============================================================
# ✅ ENVIO EM LOTES (ANUAL) - com pausa pequena
# ============================================================
def enviar_dados_para_api(endpoint: str, dados: List[Dict[str, Any]]) -> bool:
    if not isinstance(dados, list):
        print("❌ ERRO: dados não é uma lista.")
        return False

    if len(dados) == 0:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    dados = limpar_valores_json(dados)

    # equilíbrio (você já testou que funciona bem)
    BATCH_SIZE = 250
    total_lotes = (len(dados) // BATCH_SIZE) + (1 if (len(dados) % BATCH_SIZE) else 0)

    print(f"📡 Preparando envio de {len(dados)} registros em {total_lotes} lotes para {endpoint}...")

    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados), BATCH_SIZE):
        lote = dados[i: i + BATCH_SIZE]
        lote_num = (i // BATCH_SIZE) + 1

        # reset só no primeiro lote
        param_reset = "true" if i == 0 else "false"
        url_lote = f"{URL_BACKEND}{endpoint}?reset={param_reset}"

        print(f"   📦 Enviando Lote {lote_num}/{total_lotes} ({len(lote)} itens)...")

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=TIMEOUT)

                if 200 <= response.status_code < 300:
                    time.sleep(1.5)  # deixa o servidor respirar
                    break

                if response.status_code == 413:
                    print(f"❌ ERRO 413: Lote {lote_num} muito grande. Reduza BATCH_SIZE.")
                    return False

                if response.status_code in RETRY_STATUS or "SQLITE_BUSY" in response.text:
                    print(f"⚠️ Servidor ocupado/reiniciando (Erro {response.status_code}). Aguardando 15s...")
                    time.sleep(15)
                    continue

                print(f"❌ ERRO FATAL no Lote {lote_num}: {response.status_code} -> {response.text[:300]}")
                return False

            except Exception as e:
                print(f"⚠️ Falha de conexão no Lote {lote_num} (Tentativa {attempt}): {e}")
                time.sleep(15)
        else:
            print(f"❌ Desistindo do Lote {lote_num} após {MAX_RETRIES} tentativas.")
            return False

    print("✅ Todos os lotes enviados com sucesso!")
    return True


# ============================================================
# ✅ SQLITE LOCAL (CÓPIA) - ANUAL
# ============================================================
def _sqlite_connect(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA synchronous=NORMAL;")
    con.execute("PRAGMA busy_timeout=15000;")
    return con


def criar_tabelas_copia(db_path: str) -> None:
    con = _sqlite_connect(db_path)
    try:
        cur = con.cursor()

        cur.execute("""
        CREATE TABLE IF NOT EXISTS vendas_anuais (
            data_emissao   TEXT,
            nome_vendedor  TEXT,
            descricao      TEXT,
            quantidade     REAL,
            total_liquido  REAL,
            cnpj_empresa   TEXT,
            familia        TEXT,
            regiao         TEXT
        )
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS vendedores_anuais (
            loja          TEXT,
            vendedor      TEXT,
            fat_atual     REAL,
            tendencia     REAL,
            fat_anterior  REAL,
            crescimento   REAL,
            pa            REAL,
            ticket        REAL,
            qtd           REAL,
            regiao        TEXT,
            pct_seguro    REAL,
            seguros       REAL
        )
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS _sync_meta_anual (
            chave TEXT PRIMARY KEY,
            valor TEXT
        )
        """)

        con.commit()
    finally:
        con.close()


def salvar_copia_vendas(dados_vendas: List[Dict[str, Any]], db_path: str = DB_COPIA_PATH) -> None:
    criar_tabelas_copia(db_path)
    con = _sqlite_connect(db_path)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM vendas_anuais")

        rows = []
        for r in dados_vendas:
            rows.append((
                r.get("data_emissao"),
                r.get("nome_vendedor"),
                r.get("descricao"),
                r.get("quantidade") if r.get("quantidade") is not None else 0,
                r.get("total_liquido") if r.get("total_liquido") is not None else 0,
                r.get("cnpj_empresa"),
                r.get("familia"),
                r.get("regiao"),
            ))

        cur.executemany("""
            INSERT INTO vendas_anuais (
                data_emissao, nome_vendedor, descricao, quantidade,
                total_liquido, cnpj_empresa, familia, regiao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

        cur.execute("""
            INSERT INTO _sync_meta_anual (chave, valor)
            VALUES ('vendas_anuais_last_write', ?)
            ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))

        con.commit()
        print(f"💾 Cópia local salva (vendas_anuais): {db_path} | Registros: {len(rows)}")
    finally:
        con.close()


def salvar_copia_vendedores(dados_vendedores: List[Dict[str, Any]], db_path: str = DB_COPIA_PATH) -> None:
    criar_tabelas_copia(db_path)
    con = _sqlite_connect(db_path)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM vendedores_anuais")

        rows = []
        for r in dados_vendedores:
            rows.append((
                r.get("loja"),
                r.get("vendedor"),
                r.get("fat_atual") if r.get("fat_atual") is not None else 0,
                r.get("tendencia") if r.get("tendencia") is not None else 0,
                r.get("fat_anterior") if r.get("fat_anterior") is not None else 0,
                r.get("crescimento") if r.get("crescimento") is not None else 0,
                r.get("pa") if r.get("pa") is not None else 0,
                r.get("ticket") if r.get("ticket") is not None else 0,
                r.get("qtd") if r.get("qtd") is not None else 0,
                r.get("regiao"),
                r.get("pct_seguro") if r.get("pct_seguro") is not None else 0,
                r.get("seguros") if r.get("seguros") is not None else 0,
            ))

        cur.executemany("""
            INSERT INTO vendedores_anuais (
                loja, vendedor, fat_atual, tendencia, fat_anterior,
                crescimento, pa, ticket, qtd, regiao, pct_seguro, seguros
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

        cur.execute("""
            INSERT INTO _sync_meta_anual (chave, valor)
            VALUES ('vendedores_anuais_last_write', ?)
            ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))

        con.commit()
        print(f"💾 Cópia local salva (vendedores_anuais): {db_path} | Registros: {len(rows)}")
    finally:
        con.close()


# ============================================================
# ✅ INTEGRAÇÕES (ANUAL)
# ============================================================
def integrar_vendas_geral() -> bool:
    if not os.path.exists(CAMINHO_EXCEL):
        print(f"❌ Arquivo Excel não encontrado em: {CAMINHO_EXCEL}")
        return False

    print("📊 Lendo Excel ANUAL (Aba VENDAS)...")
    try:
        df = pd.read_excel(CAMINHO_EXCEL, sheet_name="VENDAS", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Excel VENDAS: {e}")
        return False

    print(f"📌 Linhas lidas (bruto): {len(df)}")

    if "CANCELADO" in df.columns:
        df = df[df["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()
        print(f"📌 Linhas após remover canceladas: {len(df)}")

    col_data = "DATA_EMISSAO"
    col_vendedor = "NOME_VENDEDOR"
    col_desc = "DESCRICAO"
    col_qtd = "QTD REAL" if "QTD REAL" in df.columns else "QUANTIDADE"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df.columns else "NOME_FANTASIA"
    col_familia = "CATEGORIA REAL" if "CATEGORIA REAL" in df.columns else "CATEGORIA"
    col_regiao = "REGIAO"

    # validações mínimas
    for req in [col_data, col_vendedor, col_desc, col_loja]:
        if req not in df.columns:
            print(f"❌ ERRO: Coluna obrigatória '{req}' não encontrada na aba VENDAS.")
            return False

    if col_regiao not in df.columns:
        df[col_regiao] = ""

    try:
        treated = pd.DataFrame()

        treated["data_emissao"] = pd.to_datetime(df[col_data], dayfirst=True, errors="coerce")
        treated = treated.dropna(subset=["data_emissao"])
        treated["data_emissao"] = treated["data_emissao"].dt.strftime("%Y-%m-%d")

        treated["nome_vendedor"] = df[col_vendedor].astype(str).str.strip().str.upper()
        treated["descricao"] = df[col_desc].astype(str).str.strip().str.upper()

        treated["quantidade"] = pd.to_numeric(df[col_qtd], errors="coerce").fillna(0) if col_qtd in df.columns else 0

        # coluna S (índice 18) = valor real
        if df.shape[1] <= 18:
            print("❌ ERRO: planilha não tem a coluna S (índice 18) para VALOR REAL.")
            return False
        treated["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)

        treated["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)
        treated["familia"] = df[col_familia].astype(str).str.strip().str.upper() if col_familia in df.columns else "OUTROS"
        treated["regiao"] = df[col_regiao].astype(str).str.strip().str.upper()

        treated = treated.dropna(subset=["cnpj_empresa"])

        # mantém devoluções/negativos também (ANUAL geralmente inclui)
        treated = treated[(treated["total_liquido"].abs() > 0.01) | (treated["quantidade"].abs() > 0.001)].copy()

        print(f"✅ Linhas prontas para enviar (anuais): {len(treated)}")

    except Exception as e:
        print(f"❌ Erro tratamento VENDAS anuais: {e}")
        return False

    dados_json = treated.to_dict(orient="records")

    # salva cópia local
    salvar_copia_vendas(dados_json)

    # envia para endpoint anual
    ok = enviar_dados_para_api("/api/sync/vendas_anuais", dados_json)

    if ok:
        print("✅ Vendas anuais enviadas e sincronizadas com sucesso.")
        time.sleep(3)
        return True

    print("❌ Falha ao enviar vendas anuais.")
    return False


def integrar_kpi_vendedores() -> bool:
    print("🏆 Calculando KPIs Anuais...")

    try:
        df_vendas = pd.read_excel(CAMINHO_EXCEL, sheet_name="VENDAS", engine="openpyxl")
        df_meta = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Excel (KPIs anuais): {e}")
        return False

    col_vendedor = "NOME_VENDEDOR"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df_vendas.columns else "NOME_FANTASIA"

    if "CANCELADO" in df_vendas.columns:
        df_vendas = df_vendas[df_vendas["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    if col_vendedor not in df_vendas.columns or col_loja not in df_vendas.columns:
        print("❌ ERRO: Colunas essenciais não encontradas na aba VENDAS (KPIs).")
        return False

    # total real = coluna S (índice 18)
    if df_vendas.shape[1] <= 18:
        print("❌ ERRO: planilha não tem a coluna S (índice 18) para TOTAL REAL.")
        return False
    df_vendas["total_real"] = pd.to_numeric(df_vendas.iloc[:, 18], errors="coerce").fillna(0)

    # qtd_real
    if "QTD REAL" in df_vendas.columns:
        df_vendas["qtd_real"] = pd.to_numeric(df_vendas["QTD REAL"], errors="coerce").fillna(0)
    elif "QUANTIDADE" in df_vendas.columns:
        df_vendas["qtd_real"] = pd.to_numeric(df_vendas["QUANTIDADE"], errors="coerce").fillna(0)
    else:
        df_vendas["qtd_real"] = 0

    if "NOTA_FISCAL" not in df_vendas.columns:
        df_vendas["NOTA_FISCAL"] = ""
    if "REGIAO" not in df_vendas.columns:
        df_vendas["REGIAO"] = ""

    # KPI real por vendedor
    kpi_real = (
        df_vendas.groupby(col_vendedor)
        .agg({
            "total_real": "sum",
            "qtd_real": "sum",
            col_loja: "first",
            "NOTA_FISCAL": pd.Series.nunique,
            "REGIAO": "first",
        })
        .reset_index()
    )

    # metas/histórico
    df_meta_clean = pd.DataFrame()
    try:
        df_meta_clean["vendedor"] = df_meta.iloc[:, 1].astype(str).str.strip().str.upper()  # B
        df_meta_clean["tendencia"] = pd.to_numeric(df_meta.iloc[:, 2], errors="coerce").fillna(0)  # C
        df_meta_clean["fat_anterior"] = pd.to_numeric(df_meta.iloc[:, 4], errors="coerce").fillna(0)  # E
        df_meta_clean["valor_seguros"] = pd.to_numeric(df_meta.iloc[:, 9], errors="coerce").fillna(0)  # J
        df_meta_clean["pct_seguro"] = pd.to_numeric(df_meta.iloc[:, 18], errors="coerce").fillna(0)  # S
    except Exception as e:
        print(f"⚠️ Aviso: falha ao ler colunas da aba API VENDEDORES: {e}")
        df_meta_clean = pd.DataFrame(columns=["vendedor","tendencia","fat_anterior","valor_seguros","pct_seguro"])

    df_final = pd.merge(kpi_real, df_meta_clean, left_on=col_vendedor, right_on="vendedor", how="left")

    output_list: List[Dict[str, Any]] = []

    for _, row in df_final.iterrows():
        vendedor = str(row[col_vendedor]).strip().upper()
        if vendedor in ("NAN", "NONE", ""):
            continue

        nome_loja_sujo = "" if pd.isna(row.get(col_loja, "")) else str(row.get(col_loja, ""))
        nome_loja_limpo = get_clean_store_name(nome_loja_sujo)

        total = float(row.get("total_real", 0) or 0)
        qtd = float(row.get("qtd_real", 0) or 0)

        num_nf = int(row.get("NOTA_FISCAL", 1) or 1)
        if num_nf <= 0:
            num_nf = 1

        ticket = total / num_nf if num_nf > 0 else 0.0
        pa = qtd / num_nf if num_nf > 0 else 0.0

        anterior = float(row.get("fat_anterior", 0) or 0)
        crescimento = ((total - anterior) / anterior) if anterior > 0 else 0.0

        regiao = "" if pd.isna(row.get("REGIAO", "")) else str(row.get("REGIAO", "")).strip().upper()
        pct_seguro = float(row.get("pct_seguro", 0) or 0)
        seguros_val = float(row.get("valor_seguros", 0) or 0)
        tendencia_val = float(row.get("tendencia", 0) or 0)

        output_list.append({
            "loja": nome_loja_limpo,
            "vendedor": vendedor,
            "fat_atual": total,
            "tendencia": tendencia_val,
            "fat_anterior": anterior,
            "crescimento": crescimento,
            "pa": pa,
            "ticket": ticket,
            "qtd": qtd,
            "regiao": regiao,
            "pct_seguro": pct_seguro,
            "seguros": seguros_val,
        })

    print(f"📊 KPIs anuais processados: {len(output_list)} vendedores.")

    # salva cópia local
    salvar_copia_vendedores(output_list)

    # envia para endpoint anual
    ok = enviar_dados_para_api("/api/sync/vendedores_anuais", output_list)

    if ok:
        print("✅ KPIs anuais enviados com sucesso!")
        return True

    print("❌ Falha ao enviar KPIs anuais.")
    return False


if __name__ == "__main__":
    if not URL_BACKEND:
        print("❌ ERRO FATAL: Não foi possível definir a URL do backend.")
        raise SystemExit(1)

    ok_vendas = integrar_vendas_geral()
    if ok_vendas:
        integrar_kpi_vendedores()
    else:
        print("⚠️ KPI anual não foi enviado porque VENDAS anuais não confirmou sucesso (evita SQLITE_BUSY/lock).")