import pandas as pd
import requests
import os
import re
from typing import List, Dict, Any

# ✅ ADICIONADO
import time

# --- CONFIGURAÇÕES ---
CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\BI AUTOMATICO\BI_SAMSUNG\Vendas_Diarias_2.0.xlsm"
URL_BACKEND = "https://telefluxo-aplicacao.onrender.com"

TIMEOUT = (10, 180)  # (conexão, resposta) em segundos

# ✅ ADICIONADO: política de retry
RETRY_STATUS = {502, 503, 504}
MAX_RETRIES = 6  # aumentei para aguentar Render/lock (não remove nada, só adiciona)
BASE_WAIT_SECONDS = 8  # backoff base


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
    """
    Converte o nome da loja vindo do Excel (LOJA SISTEMA / NOME_FANTASIA)
    para CNPJ limpo, baseado no mapa.
    """
    t = norm(loja)

    # Remove prefixos comuns
    for prefix in ["SAMSUNG - MRF - ", "SSG "]:
        if t.startswith(prefix):
            t = norm(t[len(prefix):])

    # Aplica aliases
    t = ALIASES_N.get(t, t)

    return REVERSE_LOJAS.get(t)


def limpar_valores_json(dados: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Converte NaN/NaT para None."""
    cleaned = []
    for row in dados:
        new_row = {}
        for k, v in row.items():
            if pd.isna(v):
                new_row[k] = None
            else:
                new_row[k] = v
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

    # ✅ ADICIONADO: retry com backoff para TIMEOUT/502/503/504/SQLITE_BUSY
    headers = {"Content-Type": "application/json"}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(url, json=dados, headers=headers, timeout=TIMEOUT)

            # ✅ Sucesso: qualquer 2xx
            if 200 <= response.status_code < 300:
                try:
                    payload = response.json()
                    msg = payload.get("message") if isinstance(payload, dict) else payload
                except Exception:
                    msg = response.text[:300]
                print(f"✅ Sucesso ({response.status_code}) - {msg}")
                return True

            # ✅ Se vier 502/503/504, tenta novamente
            if response.status_code in RETRY_STATUS:
                wait = BASE_WAIT_SECONDS * attempt
                print(
                    f"⚠️ Servidor instável/ocupado ({response.status_code}). "
                    f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            # ✅ Se o backend devolver SQLITE_BUSY em texto (caso você trate e devolva mensagem)
            if "SQLITE_BUSY" in (response.text or "") or "database is locked" in (response.text or ""):
                wait = BASE_WAIT_SECONDS * attempt
                print(
                    f"⚠️ Banco ocupado (SQLITE_BUSY). "
                    f"Tentando novamente em {wait}s... (tentativa {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            # ❌ Falha definitiva (outros status)
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


def integrar_vendas_geral():
    # ✅ ADICIONADO: retornar bool (mantém tudo e só acrescenta retorno)
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

    # Remove canceladas (coluna existe na sua planilha)
    if "CANCELADO" in df.columns:
        df = df[df["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()
        print(f"📌 Linhas após remover canceladas: {len(df)}")

    # Escolhe colunas corretas (pela planilha real)
    col_data = "DATA_EMISSAO"
    col_vendedor = "NOME_VENDEDOR"
    col_desc = "DESCRICAO"
    col_qtd = "QUANTIDADE" if "QUANTIDADE" in df.columns else "QTD REAL"
    nome_coluna_s = df.columns[18] 
    print(f"🎯 Usando coluna S para valor: {nome_coluna_s}")        
    treated["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)
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
        treated["total_liquido"] = pd.to_numeric(df[col_total], errors="coerce").fillna(0)

        # 🔥 Aqui é a correção principal: LOJA -> CNPJ
        treated["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)

        treated["familia"] = df[col_familia].astype(str).str.strip().str.upper()
        treated["regiao"] = df[col_regiao].astype(str).str.strip().str.upper()

        # Filtra linhas inválidas
        treated = treated.dropna(subset=["cnpj_empresa"])
        treated = treated[
            (treated["total_liquido"] > 0.01) | (treated["quantidade"] > 0.001)
        ].copy()

        print(f"✅ Linhas prontas para enviar: {len(treated)}")

    except Exception as e:
        print(f"❌ Erro tratamento VENDAS: {e}")
        return False

    dados_json = treated.to_dict(orient="records")
    ok = enviar_dados_para_api("/api/sync/vendas", dados_json)

    if ok:
        print("✅ Vendas enviadas e sincronizadas com sucesso.")
        # ✅ ADICIONADO: pequena pausa para reduzir chance de lock no SQLite
        time.sleep(10)
        return True
    else:
        print("❌ Falha ao enviar vendas.")
        return False


def integrar_kpi_vendedores():
    # ✅ ADICIONADO: retornar bool
    print("🏆 Lendo Aba API VENDEDORES...")
    try:
        df = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Aba Vendedores: {e}")
        return False

    df_kpi = pd.DataFrame()
    try:
        df_kpi["loja"] = df.iloc[:, 0].astype(str).str.strip().str.upper()          # A
        df_kpi["vendedor"] = df.iloc[:, 1].astype(str).str.strip().str.upper()      # B
        df_kpi["fat_atual"] = pd.to_numeric(df.iloc[:, 2], errors="coerce").fillna(0)       # C
        df_kpi["tendencia"] = pd.to_numeric(df.iloc[:, 3], errors="coerce").fillna(0)      # D
        df_kpi["fat_anterior"] = pd.to_numeric(df.iloc[:, 4], errors="coerce").fillna(0)   # E
        df_kpi["crescimento"] = pd.to_numeric(df.iloc[:, 5], errors="coerce").fillna(0)    # F
        df_kpi["seguros"] = pd.to_numeric(df.iloc[:, 9], errors="coerce").fillna(0)        # J
        df_kpi["pa"] = pd.to_numeric(df.iloc[:, 12], errors="coerce").fillna(0)            # M
        df_kpi["qtd"] = pd.to_numeric(df.iloc[:, 13], errors="coerce").fillna(0)           # N
        df_kpi["ticket"] = pd.to_numeric(df.iloc[:, 14], errors="coerce").fillna(0)        # O
        df_kpi["regiao"] = df.iloc[:, 16].astype(str).str.strip().str.upper()              # Q
        df_kpi["pct_seguro"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)    # S

        df_kpi = df_kpi[df_kpi["vendedor"].notna()]
        df_kpi = df_kpi[df_kpi["vendedor"].astype(str).str.upper() != "NAN"]

    except Exception as e:
        print(f"❌ Erro mapeamento KPI Vendedores: {e}")
        return False

    dados_json = df_kpi.to_dict(orient="records")
    ok = enviar_dados_para_api("/api/sync/vendedores", dados_json)

    if ok:
        print("✅ KPIs enviados e sincronizados com sucesso.")
        return True
    else:
        print("❌ Falha ao enviar KPIs.")
        return False


if __name__ == "__main__":
    if not URL_BACKEND.startswith("http"):
        print("❌ ERRO: URL_BACKEND inválida.")
    else:
        # ✅ ADICIONADO: só envia KPI se vendas estiver OK
        ok_vendas = integrar_vendas_geral()
        if ok_vendas:
            integrar_kpi_vendedores()
        else:
            print("⚠️ KPI não foi enviado porque VENDAS não confirmou sucesso (evita SQLITE_BUSY/lock).")
