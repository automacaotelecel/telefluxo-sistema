# ===========================================
# ⚡ RELATÓRIO DE FORMAS DE PAGAMENTO MICROVIX
# Andre – Versão ajustada com parcelas garantidas
#
# Objetivo:
# - Extrair pagamentos de vendas
# - Identificar PIX, cartão, dinheiro, cheque, crediário, convênio, depósito etc.
# - Saber quantidade de parcelas
# - Ligar pagamentos mistos da mesma venda/operação financeira
#
# Chave de ligação principal:
#   cnpj_emp + identificador
#
# Complemento para múltiplos cartões na mesma venda:
#   ordem_cartao
#
# Banco de saída:
#   C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\forma_pgtos.db
#
# Melhorias desta versão:
# - Parser tolerante para achar qtde_parcelas em LinxMovimentoPlanos
# - Tabela final física: pagamentos_consolidados
# - View consolidada com qtde_parcelas
# - Logs de amostra para validar parcelas retornadas pela API
# ===========================================

import os
import sys
import time
import sqlite3
import logging
import math
from datetime import datetime
from typing import Dict, List, Optional, Any

import pandas as pd
import requests
from lxml import etree
from requests.auth import HTTPBasicAuth

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

URL_BACKEND = get_backend_url()
TIMEOUT = (10, 180)  # (conexão, resposta)
RETRY_STATUS = {502, 503, 504}
MAX_RETRIES = 6
BASE_WAIT_SECONDS = 8


def limpar_valores_json(dados: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for row in dados:
        new_row = {}
        for k, v in row.items():
            try:
                new_row[k] = None if pd.isna(v) else v
            except Exception:
                new_row[k] = v
        cleaned.append(new_row)
    return cleaned


def limpar_lote_dataframe(df_lote: pd.DataFrame) -> List[Dict[str, Any]]:
    records = df_lote.to_dict(orient="records")
    return limpar_valores_json(records)


def enviar_dataframe_para_api(
    endpoint: str,
    df: pd.DataFrame,
    batch_size: int = 25,
    pausa_entre_lotes: float = 0.35
) -> bool:
    if df is None or df.empty:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    total_registros = len(df)
    total_lotes = math.ceil(total_registros / batch_size)
    headers = {"Content-Type": "application/json"}

    print(f"📡 Preparando envio de {total_registros} registros em {total_lotes} lotes para {endpoint}...")

    for lote_idx, inicio in enumerate(range(0, total_registros, batch_size), start=1):
        fim = inicio + batch_size
        df_lote = df.iloc[inicio:fim].copy()
        lote = limpar_lote_dataframe(df_lote)

        param_reset = "true" if lote_idx == 1 else "false"
        param_last_batch = "true" if lote_idx == total_lotes else "false"
        url_lote = f"{URL_BACKEND}{endpoint}?reset={param_reset}&last_batch={param_last_batch}"

        print(f"   📦 Enviando Lote {lote_idx}/{total_lotes} ({len(lote)} itens)...")

        ok_lote = False

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=TIMEOUT)

                if 200 <= response.status_code < 300:
                    ok_lote = True
                    break

                if response.status_code == 413:
                    print("   ❌ ERRO 413: O pacote ainda está muito grande. Diminua o batch_size.")
                    return False

                if response.status_code in RETRY_STATUS or "SQLITE_BUSY" in response.text:
                    wait_time = BASE_WAIT_SECONDS * attempt
                    print(f"      ⏳ Servidor ocupado ({response.status_code})... Aguardando {wait_time}s")
                    time.sleep(wait_time)
                    continue

                print(f"   ❌ Erro Fatal no Lote {lote_idx}: {response.status_code} - {response.text[:300]}")
                return False

            except Exception as e:
                wait_time = BASE_WAIT_SECONDS * attempt
                print(f"   ⚠️ Erro conexão Lote {lote_idx}: {e}")
                time.sleep(wait_time)

        if not ok_lote:
            print(f"   ❌ Falha fatal no Lote {lote_idx} após todas tentativas.")
            return False

        time.sleep(pausa_entre_lotes)

    print(f"✅ Todos os lotes de {endpoint} enviados com sucesso!")
    return True


def enviar_dados_para_api(endpoint: str, dados: List[Dict[str, Any]]) -> bool:
    if not isinstance(dados, list):
        print("❌ ERRO: dados não é uma lista.")
        return False

    if len(dados) == 0:
        print(f"⚠️ Nenhum registro para enviar em {endpoint}.")
        return True

    dados = limpar_valores_json(dados)

    BATCH_SIZE = 100
    total_lotes = (len(dados) + BATCH_SIZE - 1) // BATCH_SIZE

    print(f"📡 Preparando envio de {len(dados)} registros em {total_lotes} lotes para {endpoint}...")

    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados), BATCH_SIZE):
        lote = dados[i:i + BATCH_SIZE]
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
                    print("   ❌ ERRO 413: O pacote ainda está muito grande. Diminua o BATCH_SIZE.")
                    return False

                if response.status_code in RETRY_STATUS or "SQLITE_BUSY" in response.text:
                    wait_time = BASE_WAIT_SECONDS * attempt
                    print(f"      ⏳ Servidor ocupado ({response.status_code})... Aguardando {wait_time}s")
                    time.sleep(wait_time)
                    continue

                print(f"   ❌ Erro Fatal no Lote {lote_num}: {response.status_code} - {response.text[:300]}")
                return False

            except Exception as e:
                print(f"   ⚠️ Erro conexão Lote {lote_num}: {e}")
                time.sleep(BASE_WAIT_SECONDS * attempt)
        else:
            print(f"   ❌ Falha fatal no Lote {lote_num} após todas tentativas.")
            return False

    print(f"✅ Todos os lotes de {endpoint} enviados com sucesso!")
    return True


# ===========================================
# 🔧 FIXA DIRETÓRIO DE TRABALHO
# ===========================================
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))
else:
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

# ===========================================
# 🔐 CONFIGURAÇÕES API
# ===========================================
USUARIO = "linx_export"
SENHA = "linx_export"
CHAVE = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL = "https://webapi.microvix.com.br/1.0/api/integracao"

HEADERS = {
    "Content-Type": "application/xml; charset=utf-8",
    "Accept": "application/xml"
}
AUTH = HTTPBasicAuth(USUARIO, SENHA)

# ===========================================
# 📁 CAMINHOS
# ===========================================
DB_DIR = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
DB_PATH = os.path.join(DB_DIR, "forma_pgtos.db")

LOG_DIR = os.path.join(DB_DIR, "logs")
os.makedirs(DB_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

# ===========================================
# 🏪 CNPJs - Colar todos os CNPJS quando finalizar o teste
#CNPJS = [
#    "12309173001732","12309173001066","12309173001651","12309173000841","12309173001813",
#    "12309173000507","12309173000175","12309173000337","12309173000922","12309173000256",
#    "12309173001228","12309173000760","12309173001309","12309173001147","12309173000680",
#    "12309173000418","12309173002461","12309173002208","12309173001570","12309173001902",
#    "12309173002119","12309173002038","12309173002380","12309173002542","12309173002895",
#    "12309173002976", 
#]
# ===========================================
CNPJS = [
    "12309173000175",
]

# ===========================================
# 📆 PERÍODO FIXO PEDIDO
# ===========================================
DATA_INICIAL_GERAL = "2025-11-01"
DATA_FINAL_GERAL = "2026-02-28"

JANELAS = [
    ("2025-11-01", "2025-11-30"),
    ("2025-12-01", "2025-12-31"),
    ("2026-01-01", "2026-01-31"),
    ("2026-02-01", "2026-02-28"),
]

# ===========================================
# 🧾 LOG
# ===========================================
def setup_logger():
    log_path = os.path.join(LOG_DIR, f"forma_pgtos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

    logger = logging.getLogger("forma_pgtos")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)

    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    ch.setLevel(logging.INFO)

    logger.addHandler(fh)
    logger.addHandler(ch)

    return logger, log_path


logger, LOG_FILE = setup_logger()
logger.info("=== Início da extração de formas de pagamento ===")
logger.info("Período: %s até %s", DATA_INICIAL_GERAL, DATA_FINAL_GERAL)

# ===========================================
# 🔧 AUXILIARES
# ===========================================
def _preview_text(s, n=900):
    if s is None:
        return ""
    s = str(s)
    return s[:n] + ("..." if len(s) > n else "")


def achar_coluna_tolerante(df: pd.DataFrame, nomes: List[str]) -> Optional[str]:
    cols = list(df.columns)
    for nome in nomes:
        for col in cols:
            if nome.lower() in str(col).lower():
                return col
    return None


def to_float_safe(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str)
        .str.replace(",", ".", regex=False)
        .str.replace(r"[^\d\.\-]", "", regex=True),
        errors="coerce"
    )


def safe_datetime(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce")


def montar_xml(cnpj: str, metodo: str, parametros: Optional[Dict[str, str]] = None):
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


def chamar_api(cnpj: str, metodo: str, parametros: Optional[Dict[str, str]] = None, timeout=180) -> pd.DataFrame:
    xml = montar_xml(cnpj, metodo, parametros)

    try:
        r = requests.post(
            URL,
            data=xml.encode("utf-8"),
            headers=HEADERS,
            auth=AUTH,
            timeout=timeout
        )

        if r.status_code != 200:
            logger.warning(
                "HTTP %s em %s (%s). Resposta: %s",
                r.status_code, metodo, cnpj, _preview_text(r.text, 500)
            )
            return pd.DataFrame()

        content = r.content
        if content.startswith(b"\xef\xbb\xbf"):
            content = content.lstrip(b"\xef\xbb\xbf")

        try:
            root = etree.fromstring(content)
        except Exception as ex:
            logger.warning(
                "Falha parse XML em %s (%s): %s | Resposta: %s",
                metodo, cnpj, ex, _preview_text(r.text, 900)
            )
            return pd.DataFrame()

        ok_nodes = root.xpath(".//ResponseSuccess/text()")
        if ok_nodes and ok_nodes[0].strip().lower() == "false":
            logger.warning(
                "ResponseSuccess=false em %s (%s). Resposta: %s",
                metodo, cnpj, _preview_text(r.text, 900)
            )
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")

        data = []
        for rr in rows:
            vals = [d.text for d in rr.xpath("./D")]
            data.append(dict(zip(cols, vals)))

        df = pd.DataFrame(data)
        if df.empty:
            logger.info("%s (%s) retornou 0 linhas.", metodo, cnpj)
        else:
            logger.info("%s (%s) retornou %d linhas.", metodo, cnpj, len(df))
            logger.info("Colunas %s (%s): %s", metodo, cnpj, list(df.columns))

        return df

    except Exception as e:
        logger.exception("Erro em %s (%s): %s", metodo, cnpj, e)
        return pd.DataFrame()


# ===========================================
# 🔄 PAGINAÇÃO / TIMESTAMP
# ===========================================
def extrair_com_janelas(cnpj: str, metodo: str, params_base: Optional[Dict[str, str]] = None, sleep_s: float = 0.6) -> pd.DataFrame:
    if params_base is None:
        params_base = {}

    partes = []

    for d_ini, d_fim in JANELAS:
        params = dict(params_base)
        params["data_inicial"] = d_ini
        params["data_fim"] = d_fim

        df = chamar_api(cnpj, metodo, params)
        if not df.empty:
            df["__janela_ini"] = d_ini
            df["__janela_fim"] = d_fim
            partes.append(df)

        time.sleep(sleep_s)

    if partes:
        return pd.concat(partes, ignore_index=True)

    return pd.DataFrame()


def extrair_por_timestamp(cnpj: str, metodo: str, params_fixos: Optional[Dict[str, str]] = None, sleep_s: float = 0.5, max_loops: int = 1000) -> pd.DataFrame:
    """
    Para métodos orientados a timestamp, como LinxPlanosParcelas.
    """
    if params_fixos is None:
        params_fixos = {}

    ts = 0
    partes = []
    loops = 0

    while loops < max_loops:
        loops += 1
        params = dict(params_fixos)
        params["timestamp"] = str(ts)

        df = chamar_api(cnpj, metodo, params)
        if df.empty:
            break

        partes.append(df)

        col_ts = achar_coluna_tolerante(df, ["timestamp"])
        if not col_ts:
            break

        novo_ts = pd.to_numeric(df[col_ts], errors="coerce").max()
        if pd.isna(novo_ts):
            break

        novo_ts = int(novo_ts)
        if novo_ts <= ts:
            break

        ts = novo_ts
        time.sleep(sleep_s)

    if partes:
        out = pd.concat(partes, ignore_index=True)
        out = out.drop_duplicates()
        return out

    return pd.DataFrame()


# ===========================================
# 🧱 NORMALIZAÇÃO
# ===========================================
def normalizar_movimento_resumo(df: pd.DataFrame) -> pd.DataFrame:
    """
    LinxMovimento retorna nível item.
    Aqui deduplicamos por venda/operação usando identificador.
    """
    if df.empty:
        return df

    df.columns = [c.lower() for c in df.columns]

    keep = [
        "portal", "empresa", "cnpj_emp", "transacao", "documento", "data_documento", "data_lancamento",
        "codigo_cliente", "serie", "ecf", "numero_serie_ecf", "modelo_nf", "cancelado",
        "operacao", "tipo_transacao", "identificador", "hora_lancamento", "natureza_operacao",
        "forma_dinheiro", "total_dinheiro",
        "forma_cheque", "total_cheque",
        "forma_cartao", "total_cartao",
        "forma_crediario", "total_crediario",
        "forma_convenio", "total_convenio",
        "forma_cheque_prazo", "total_cheque_prazo",
        "forma_pix", "total_pix",
        "forma_deposito_bancario", "total_deposito_bancario",
        "troco", "timestamp"
    ]
    keep = [c for c in keep if c in df.columns]
    base = df[keep].copy()

    if "data_documento" in base.columns:
        base["data_documento"] = safe_datetime(base["data_documento"]).dt.strftime("%Y-%m-%d %H:%M:%S")
    if "data_lancamento" in base.columns:
        base["data_lancamento"] = safe_datetime(base["data_lancamento"]).dt.strftime("%Y-%m-%d %H:%M:%S")

    money_cols = [
        "total_dinheiro", "total_cheque", "total_cartao", "total_crediario", "total_convenio",
        "total_cheque_prazo", "total_pix", "total_deposito_bancario", "troco"
    ]
    for col in money_cols:
        if col in base.columns:
            base[col] = to_float_safe(base[col])

    bit_cols = [
        "forma_dinheiro", "forma_cheque", "forma_cartao", "forma_crediario", "forma_convenio",
        "forma_cheque_prazo", "forma_pix", "forma_deposito_bancario"
    ]
    for col in bit_cols:
        if col in base.columns:
            base[col] = base[col].astype(str).replace({
                "True": 1, "False": 0, "true": 1, "false": 0,
                "S": 1, "N": 0, "s": 1, "n": 0
            })
            base[col] = pd.to_numeric(base[col], errors="coerce")

    chaves = [c for c in ["cnpj_emp", "identificador"] if c in base.columns]
    if chaves:
        order_cols = chaves + ([c for c in ["timestamp"] if c in base.columns])
        base = base.sort_values(order_cols)
        base = base.drop_duplicates(subset=chaves, keep="last")

    return base


def normalizar_movimento_planos(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    df.columns = [c.lower().strip() for c in df.columns]

    mapa = {
        "portal": ["portal"],
        "empresa": ["empresa"],
        "cnpj_emp": ["cnpj_emp", "cnpj"],
        "identificador": ["identificador", "id_movimento", "id_venda"],
        "plano": ["plano", "cod_plano", "codigo_plano"],
        "desc_plano": ["desc_plano", "descricao_plano", "plano_descricao"],
        "total": ["total", "valor", "valor_pagto", "valor_pagamento"],
        "qtde_parcelas": ["qtde_parcelas", "qtd_parcelas", "quantidade_parcelas", "qtdeparcelas", "parcelas"],
        "indice_plano": ["indice_plano", "indice", "indice_financeiro"],
        "cod_forma_pgto": ["cod_forma_pgto", "codigo_forma_pgto", "id_forma_pgto"],
        "forma_pgto": ["forma_pgto", "descricao_forma_pgto", "desc_forma_pgto"],
        "tipo_transacao": ["tipo_transacao", "tipo", "credito_debito"],
        "taxa_financeira": ["taxa_financeira", "taxa", "encargo_financeiro"],
        "ordem_cartao": ["ordem_cartao", "ordem", "sequencia_cartao"],
        "timestamp": ["timestamp"]
    }

    renomear = {}
    for nome_final, aliases in mapa.items():
        col_encontrada = achar_coluna_tolerante(df, aliases)
        if col_encontrada:
            renomear[col_encontrada] = nome_final

    df = df.rename(columns=renomear)

    keep = [
        "portal", "empresa", "cnpj_emp", "identificador", "plano", "desc_plano", "total",
        "qtde_parcelas", "indice_plano", "cod_forma_pgto", "forma_pgto",
        "tipo_transacao", "taxa_financeira", "ordem_cartao", "timestamp"
    ]

    for col in keep:
        if col not in df.columns:
            df[col] = None

    base = df[keep].copy()

    for col in ["total", "indice_plano", "taxa_financeira"]:
        if col in base.columns:
            base[col] = to_float_safe(base[col])

    for col in ["qtde_parcelas", "cod_forma_pgto", "ordem_cartao", "plano", "portal", "empresa"]:
        if col in base.columns:
            base[col] = pd.to_numeric(base[col], errors="coerce")

    if "qtde_parcelas" in base.columns:
        base["qtde_parcelas"] = base["qtde_parcelas"].fillna(1)

    subset_cols = [c for c in ["cnpj_emp", "identificador", "plano", "ordem_cartao", "total", "qtde_parcelas"] if c in base.columns]
    if subset_cols:
        base = base.drop_duplicates(subset=subset_cols)
    else:
        base = base.drop_duplicates()

    return base


def normalizar_movimento_cartoes(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    df.columns = [c.lower() for c in df.columns]

    keep = [
        "portal", "cnpj_emp", "codlojasitef", "data_lancamento", "identificador", "cupomfiscal",
        "credito_debito", "id_cartao_bandeira", "descricao_bandeira", "valor", "ordem_cartao",
        "nsu_host", "nsu_sitef", "cod_autorizacao", "id_antecipacoes_financeiras",
        "transacao_servico_terceiro", "texto_comprovante", "id_maquineta_pos",
        "descricao_maquineta", "serie_maquineta", "timestamp", "cartao_prepago"
    ]
    keep = [c for c in keep if c in df.columns]
    base = df[keep].copy()

    if "data_lancamento" in base.columns:
        base["data_lancamento"] = safe_datetime(base["data_lancamento"]).dt.strftime("%Y-%m-%d %H:%M:%S")

    if "valor" in base.columns:
        base["valor"] = to_float_safe(base["valor"])

    for col in ["ordem_cartao", "id_cartao_bandeira", "id_antecipacoes_financeiras", "id_maquineta_pos", "portal"]:
        if col in base.columns:
            base[col] = pd.to_numeric(base[col], errors="coerce")

    return base.drop_duplicates()


def normalizar_planos_parcelas(df: pd.DataFrame, cnpj: str) -> pd.DataFrame:
    if df.empty:
        return df

    df.columns = [c.lower() for c in df.columns]

    keep = ["portal", "plano", "ordem_parcela", "prazo_parc", "id_planos_parcelas", "timestamp"]
    keep = [c for c in keep if c in df.columns]
    base = df[keep].copy()
    base["cnpj_emp"] = cnpj

    for col in ["portal", "plano", "ordem_parcela", "prazo_parc", "id_planos_parcelas"]:
        if col in base.columns:
            base[col] = pd.to_numeric(base[col], errors="coerce")

    return base.drop_duplicates()


# ===========================================
# 🗃️ SQLITE
# ===========================================
def init_db(conn: sqlite3.Connection):
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS movimento_resumo (
            portal INTEGER,
            empresa INTEGER,
            cnpj_emp TEXT,
            transacao INTEGER,
            documento INTEGER,
            data_documento TEXT,
            data_lancamento TEXT,
            codigo_cliente INTEGER,
            serie TEXT,
            ecf INTEGER,
            numero_serie_ecf TEXT,
            modelo_nf INTEGER,
            cancelado TEXT,
            operacao TEXT,
            tipo_transacao TEXT,
            identificador TEXT,
            hora_lancamento TEXT,
            natureza_operacao TEXT,
            forma_dinheiro INTEGER,
            total_dinheiro REAL,
            forma_cheque INTEGER,
            total_cheque REAL,
            forma_cartao INTEGER,
            total_cartao REAL,
            forma_crediario INTEGER,
            total_crediario REAL,
            forma_convenio INTEGER,
            total_convenio REAL,
            forma_cheque_prazo INTEGER,
            total_cheque_prazo REAL,
            forma_pix INTEGER,
            total_pix REAL,
            forma_deposito_bancario INTEGER,
            total_deposito_bancario REAL,
            troco REAL,
            timestamp INTEGER
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS movimento_planos (
            portal INTEGER,
            empresa INTEGER,
            cnpj_emp TEXT,
            identificador TEXT,
            plano INTEGER,
            desc_plano TEXT,
            total REAL,
            qtde_parcelas INTEGER,
            indice_plano REAL,
            cod_forma_pgto INTEGER,
            forma_pgto TEXT,
            tipo_transacao TEXT,
            taxa_financeira REAL,
            ordem_cartao INTEGER,
            timestamp INTEGER
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS movimento_cartoes (
            portal INTEGER,
            cnpj_emp TEXT,
            codlojasitef TEXT,
            data_lancamento TEXT,
            identificador TEXT,
            cupomfiscal TEXT,
            credito_debito TEXT,
            id_cartao_bandeira INTEGER,
            descricao_bandeira TEXT,
            valor REAL,
            ordem_cartao INTEGER,
            nsu_host TEXT,
            nsu_sitef TEXT,
            cod_autorizacao TEXT,
            id_antecipacoes_financeiras INTEGER,
            transacao_servico_terceiro TEXT,
            texto_comprovante TEXT,
            id_maquineta_pos INTEGER,
            descricao_maquineta TEXT,
            serie_maquineta TEXT,
            timestamp INTEGER,
            cartao_prepago TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS planos_parcelas (
            portal INTEGER,
            cnpj_emp TEXT,
            plano INTEGER,
            ordem_parcela INTEGER,
            prazo_parc INTEGER,
            id_planos_parcelas INTEGER,
            timestamp INTEGER
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS pagamentos_consolidados (
            cnpj_emp TEXT,
            identificador TEXT,
            transacao INTEGER,
            documento INTEGER,
            data_documento TEXT,
            data_lancamento TEXT,
            cancelado TEXT,
            operacao TEXT,
            tipo_transacao_movimento TEXT,
            plano INTEGER,
            desc_plano TEXT,
            valor_pagamento REAL,
            qtde_parcelas INTEGER,
            cod_forma_pgto INTEGER,
            forma_pgto TEXT,
            tipo_transacao_plano_cartao TEXT,
            ordem_cartao INTEGER,
            cartao_credito_debito TEXT,
            id_cartao_bandeira INTEGER,
            descricao_bandeira TEXT,
            valor_cartao REAL,
            nsu_host TEXT,
            nsu_sitef TEXT,
            cod_autorizacao TEXT,
            descricao_maquineta TEXT,
            ordem_parcela INTEGER,
            prazo_parc INTEGER
        )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_mov_resumo_ident ON movimento_resumo (cnpj_emp, identificador)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mov_planos_ident ON movimento_planos (cnpj_emp, identificador)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mov_planos_ordem ON movimento_planos (cnpj_emp, identificador, ordem_cartao)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mov_cartoes_ident ON movimento_cartoes (cnpj_emp, identificador)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mov_cartoes_ordem ON movimento_cartoes (cnpj_emp, identificador, ordem_cartao)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_planos_parcelas_plano ON planos_parcelas (cnpj_emp, plano)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pag_consolidados_ident ON pagamentos_consolidados (cnpj_emp, identificador, ordem_cartao)")

    cur.execute("DROP VIEW IF EXISTS vw_pagamentos_consolidados")
    cur.execute("""
        CREATE VIEW vw_pagamentos_consolidados AS
        SELECT
            mp.cnpj_emp,
            mp.identificador,
            mr.transacao,
            mr.documento,
            mr.data_documento,
            mr.data_lancamento,
            mr.cancelado,
            mr.operacao,
            mr.tipo_transacao AS tipo_transacao_movimento,
            mp.plano,
            mp.desc_plano,
            mp.total AS valor_pagamento,
            mp.qtde_parcelas,
            mp.cod_forma_pgto,
            mp.forma_pgto,
            mp.tipo_transacao AS tipo_transacao_plano_cartao,
            mp.ordem_cartao,
            mc.credito_debito AS cartao_credito_debito,
            mc.id_cartao_bandeira,
            mc.descricao_bandeira,
            mc.valor AS valor_cartao,
            mc.nsu_host,
            mc.nsu_sitef,
            mc.cod_autorizacao,
            mc.descricao_maquineta,
            pp.ordem_parcela,
            pp.prazo_parc
        FROM movimento_planos mp
        LEFT JOIN movimento_resumo mr
               ON mr.cnpj_emp = mp.cnpj_emp
              AND mr.identificador = mp.identificador
        LEFT JOIN movimento_cartoes mc
               ON mc.cnpj_emp = mp.cnpj_emp
              AND mc.identificador = mp.identificador
              AND COALESCE(mc.ordem_cartao, -1) = COALESCE(mp.ordem_cartao, -1)
        LEFT JOIN planos_parcelas pp
               ON pp.cnpj_emp = mp.cnpj_emp
              AND pp.plano = mp.plano
    """)

    conn.commit()


def limpar_periodo(conn: sqlite3.Connection):
    cur = conn.cursor()

    cur.execute("""
        DELETE FROM movimento_resumo
        WHERE date(substr(data_lancamento, 1, 10)) BETWEEN ? AND ?
    """, (DATA_INICIAL_GERAL, DATA_FINAL_GERAL))

    cur.execute("""
        DELETE FROM movimento_cartoes
        WHERE date(substr(data_lancamento, 1, 10)) BETWEEN ? AND ?
    """, (DATA_INICIAL_GERAL, DATA_FINAL_GERAL))

    cur.execute("""
        DELETE FROM movimento_planos
        WHERE EXISTS (
            SELECT 1
            FROM movimento_resumo mr
            WHERE mr.cnpj_emp = movimento_planos.cnpj_emp
              AND mr.identificador = movimento_planos.identificador
              AND date(substr(mr.data_lancamento, 1, 10)) BETWEEN ? AND ?
        )
    """, (DATA_INICIAL_GERAL, DATA_FINAL_GERAL))

    cur.execute("DELETE FROM pagamentos_consolidados")

    conn.commit()


def recriar_pagamentos_consolidados(conn: sqlite3.Connection):
    cur = conn.cursor()

    cur.execute("DELETE FROM pagamentos_consolidados")

    cur.execute("""
        INSERT INTO pagamentos_consolidados (
            cnpj_emp,
            identificador,
            transacao,
            documento,
            data_documento,
            data_lancamento,
            cancelado,
            operacao,
            tipo_transacao_movimento,
            plano,
            desc_plano,
            valor_pagamento,
            qtde_parcelas,
            cod_forma_pgto,
            forma_pgto,
            tipo_transacao_plano_cartao,
            ordem_cartao,
            cartao_credito_debito,
            id_cartao_bandeira,
            descricao_bandeira,
            valor_cartao,
            nsu_host,
            nsu_sitef,
            cod_autorizacao,
            descricao_maquineta,
            ordem_parcela,
            prazo_parc
        )
        SELECT
            cnpj_emp,
            identificador,
            transacao,
            documento,
            data_documento,
            data_lancamento,
            cancelado,
            operacao,
            tipo_transacao_movimento,
            plano,
            desc_plano,
            valor_pagamento,
            qtde_parcelas,
            cod_forma_pgto,
            forma_pgto,
            tipo_transacao_plano_cartao,
            ordem_cartao,
            cartao_credito_debito,
            id_cartao_bandeira,
            descricao_bandeira,
            valor_cartao,
            nsu_host,
            nsu_sitef,
            cod_autorizacao,
            descricao_maquineta,
            ordem_parcela,
            prazo_parc
        FROM vw_pagamentos_consolidados
    """)

    conn.commit()


# ===========================================
# 🚀 EXTRAÇÃO E SINCRONIZAÇÃO
# ===========================================
if __name__ == "__main__":
    todos_mov_resumo = []
    todos_mov_planos = []
    todos_mov_cartoes = []
    todos_planos_parcelas = []

    for cnpj in CNPJS:
        logger.info("============================================")
        logger.info("Processando CNPJ %s", cnpj)

        # -----------------------------
        # 1) LinxMovimento
        # -----------------------------
        logger.info("Extraindo LinxMovimento...")
        df_mov = extrair_com_janelas(
            cnpj,
            "LinxMovimento",
            params_base={
                "timestamp": "0",
                "hora_inicial": "00:00",
                "hora_fim": "23:59",
            },
            sleep_s=0.8
        )

        if not df_mov.empty:
            df_mov_norm = normalizar_movimento_resumo(df_mov)
            if not df_mov_norm.empty:
                todos_mov_resumo.append(df_mov_norm)
                logger.info("LinxMovimento normalizado: %d linhas", len(df_mov_norm))

        time.sleep(1.2)

        # -----------------------------
        # 2) LinxMovimentoPlanos
        # -----------------------------
        logger.info("Extraindo LinxMovimentoPlanos...")
        df_planos = extrair_com_janelas(
            cnpj,
            "LinxMovimentoPlanos",
            params_base={
                "hora_inicial": "00:00",
                "hora_fim": "23:59",
                "diferenciar_avista": "1",
                "timestamp": "0"
            },
            sleep_s=0.8
        )

        if not df_planos.empty:
            df_planos_norm = normalizar_movimento_planos(df_planos)
            if not df_planos_norm.empty:
                todos_mov_planos.append(df_planos_norm)
                logger.info("LinxMovimentoPlanos normalizado: %d linhas", len(df_planos_norm))

                cols_debug = [c for c in [
                    "cnpj_emp", "identificador", "plano", "desc_plano", "total",
                    "qtde_parcelas", "forma_pgto", "tipo_transacao", "ordem_cartao"
                ] if c in df_planos_norm.columns]

                if cols_debug:
                    logger.info(
                        "Amostra LinxMovimentoPlanos:\n%s",
                        df_planos_norm[cols_debug].head(10).to_string(index=False)
                    )
            else:
                logger.warning("LinxMovimentoPlanos veio, mas ficou vazio após normalização.")
        else:
            logger.warning("LinxMovimentoPlanos não retornou dados para %s.", cnpj)

        time.sleep(1.2)

        # -----------------------------
        # 3) LinxMovimentoCartoes
        # -----------------------------
        logger.info("Extraindo LinxMovimentoCartoes...")
        df_cartoes = extrair_com_janelas(
            cnpj,
            "LinxMovimentoCartoes",
            params_base={
                "timestamp": "0",
                "apenas_com_faturas": "0"
            },
            sleep_s=0.8
        )

        if not df_cartoes.empty:
            df_cartoes_norm = normalizar_movimento_cartoes(df_cartoes)
            if not df_cartoes_norm.empty:
                todos_mov_cartoes.append(df_cartoes_norm)
                logger.info("LinxMovimentoCartoes normalizado: %d linhas", len(df_cartoes_norm))

        time.sleep(1.2)

        # -----------------------------
        # 4) LinxPlanosParcelas
        # -----------------------------
        logger.info("Extraindo LinxPlanosParcelas...")
        df_parcelas = extrair_por_timestamp(
            cnpj,
            "LinxPlanosParcelas",
            params_fixos={},
            sleep_s=0.5,
            max_loops=50
        )

        if not df_parcelas.empty:
            df_parcelas_norm = normalizar_planos_parcelas(df_parcelas, cnpj)
            if not df_parcelas_norm.empty:
                todos_planos_parcelas.append(df_parcelas_norm)
                logger.info("LinxPlanosParcelas normalizado: %d linhas", len(df_parcelas_norm))

        time.sleep(1.5)

    # ===========================================
    # 💾 CONSOLIDA E GRAVA
    # ===========================================
    df_mov_resumo_final = pd.concat(todos_mov_resumo, ignore_index=True) if todos_mov_resumo else pd.DataFrame()
    df_mov_planos_final = pd.concat(todos_mov_planos, ignore_index=True) if todos_mov_planos else pd.DataFrame()
    df_mov_cartoes_final = pd.concat(todos_mov_cartoes, ignore_index=True) if todos_mov_cartoes else pd.DataFrame()
    df_planos_parcelas_final = pd.concat(todos_planos_parcelas, ignore_index=True) if todos_planos_parcelas else pd.DataFrame()

    logger.info("Resumo final:")
    logger.info("movimento_resumo: %d", len(df_mov_resumo_final))
    logger.info("movimento_planos: %d", len(df_mov_planos_final))
    logger.info("movimento_cartoes: %d", len(df_mov_cartoes_final))
    logger.info("planos_parcelas: %d", len(df_planos_parcelas_final))

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    limpar_periodo(conn)

    if not df_mov_resumo_final.empty:
        df_mov_resumo_final.to_sql("movimento_resumo", conn, if_exists="append", index=False)

    if not df_mov_planos_final.empty:
        df_mov_planos_final.to_sql("movimento_planos", conn, if_exists="append", index=False)

    if not df_mov_cartoes_final.empty:
        df_mov_cartoes_final.to_sql("movimento_cartoes", conn, if_exists="append", index=False)

    if not df_planos_parcelas_final.empty:
        df_planos_parcelas_final = df_planos_parcelas_final.drop_duplicates(
            subset=["cnpj_emp", "plano", "ordem_parcela", "id_planos_parcelas"]
        )
        df_planos_parcelas_final.to_sql("planos_parcelas", conn, if_exists="append", index=False)

    init_db(conn)
    recriar_pagamentos_consolidados(conn)
    conn.close()

    logger.info("=== Fim da extração local. Banco salvo em: %s ===", DB_PATH)
    logger.info("=== Log salvo em: %s ===", LOG_FILE)
    print(f"💾 Banco SQLite salvo localmente em: {DB_PATH}")

    # ===========================================
    # ☁️ ENVIO PARA A API (Sincronização Nuvem)
    # ===========================================
    ok_sync = True

    if not URL_BACKEND:
        print("❌ ERRO FATAL: Não foi possível definir a URL do backend. Dados salvos apenas no SQLite local.")
        ok_sync = False
    else:
        print("\n🚀 Iniciando Sincronização com o Servidor (TeleFluxo)...\n")

        if not df_mov_resumo_final.empty:
            ok_sync = ok_sync and enviar_dataframe_para_api(
                "/api/sync/linx_movimento_resumo",
                df_mov_resumo_final,
                batch_size=25,
                pausa_entre_lotes=0.35
            )

        if ok_sync and not df_mov_planos_final.empty:
            ok_sync = ok_sync and enviar_dataframe_para_api(
                "/api/sync/linx_movimento_planos",
                df_mov_planos_final,
                batch_size=25,
                pausa_entre_lotes=0.35
            )

        if ok_sync and not df_mov_cartoes_final.empty:
            ok_sync = ok_sync and enviar_dataframe_para_api(
                "/api/sync/linx_movimento_cartoes",
                df_mov_cartoes_final,
                batch_size=25,
                pausa_entre_lotes=0.35
            )

        if ok_sync and not df_planos_parcelas_final.empty:
            ok_sync = ok_sync and enviar_dataframe_para_api(
                "/api/sync/linx_planos_parcelas",
                df_planos_parcelas_final,
                batch_size=20,
                pausa_entre_lotes=0.50
            )

    if ok_sync:
        print("✅ Processo 100% finalizado!")
    else:
        print("❌ Processo finalizado com falhas na sincronização.")