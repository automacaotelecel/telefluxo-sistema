import pandas as pd
import requests
import os
import re
from typing import List, Dict, Any
import sqlite3
from datetime import datetime
import time

# SALVAR O BANCO DE DADOS (CÓPIA LOCAL)
DB_COPIA_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
DB_COPIA_PATH = os.path.join(DB_COPIA_DIR, "samsung_vendas.db")

# --- CONFIGURAÇÕES ---
CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\BI AUTOMATICO\BI_SAMSUNG\Vendas_Diarias_2.0.xlsm"
URL_BACKEND = "https://telefluxo-aplicacao.onrender.com"
TIMEOUT = (10, 180)  # (conexão, resposta) em segundos

# ✅ política de retry
RETRY_STATUS = {502, 503, 504}
MAX_RETRIES = 6
BASE_WAIT_SECONDS = 8


# ===== MAPA DE LOJAS (CNPJ -> NOME) =====
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

# ✅ LISTA DE CORREÇÃO MANUAL (BLINDAGEM)
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
    "PARK": "PARK SHOPPING"
}

def norm(s: Any) -> str:
    s = "" if s is None else str(s)
    s = s.strip().upper()
    s = re.sub(r"\s+", " ", s)
    return s

# Reverse map: NOME -> CNPJ
REVERSE_LOJAS = {norm(nome): cnpj for cnpj, nome in LOJAS_MAP.items()}

# Aliases (nomes que aparecem no Excel -> nome oficial do mapa)
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
    """Função Mestra para limpar nomes de lojas antes de salvar"""
    nome_sujo = norm(raw_name)

    # 1) Correção Manual Direta
    if nome_sujo in CORRECAO_NOMES:
        return CORRECAO_NOMES[nome_sujo]

    # 2) Já é nome oficial
    if nome_sujo in REVERSE_LOJAS:
        return LOJAS_MAP[REVERSE_LOJAS[nome_sujo]]

    # 3) Fallback via CNPJ
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


def enviar_dados_para_api(endpoint: str, dados: List[Dict[str, Any]]) -> bool:
    url = f"{URL_BACKEND}{endpoint}"

    if not isinstance(dados, list):
        print("❌ ERRO: dados não é uma lista.")
        return False

    if len(dados) == 0:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    dados = limpar_valores_json(dados)

    print(f"📡 Enviando {len(dados)} registros para: {url}...")

    headers = {"Content-Type": "application/json"}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(url, json=dados, headers=headers, timeout=TIMEOUT)

            if 200 <= response.status_code < 300:
                try:
                    payload = response.json()
                    msg = payload.get("message") if isinstance(payload, dict) else payload
                except Exception:
                    msg = response.text[:300]
                print(f"✅ Sucesso ({response.status_code}) - {msg}")
                return True

            if response.status_code in RETRY_STATUS:
                wait = BASE_WAIT_SECONDS * attempt
                print(
                    f"⚠️ Servidor instável/ocupado ({response.status_code}). "
                    f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            if "SQLITE_BUSY" in (response.text or "") or "database is locked" in (response.text or ""):
                wait = BASE_WAIT_SECONDS * attempt
                print(
                    f"⚠️ Banco ocupado (SQLITE_BUSY). "
                    f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            print(f"❌ Falha ({response.status_code}) - {response.text[:800]}")
            return False

        except requests.exceptions.Timeout:
            wait = BASE_WAIT_SECONDS * attempt
            print(
                f"⚠️ Timeout: o servidor demorou para responder. "
                f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
            )
            time.sleep(wait)
            continue

        except requests.exceptions.ConnectionError as e:
            wait = BASE_WAIT_SECONDS * attempt
            print(
                f"⚠️ Erro de conexão: {e}. "
                f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
            )
            time.sleep(wait)
            continue

        except Exception as e:
            print(f"❌ Erro inesperado: {e}")
            return False

    print("❌ Falha: excedeu o número de tentativas.")
    return False


# =========================
# CÓPIA LOCAL SQLITE
# =========================
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
        CREATE TABLE IF NOT EXISTS vendas (
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
        CREATE TABLE IF NOT EXISTS vendedores (
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
        CREATE TABLE IF NOT EXISTS _sync_meta (
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
        cur.execute("DELETE FROM vendas")

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
            INSERT INTO vendas (
                data_emissao, nome_vendedor, descricao, quantidade,
                total_liquido, cnpj_empresa, familia, regiao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

        cur.execute("""
            INSERT INTO _sync_meta (chave, valor)
            VALUES ('vendas_last_write', ?)
            ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))

        con.commit()
        print(f"💾 Cópia local salva (vendas): {db_path} | Registros: {len(rows)}")
    finally:
        con.close()


def salvar_copia_vendedores(dados_vendedores: List[Dict[str, Any]], db_path: str = DB_COPIA_PATH) -> None:
    criar_tabelas_copia(db_path)

    con = _sqlite_connect(db_path)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM vendedores")

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
            INSERT INTO vendedores (
                loja, vendedor, fat_atual, tendencia, fat_anterior,
                crescimento, pa, ticket, qtd, regiao, pct_seguro, seguros
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

        cur.execute("""
            INSERT INTO _sync_meta (chave, valor)
            VALUES ('vendedores_last_write', ?)
            ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))

        con.commit()
        print(f"💾 Cópia local salva (vendedores): {db_path} | Registros: {len(rows)}")
    finally:
        con.close()


# =========================
# INTEGRAÇÕES
# =========================
def integrar_vendas_geral():
    if not os.path.exists(CAMINHO_EXCEL):
        print("❌ Arquivo Excel não encontrado.")
        return False

    print("📊 Lendo Excel (Aba VENDAS)...")
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
    col_qtd = col_qtd = "QTD REAL" if "QTD REAL" in df.columns else "QUANTIDADE"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df.columns else "NOME_FANTASIA"
    col_familia = "CATEGORIA REAL" if "CATEGORIA REAL" in df.columns else "CATEGORIA"
    col_regiao = "REGIAO"

    try:
        treated = pd.DataFrame()

        treated["data_emissao"] = pd.to_datetime(df[col_data], dayfirst=True, errors="coerce")
        treated = treated.dropna(subset=["data_emissao"])
        treated["data_emissao"] = treated["data_emissao"].dt.strftime("%Y-%m-%d")

        treated["nome_vendedor"] = df[col_vendedor].astype(str).str.strip().str.upper()
        treated["descricao"] = df[col_desc].astype(str).str.strip().str.upper()

        treated["quantidade"] = pd.to_numeric(df[col_qtd], errors="coerce").fillna(0)

        print("🎯 Usando coluna S (índice 18) para VALOR REAL...")
        treated["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)

        treated["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)
        treated["familia"] = df[col_familia].astype(str).str.strip().str.upper()
        treated["regiao"] = df[col_regiao].astype(str).str.strip().str.upper()

        treated = treated.dropna(subset=["cnpj_empresa"])
        treated = treated[(treated["total_liquido"] > 0.01) | (treated["quantidade"] > 0.001)].copy()

        print(f"✅ Linhas prontas para enviar: {len(treated)}")

    except Exception as e:
        print(f"❌ Erro tratamento VENDAS: {e}")
        return False

    dados_json = treated.to_dict(orient="records")

    # ✅ primeiro salva cópia local (o que vai pro sistema)
    salvar_copia_vendas(dados_json)

    # ✅ envia apenas 1 vez
    ok = enviar_dados_para_api("/api/sync/vendas", dados_json)

    if ok:
        print("✅ Vendas enviadas e sincronizadas com sucesso.")
        time.sleep(5)
        return True
    else:
        print("❌ Falha ao enviar vendas.")
        return False


def integrar_kpi_vendedores():
    print("🏆 Calculando KPIs Reais (A partir da aba VENDAS)...")

    # 1) Carrega as duas abas
    try:
        df_vendas = pd.read_excel(CAMINHO_EXCEL, sheet_name="VENDAS", engine="openpyxl")
        df_meta   = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Excel: {e}")
        return False

    # 2) Base de vendas
    col_vendedor = "NOME_VENDEDOR"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df_vendas.columns else "NOME_FANTASIA"

    if "CANCELADO" in df_vendas.columns:
        df_vendas = df_vendas[df_vendas["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    # total real = coluna S (índice 18)
    df_vendas["total_real"] = pd.to_numeric(df_vendas.iloc[:, 18], errors="coerce").fillna(0)

    # qtd_real
    if "QTD REAL" in df_vendas.columns:
        df_vendas["qtd_real"] = pd.to_numeric(df_vendas["QTD REAL"], errors="coerce").fillna(0)
    elif "QUANTIDADE" in df_vendas.columns:
        df_vendas["qtd_real"] = pd.to_numeric(df_vendas["QUANTIDADE"], errors="coerce").fillna(0)
    else:
        df_vendas["qtd_real"] = 0

    # valida colunas essenciais
    if "NOTA_FISCAL" not in df_vendas.columns:
        print("❌ ERRO: Coluna NOTA_FISCAL não encontrada na aba VENDAS.")
        return False
    if "REGIAO" not in df_vendas.columns:
        df_vendas["REGIAO"] = ""

    # 3) Agrupa KPI real por vendedor
    kpi_real = (
        df_vendas.groupby(col_vendedor)
        .agg({
            "total_real": "sum",
            "qtd_real": "sum",
            col_loja: "first",
            "NOTA_FISCAL": pd.Series.nunique,
            "REGIAO": "first"
        })
        .reset_index()
    )

    # 4) Metas/histórico (API VENDEDORES)
    # --- CORREÇÃO AQUI: Lendo as colunas que faltavam ---
    df_meta_clean = pd.DataFrame()
    df_meta_clean["vendedor"] = df_meta.iloc[:, 1].astype(str).str.strip().str.upper()  # Col B (Nome)
    
    # Col C (Índice 2) -> TENDENCIA MÊS
    df_meta_clean["tendencia"] = pd.to_numeric(df_meta.iloc[:, 2], errors="coerce").fillna(0) 
    
    # Col E (Índice 4) -> MÊS ANTERIOR
    df_meta_clean["fat_anterior"] = pd.to_numeric(df_meta.iloc[:, 4], errors="coerce").fillna(0) 
    
    # Col J (Índice 9) -> SEGUROS (Valor Financeiro R$)
    df_meta_clean["valor_seguros"] = pd.to_numeric(df_meta.iloc[:, 9], errors="coerce").fillna(0)

    # Col S (Índice 18) -> % SEGURO
    df_meta_clean["pct_seguro"] = pd.to_numeric(df_meta.iloc[:, 18], errors="coerce").fillna(0) 

    # 5) Merge
    df_final = pd.merge(kpi_real, df_meta_clean, left_on=col_vendedor, right_on="vendedor", how="left")

    # 6) Monta JSON
    output_list = []
    lojas_salvas = set()

    for _, row in df_final.iterrows():
        vendedor = str(row[col_vendedor]).strip().upper()
        if vendedor in ("NAN", "NONE", ""):
            continue

        nome_loja_sujo = "" if pd.isna(row[col_loja]) else str(row[col_loja])
        nome_loja_limpo = get_clean_store_name(nome_loja_sujo)

        if norm(nome_loja_limpo) != norm(nome_loja_sujo):
            lojas_salvas.add(f"{nome_loja_sujo} -> {nome_loja_limpo}")

        total = float(row["total_real"]) if not pd.isna(row["total_real"]) else 0.0
        qtd = float(row["qtd_real"]) if not pd.isna(row["qtd_real"]) else 0.0
        num_nf = int(row["NOTA_FISCAL"]) if not pd.isna(row["NOTA_FISCAL"]) and int(row["NOTA_FISCAL"]) > 0 else 1

        ticket = total / num_nf if num_nf > 0 else 0.0
        pa = qtd / num_nf if num_nf > 0 else 0.0

        anterior = float(row["fat_anterior"]) if not pd.isna(row["fat_anterior"]) else 0.0
        crescimento = ((total - anterior) / anterior) if anterior > 0 else 0.0

        regiao = "" if pd.isna(row["REGIAO"]) else str(row["REGIAO"]).strip().upper()
        
        # Pega os valores lidos do Excel
        pct_seguro = float(row["pct_seguro"]) if not pd.isna(row["pct_seguro"]) else 0.0
        tendencia_val = float(row["tendencia"]) if not pd.isna(row["tendencia"]) else 0.0
        seguros_val = float(row["valor_seguros"]) if not pd.isna(row["valor_seguros"]) else 0.0

        output_list.append({
            "loja": nome_loja_limpo,
            "vendedor": vendedor,
            "fat_atual": total,
            "tendencia": tendencia_val, # AGORA USA O VALOR DO EXCEL
            "fat_anterior": anterior,
            "crescimento": crescimento,
            "pa": pa,
            "ticket": ticket,
            "qtd": qtd,
            "regiao": regiao,
            "pct_seguro": pct_seguro,
            "seguros": seguros_val      # AGORA USA O VALOR DO EXCEL
        })

    print("🔎 DEBUG: Exemplos de lojas corrigidas:")
    for l in list(lojas_salvas)[:5]:
        print(f"   {l}")

    print(f"📊 Processados {len(output_list)} vendedores com dados reais.")

    # ✅ salva cópia local do que vai para o sistema
    salvar_copia_vendedores(output_list)

    # ✅ envia para API
    ok = enviar_dados_para_api("/api/sync/vendedores", output_list)

    if ok:
        print("✅ KPIs Reais calculados e sincronizados!")
        return True
    else:
        print("❌ Falha ao enviar KPIs.")
        return False


if __name__ == "__main__":
    if not URL_BACKEND.startswith("http"):
        print("❌ ERRO: URL_BACKEND inválida.")
    else:
        ok_vendas = integrar_vendas_geral()
        if ok_vendas:
            integrar_kpi_vendedores()
        else:
            print("⚠️ KPI não foi enviado porque VENDAS não confirmou sucesso (evita SQLITE_BUSY/lock).")
