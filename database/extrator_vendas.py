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
    except:
        print(f"☁️ Servidor Local offline. Usando PRODUÇÃO: {prod_url}")
        return prod_url

# SALVAR O BANCO DE DADOS (CÓPIA LOCAL)
DB_COPIA_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
DB_COPIA_PATH = os.path.join(DB_COPIA_DIR, "samsung_vendas.db")

# --- CONFIGURAÇÕES ---
CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\BI AUTOMATICO\BI_SAMSUNG\Vendas_Diarias_2.0.xlsm"

# ✅ FORÇADO PARA PRODUÇÃO
URL_BACKEND = "https://telefluxo-aplicacao.onrender.com"
print("🚀 ENVIO FORÇADO PARA:", URL_BACKEND)

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

    if t in CORRECAO_NOMES:
        t = CORRECAO_NOMES[t]

    for prefix in ["SAMSUNG - MRF - ", "SSG "]:
        if t.startswith(prefix):
            t = norm(t[len(prefix):])

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
# ✅ PARSE DE DATA SEM AMBIGUIDADE
# ============================================================
def parse_data_emissao(series: pd.Series) -> pd.Series:
    s = series.copy()
    if pd.api.types.is_datetime64_any_dtype(s):
        return s

    s_str = s.astype(str).str.strip()
    s_date_only = s_str.str.split(' ').str[0]

    dt1 = pd.to_datetime(s_date_only, format="%Y-%m-%d", errors="coerce")
    mask_iso = dt1.isna()
    if mask_iso.any():
        dt2 = pd.to_datetime(s_date_only[mask_iso], format="%d/%m/%Y", errors="coerce")
        dt1.loc[mask_iso] = dt2

    mask_br = dt1.isna()
    if mask_br.any():
        dt3 = pd.to_datetime(s_date_only[mask_br], dayfirst=True, errors="coerce")
        dt1.loc[mask_br] = dt3

    return dt1


# ============================================================
# ✅ FUNÇÃO DE ENVIO EM LOTES
# ============================================================
def enviar_dados_para_api(endpoint: str, dados: List[Dict[str, Any]]) -> bool:
    if not isinstance(dados, list):
        print("❌ ERRO: dados não é uma lista.")
        return False

    if len(dados) == 0:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    dados = limpar_valores_json(dados)
    
    BATCH_SIZE = 100
    total_lotes = (len(dados) // BATCH_SIZE) + 1
    
    print(f"📡 Preparando envio de {len(dados)} registros em {total_lotes} lotes...")

    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados), BATCH_SIZE):
        lote = dados[i : i + BATCH_SIZE]
        lote_num = (i // BATCH_SIZE) + 1
        
        param_reset = "true" if i == 0 else "false"
        url_lote = f"{URL_BACKEND}{endpoint}?reset={param_reset}"

        print(f"   📦 Enviando Lote {lote_num}/{total_lotes} ({len(lote)} itens)...")

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=TIMEOUT)
                
                if 200 <= response.status_code < 300:
                    break 
                
                if response.status_code == 413:
                    print("   ❌ ERRO 413: O pacote ainda está muito grande.")
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

    print("✅ Todos os lotes enviados com sucesso!")
    return True


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

        cur.execute("DROP TABLE IF EXISTS vendedores")

        cur.execute("""
        CREATE TABLE IF NOT EXISTS vendedores (
            loja            TEXT,
            cnpj_empresa    TEXT,
            vendedor        TEXT,
            faturamento     REAL,
            tendencia       REAL,
            mes_anterior    REAL,
            crescimento     REAL,
            pct_acessorios  REAL,
            conv_peliculas  REAL,
            seguros         REAL,
            pct_seguro      REAL,
            pa              REAL,
            ticket_medio    REAL,
            pct_wearable    REAL,
            rs_aparelho     REAL,
            rs_acessorio    REAL,
            rs_tablet       REAL,
            rs_wearable     REAL
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

#DADOS VENDEDORES
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
                r.get("cnpj_empresa"),
                r.get("vendedor"),
                r.get("faturamento", 0),
                r.get("tendencia", 0),
                r.get("mes_anterior", 0),
                r.get("crescimento", 0),
                r.get("pct_acessorios", 0),
                r.get("conv_peliculas", 0),
                r.get("seguros", 0),
                r.get("pct_seguro", 0),
                r.get("pa", 0),
                r.get("ticket_medio", 0),
                r.get("pct_wearable", 0),
                r.get("rs_aparelho", 0),
                r.get("rs_acessorio", 0),
                r.get("rs_tablet", 0),
                r.get("rs_wearable", 0),
            ))

        cur.executemany("""
            INSERT INTO vendedores (
                loja, cnpj_empresa, vendedor, faturamento, tendencia, mes_anterior,
                crescimento, pct_acessorios, conv_peliculas, seguros, pct_seguro, pa,
                ticket_medio, pct_wearable, rs_aparelho, rs_acessorio,
                rs_tablet, rs_wearable
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    if "CANCELADO" in df.columns:
        df = df[df["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    col_data = "DATA_EMISSAO"
    col_vendedor = "NOME_VENDEDOR"
    col_desc = "MODELOS" if "MODELOS" in df.columns else "modelos"
    col_qtd = "QTD REAL" if "QTD REAL" in df.columns else "QUANTIDADE"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df.columns else "NOME_FANTASIA"
    col_familia = "CATEGORIA REAL" if "CATEGORIA REAL" in df.columns else "CATEGORIA"
    col_regiao = "REGIAO"

    try:
        treated = pd.DataFrame()

        treated["data_emissao"] = parse_data_emissao(df[col_data])
        treated = treated.dropna(subset=["data_emissao"])
        treated["data_emissao"] = treated["data_emissao"].dt.strftime("%Y-%m-%d")

        treated["nome_vendedor"] = df[col_vendedor].astype(str).str.strip().str.upper()
        treated["descricao"] = df[col_desc].astype(str).str.strip().str.upper()

        treated["quantidade"] = pd.to_numeric(df[col_qtd], errors="coerce").fillna(0)

        treated["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)

        treated["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)
        treated["familia"] = df[col_familia].astype(str).str.strip().str.upper()
        treated["regiao"] = df[col_regiao].astype(str).str.strip().str.upper()

        treated = treated.dropna(subset=["cnpj_empresa"])
        treated = treated[(treated["total_liquido"].abs() > 0.01) | (treated["quantidade"].abs() > 0.001)].copy()

    except Exception as e:
        print(f"❌ Erro tratamento VENDAS: {e}")
        return False

    dados_json = treated.to_dict(orient="records")

    salvar_copia_vendas(dados_json)
    ok = enviar_dados_para_api("/api/sync/vendas", dados_json)

    if ok:
        print("✅ Vendas enviadas e sincronizadas com sucesso.")
        time.sleep(5)
        return True
    else:
        print("❌ Falha ao enviar vendas.")
        return False


def clean_number(val) -> float:
    """ Limpador inteligente para remover R$, % e espaços antes de converter para float """
    if pd.isna(val) or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    
    val_str = str(val).upper().replace('R$', '').replace('%', '').strip()
    
    # Lida com separadores numéricos padrão Brasil (ex: 1.500,50 -> 1500.50)
    if ',' in val_str and '.' in val_str:
        val_str = val_str.replace('.', '').replace(',', '.')
    elif ',' in val_str:
        val_str = val_str.replace(',', '.')
        
    try:
        return float(val_str)
    except:
        return 0.0

def montar_mapa_vendedor_loja_pelas_vendas() -> Dict[str, str]:
    """
    Usa a aba VENDAS como fonte principal para descobrir a loja canônica de cada vendedor.
    Se um vendedor tiver vendas em mais de uma loja no período, escolhe a loja com maior faturamento.
    """
    if not os.path.exists(CAMINHO_EXCEL):
        return {}

    try:
        df = pd.read_excel(CAMINHO_EXCEL, sheet_name="VENDAS", engine="openpyxl")
    except Exception as e:
        print(f"⚠️ Não foi possível montar mapa vendedor->loja pelas vendas: {e}")
        return {}

    if "CANCELADO" in df.columns:
        df = df[df["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()

    col_vendedor = "NOME_VENDEDOR"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df.columns else "NOME_FANTASIA"

    try:
        work = pd.DataFrame()
        work["vendedor"] = df[col_vendedor].astype(str).str.strip().str.upper()
        work["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)
        work["loja"] = work["cnpj_empresa"].map(LOJAS_MAP)

        # usa a mesma coluna de valor já usada em vendas
        work["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)

        work = work.dropna(subset=["vendedor", "loja"]).copy()
        work = work[~work["vendedor"].isin(["", "NAN", "NONE"])]

        if work.empty:
            return {}

        resumo = (
            work.groupby(["vendedor", "loja"], as_index=False)["total_liquido"]
            .sum()
            .sort_values(["vendedor", "total_liquido"], ascending=[True, False])
        )

        mapa = {}
        for vendedor, grupo in resumo.groupby("vendedor"):
            mapa[vendedor] = str(grupo.iloc[0]["loja"]).strip().upper()

        print(f"🧭 Mapa vendedor->loja montado pelas vendas: {len(mapa)} vendedores")
        return mapa

    except Exception as e:
        print(f"⚠️ Erro ao montar mapa vendedor->loja: {e}")
        return {}


def integrar_kpi_vendedores():
    print("🏆 Lendo KPIs dos Vendedores (Aba API VENDEDORES)...")

    try:
        df_meta = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Excel (API VENDEDORES): {e}")
        return False

    # Padroniza todas as colunas do Excel para maiúsculo para evitar erros de digitação
    df_meta.columns = df_meta.columns.astype(str).str.strip().str.upper()

    # ✅ NOVO: prioriza a loja canônica descoberta pela aba VENDAS
    mapa_vendedor_loja = montar_mapa_vendedor_loja_pelas_vendas()

    output_list = []
    lojas_salvas = set()

    for _, row in df_meta.iterrows():
        # Busca o Vendedor
        vendedor = str(row.get("VENDEDOR", "")).strip().upper()
        if vendedor in ("NAN", "NONE", ""):
            continue

        # Busca e limpa a Loja
        nome_loja_sujo = str(row.get("LOJA", "")).strip()
        nome_loja_limpo = get_clean_store_name(nome_loja_sujo)

        # ✅ PRIORIDADE: loja das VENDAS
        loja_pelas_vendas = mapa_vendedor_loja.get(vendedor)

        if loja_pelas_vendas:
            if norm(loja_pelas_vendas) != norm(nome_loja_limpo):
                lojas_salvas.add(f"{vendedor}: KPI={nome_loja_limpo} -> VENDAS={loja_pelas_vendas}")
            nome_loja_final = loja_pelas_vendas
        else:
            nome_loja_final = nome_loja_limpo
            if norm(nome_loja_limpo) != norm(nome_loja_sujo):
                lojas_salvas.add(f"{nome_loja_sujo} -> {nome_loja_limpo}")

        # Função auxiliar para buscar o valor tentando variações do nome da coluna
        def get_val(variacoes_coluna):
            for col in variacoes_coluna:
                if col in df_meta.columns:
                    return clean_number(row[col])
            return 0.0

        # ✅ MAPEAMENTO EXATO COM AS COLUNAS SOLICITADAS
        output_list.append({
            "loja": nome_loja_final,
            "cnpj_empresa": REVERSE_LOJAS.get(norm(nome_loja_final)),
            "vendedor": vendedor,
            "faturamento": get_val(["FATURAMENTO"]),
            "tendencia": get_val(["TENDENCIA MÊS", "TENDENCIA MES"]),
            "mes_anterior": get_val(["MÊS ANTERIOR", "MES ANTERIOR"]),
            "crescimento": get_val(["% CRESCIMENTO"]),
            "conv_peliculas": get_val(["% CONV PELÍCULAS", "% CONV PELICULAS"]),
            "seguros": get_val(["SEGUROS"]),
            "pct_seguro": get_val(["% SEGURO"]),
            "pa": get_val(["P.A", "PA"]),
            "ticket_medio": get_val(["TICKET MEDIO", "TICKET MÉDIO"]),
            "pct_wearable": get_val(["% WEARABLE"]),
            "rs_aparelho": get_val(["R$ APARELHO"]),
            "rs_acessorio": get_val(["R$ ACESSORIO", "R$ ACESSÓRIO"]),
            "rs_tablet": get_val(["R$ TABLET"]),
            "rs_wearable": get_val(["R$ WEARABLE"]),
            "pct_acessorios": get_val([
                "% ACESSORIOS",
                "% ACESSÓRIOS",
                "% CONV ACESSORIOS",
                "% CONV ACESSÓRIOS",
                "CONV ACESSORIOS",
                "CONV ACESSÓRIOS"
            ]),
        })

    if lojas_salvas:
        print("🔎 DEBUG: Algumas lojas precisaram ser padronizadas/alinhadas:")
        for l in list(lojas_salvas)[:20]:
            print(f"   {l}")

    print(f"📊 Processados {len(output_list)} registros de Vendedores.")

    salvar_copia_vendedores(output_list)
    ok = enviar_dados_para_api("/api/sync/vendedores", output_list)

    if ok:
        print("✅ KPIs de Vendedores sincronizados com sucesso!")
        return True
    else:
        print("❌ Falha ao enviar KPIs.")
        return False


if __name__ == "__main__":
    if not URL_BACKEND:
        print("❌ ERRO FATAL: Não foi possível definir a URL do backend.")
    else:
        ok_vendas = integrar_vendas_geral()
        if ok_vendas:
            integrar_kpi_vendedores()
        else:
            print("⚠️ KPI não foi enviado porque VENDAS não confirmou sucesso (evita travamento do banco).")