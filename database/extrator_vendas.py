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

# ✅ [NOVO] LISTA DE CORREÇÃO MANUAL (BLINDAGEM)
# Garante que nomes errados do Excel virem nomes certos do Sistema
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
    """
    Converte o nome da loja vindo do Excel (LOJA SISTEMA / NOME_FANTASIA)
    para CNPJ limpo, baseado no mapa.
    """
    t = norm(loja)
    
    # ✅ [CORREÇÃO 1] Verifica a lista manual primeiro
    if t in CORRECAO_NOMES:
        t = CORRECAO_NOMES[t]

    # Remove prefixos comuns
    for prefix in ["SAMSUNG - MRF - ", "SSG "]:
        if t.startswith(prefix):
            t = norm(t[len(prefix):])

    # Aplica aliases
    t = ALIASES_N.get(t, t)

    return REVERSE_LOJAS.get(t)

# ✅ [NOVO] FUNÇÃO DE LIMPEZA DE NOME
def get_clean_store_name(raw_name: Any) -> str:
    """Função Mestra para limpar nomes de lojas antes de salvar"""
    nome_sujo = norm(raw_name)
    
    # 1. Verifica Correção Manual Direta (Mais confiável)
    if nome_sujo in CORRECAO_NOMES:
        return CORRECAO_NOMES[nome_sujo]
    
    # 2. Verifica se já é um nome oficial (ex: PARK SHOPPING)
    if nome_sujo in REVERSE_LOJAS:
        return LOJAS_MAP[REVERSE_LOJAS[nome_sujo]]
        
    # 3. Tenta via CNPJ (Fallback)
    cnpj = loja_para_cnpj(nome_sujo)
    if cnpj and cnpj in LOJAS_MAP:
        return LOJAS_MAP[cnpj]
        
    return nome_sujo # Retorna o original se não achar nada


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
    # Verifica se arquivo existe
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

    # Remove canceladas
    if "CANCELADO" in df.columns:
        df = df[df["CANCELADO"].astype(str).str.strip().str.upper() == "N"].copy()
        print(f"📌 Linhas após remover canceladas: {len(df)}")

    # Definição das colunas (apenas para referência, pois vamos forçar a S)
    col_data = "DATA_EMISSAO"
    col_vendedor = "NOME_VENDEDOR"
    col_desc = "DESCRICAO"
    col_qtd = "QUANTIDADE" if "QUANTIDADE" in df.columns else "QTD REAL"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df.columns else "NOME_FANTASIA"
    col_familia = "CATEGORIA REAL" if "CATEGORIA REAL" in df.columns else "CATEGORIA"
    col_regiao = "REGIAO"

    try:
        # 1. CRIA A TABELA PRIMEIRO (Isso resolve o seu erro)
        treated = pd.DataFrame()

        # 2. PREENCHE AS COLUNAS PADRÃO
        treated["data_emissao"] = pd.to_datetime(df[col_data], dayfirst=True, errors="coerce")
        treated = treated.dropna(subset=["data_emissao"])
        treated["data_emissao"] = treated["data_emissao"].dt.strftime("%Y-%m-%d")

        treated["nome_vendedor"] = df[col_vendedor].astype(str).str.strip().str.upper()
        treated["descricao"] = df[col_desc].astype(str).str.strip().str.upper()
        
        # Quantidade
        treated["quantidade"] = pd.to_numeric(df[col_qtd], errors="coerce").fillna(0)

        # -----------------------------------------------------------
        # 🎯 AQUI ESTÁ A CORREÇÃO: COLUNA S (Índice 18)
        # -----------------------------------------------------------
        print(f"🎯 Usando coluna S (índice 18) para VALOR REAL...")
        treated["total_liquido"] = pd.to_numeric(df.iloc[:, 18], errors="coerce").fillna(0)
        # -----------------------------------------------------------

        # Mapeamento de Loja -> CNPJ
        # ✅ [CORREÇÃO 2] Usa a função que já tem a correção de nomes
        treated["cnpj_empresa"] = df[col_loja].map(loja_para_cnpj)

        # Família e Região
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

    # Envia para a API
    dados_json = treated.to_dict(orient="records")
    ok = enviar_dados_para_api("/api/sync/vendas", dados_json)

    if ok:
        print("✅ Vendas enviadas e sincronizadas com sucesso.")
        time.sleep(5) # Pausa de segurança
        return True
    else:
        print("❌ Falha ao enviar vendas.")
        return False


def integrar_kpi_vendedores():
    print("🏆 Calculando KPIs Reais (A partir da aba VENDAS)...")
    
    # 1. Carrega as duas abas
    try:
        df_vendas = pd.read_excel(CAMINHO_EXCEL, sheet_name="VENDAS", engine="openpyxl")
        df_meta = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine="openpyxl")
    except Exception as e:
        print(f"❌ Erro leitura Excel: {e}")
        return False

    # 2. Prepara a base de Vendas (Raw Data)
    # Garante que estamos lendo a Coluna S (Total Real) e Qtd Real
    col_vendedor = "NOME_VENDEDOR"
    col_loja = "LOJA SISTEMA" if "LOJA SISTEMA" in df_vendas.columns else "NOME_FANTASIA"
    
    # Limpeza básica
    df_vendas = df_vendas[df_vendas["CANCELADO"].astype(str).str.upper() == "N"].copy()
    
    # Força conversão numérica
    df_vendas["total_real"] = pd.to_numeric(df_vendas.iloc[:, 18], errors="coerce").fillna(0) # Coluna S
    df_vendas["qtd_real"] = pd.to_numeric(df_vendas["QTD REAL"], errors="coerce").fillna(0)
    
    # Agrupa por Vendedor para ter os Números Reais
    # Conta NF distintas para Ticket Médio e PA
    kpi_real = df_vendas.groupby(col_vendedor).agg({
        "total_real": "sum",
        "qtd_real": "sum",
        col_loja: "first", # Pega a loja do vendedor
        "NOTA_FISCAL": pd.Series.nunique, # Conta notas únicas para PA/Ticket
        "REGIAO": "first"
    }).reset_index()

    # 3. Prepara a base de Metas/Anterior (Do Excel API VENDEDORES)
    # Vamos pegar apenas o que não conseguimos calcular: Fat Anterior e % Crescimento Estimado
    df_meta_clean = pd.DataFrame()
    df_meta_clean["vendedor"] = df_meta.iloc[:, 1].astype(str).str.strip().str.upper() # Col B
    df_meta_clean["fat_anterior"] = pd.to_numeric(df_meta.iloc[:, 4], errors="coerce").fillna(0) # Col E
    df_meta_clean["pct_seguro"] = pd.to_numeric(df_meta.iloc[:, 18], errors="coerce").fillna(0) # Col S (% Seguro)

    # 4. Cruza as informações (Merge)
    # Usa os dados calculados (Real) e complementa com o Excel (Meta/Anterior)
    df_final = pd.merge(kpi_real, df_meta_clean, left_on=col_vendedor, right_on="vendedor", how="left")
    
    # 5. Monta o JSON Final
    output_list = []
    
    # Debug: Verificar lojas corrigidas
    lojas_salvas = set()

    for _, row in df_final.iterrows():
        vendedor = str(row[col_vendedor]).strip().upper()
        if vendedor == "NAN" or vendedor == "NONE": continue

        # --- AQUI É O PULO DO GATO: LIMPAR O NOME DA LOJA ---
        # ✅ [CORREÇÃO 3] Usando a nova função blindada get_clean_store_name
        nome_loja_sujo = str(row[col_loja])
        nome_loja_limpo = get_clean_store_name(nome_loja_sujo)
        
        # Guarda para debug no console
        if nome_loja_limpo != nome_loja_sujo.strip().upper():
            lojas_salvas.add(f"{nome_loja_sujo} -> {nome_loja_limpo}")
        # ----------------------------------------------------

        # Cálculos de KPI
        total = float(row["total_real"])
        qtd = int(row["qtd_real"])
        num_nf = int(row["NOTA_FISCAL"]) if row["NOTA_FISCAL"] > 0 else 1
        
        # Ticket Médio e PA Calculados na hora (Mais confiável que o Excel)
        ticket = total / num_nf if num_nf > 0 else 0
        pa = qtd / num_nf if num_nf > 0 else 0
        
        # Dados Históricos (do Excel)
        anterior = float(row["fat_anterior"]) if not pd.isna(row["fat_anterior"]) else 0
        
        # Cálculo de Crescimento vs Mês Anterior
        crescimento = ((total - anterior) / anterior) if anterior > 0 else 0

        output_list.append({
            "loja": nome_loja_limpo,     # ✅ AGORA SALVA O NOME LIMPO
            "vendedor": vendedor,
            "fat_atual": total,          
            "tendencia": 0,
            "fat_anterior": anterior,    
            "crescimento": crescimento,
            "pa": pa,
            "ticket": ticket,
            "qtd": qtd,
            "regiao": str(row["REGIAO"]).upper(),
            "pct_seguro": float(row["pct_seguro"]),
            "seguros": 0
        })

    # Envia
    print("🔎 DEBUG: Exemplos de lojas corrigidas:")
    for l in list(lojas_salvas)[:5]: 
        print(f"   {l}")

    print(f"📊 Processados {len(output_list)} vendedores com dados reais.")
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
        # ✅ ADICIONADO: só envia KPI se vendas estiver OK
        ok_vendas = integrar_vendas_geral()
        if ok_vendas:
            integrar_kpi_vendedores()
        else:
            print("⚠️ KPI não foi enviado porque VENDAS não confirmou sucesso (evita SQLITE_BUSY/lock).")