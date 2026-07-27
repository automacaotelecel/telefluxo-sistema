# ===========================================
# 📦 SINCRONIZADOR DE ESTOQUE v9.2 (DEPÓSITOS: ESTOQUE / AMOSTRA / DOA + IMEI)
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
from lxml import etree
import pandas as pd
from datetime import datetime, timedelta
import os
import sys
import time
import json
import sqlite3
import uuid

# === CREDENCIAIS MICROVIX ===
USUARIO = "linx_export"
SENHA   = "linx_export"
CHAVE   = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL     = "https://webapi.microvix.com.br/1.0/api/integracao"
API_STOCK_SYNC_URL = "https://telefluxo-aplicacao.onrender.com/stock/sync"

# CNPJ PRINCIPAL PARA O CONTEXTO DO CATÁLOGO
CNPJ_CONTEXTO = "12309173001309"

# ✅ NOVO: caminho do Excel de classificação
EXCEL_CLASSIFICACAO = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\em_linha.xlsx"

headers = {"Content-Type": "application/xml; charset=utf-8", "Accept": "application/xml"}
auth    = HTTPBasicAuth(USUARIO, SENHA)

# === 🏪 MAPEAMENTO DE LOJAS ===
LOJAS_NOME = {
    "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING",
    "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL",
    "12309173001228": "CONJUNTO NACIONAL QUIOSQUE", "12309173000507": "GOIANIA SHOPPING",
    "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING",
    "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING",
    "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING",
    "12309173001813": "UBERABA SHOPPING", "12309173001570": "FLAMBOYANT SHOPPING",
    "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS",
    "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS",
    "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING",
    "12309173002976": "IGUATEMI FORTALEZA", "12309173001066": "CD TAGUATINGA"
}
CNPJS = list(LOJAS_NOME.keys())
JANELA_DIAS_MOV = 365

# ✅ NOVO: comportamento padrão do estoque
ESTOQUE_MODO_COMPLETO = True
TEMPO_ESPERA_API = 0.1

# ===========================================
# 🛠️ FUNÇÕES AUXILIARES
# ===========================================
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def iso(d):
    return d.strftime("%Y-%m-%d")

def to_float(series):
    return pd.to_numeric(
        pd.Series(series, dtype="object")
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.replace(r"[^\d\.\-]", "", regex=True),
        errors="coerce"
    ).fillna(0)

# ✅ NOVO: normalizadores para o PROCV
def normalizar_loja(s):
    return str(s or "").strip().upper()

def normalizar_referencia(s):
    return str(s or "").strip().upper()


def normalizar_tipo_estoque(valor):
    texto = (
        str(valor or "")
        .strip()
        .upper()
        .replace("Á", "A")
        .replace("Ã", "A")
        .replace("Â", "A")
        .replace("À", "A")
        .replace("É", "E")
        .replace("Ê", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ô", "O")
        .replace("Õ", "O")
        .replace("Ú", "U")
        .replace("Ç", "C")
    )

    if "AMOSTRA" in texto or "MOSTRUARIO" in texto or "DEMONSTRACAO" in texto or "EXPOSICAO" in texto:
        return "AMOSTRA"

    if texto == "DOA" or texto.startswith("DOA ") or texto.endswith(" DOA") or " D.O.A" in texto:
        return "DOA"

    return "ESTOQUE"


def normalizar_codigo_deposito(valor):
    """Normaliza 1, 1.0 e "1" para a mesma chave textual: "1"."""
    if valor is None:
        return ""

    texto = str(valor).strip()
    if not texto:
        return ""

    try:
        return str(int(float(texto.replace(",", "."))))
    except (TypeError, ValueError):
        return texto.upper()


def classificar_nome_deposito(nome_deposito):
    """
    Classifica somente os depósitos que fazem parte do estoque exibido no TeleFluxo.

    Importante: depósitos desconhecidos não viram ESTOQUE automaticamente, pois isso
    poderia somar assistência, avaria, troca ou outros depósitos ao estoque normal.
    """
    texto = (
        str(nome_deposito or "")
        .strip()
        .upper()
        .replace("Á", "A")
        .replace("Ã", "A")
        .replace("Â", "A")
        .replace("À", "A")
        .replace("É", "E")
        .replace("Ê", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ô", "O")
        .replace("Õ", "O")
        .replace("Ú", "U")
        .replace("Ç", "C")
    )

    if any(termo in texto for termo in ["AMOSTRA", "MOSTRUARIO", "DEMONSTRACAO", "EXPOSICAO"]):
        return "AMOSTRA"

    texto_doa = texto.replace(".", "").replace("-", " ")
    if texto_doa == "DOA" or texto_doa.startswith("DOA ") or texto_doa.endswith(" DOA"):
        return "DOA"

    # O ERP do cliente utiliza o nome "Estoque" para o depósito operacional.
    if texto == "ESTOQUE" or texto.startswith("ESTOQUE ") or texto.endswith(" ESTOQUE"):
        return "ESTOQUE"

    return None


def identificar_tipo_estoque_linha(row):
    candidatos_exatos = [
        "tipo_estoque",
        "estoque_tipo",
        "stock_type",
        "tipo_saldo",
        "deposito",
        "nome_deposito",
        "descricao_deposito",
        "desc_deposito",
        "deposito_descricao",
        "local_estoque",
        "origem_estoque",
        "classificacao_estoque",
        "status_estoque",
        "aba_origem",
        "sheet_name",
    ]

    for coluna in candidatos_exatos:
        if coluna in row.index:
            tipo = normalizar_tipo_estoque(row.get(coluna))
            if tipo != "ESTOQUE":
                return tipo

    # Fallback para bases que trazem a informação em uma coluna com outro nome.
    for coluna in row.index:
        nome_coluna = str(coluna or "").strip().lower()
        if any(termo in nome_coluna for termo in ["deposit", "estoque", "amostra", "doa", "mostruario"]):
            tipo = normalizar_tipo_estoque(row.get(coluna))
            if tipo != "ESTOQUE":
                return tipo

    return "ESTOQUE"

def _primeira_coluna_existente(df, candidatos):
    mapa = {str(c).strip().lower(): c for c in df.columns}
    for candidato in candidatos:
        if candidato.lower() in mapa:
            return mapa[candidato.lower()]
    return None


def expandir_quantidades_por_tipo(df):
    """
    Suporta bases que entregam ESTOQUE, AMOSTRA e DOA em colunas separadas.
    Cada quantidade vira uma linha independente com TIPO_ESTOQUE explícito.
    Se a base já vier em linhas separadas, mantém o formato atual.
    """
    if df is None or df.empty:
        return df

    col_estoque = _primeira_coluna_existente(df, [
        "estoque", "qtd_estoque", "quantidade_estoque", "saldo_estoque"
    ])
    col_amostra = _primeira_coluna_existente(df, [
        "amostra", "qtd_amostra", "quantidade_amostra", "saldo_amostra"
    ])
    col_doa = _primeira_coluna_existente(df, [
        "doa", "qtd_doa", "quantidade_doa", "saldo_doa"
    ])

    if not any([col_estoque, col_amostra, col_doa]):
        return df

    linhas = []
    for _, row in df.iterrows():
        quantidade_generica = float(to_float([row.get("QUANTIDADE", row.get("quantidade", 0))]).iloc[0])

        quantidades = {
            "ESTOQUE": float(to_float([row.get(col_estoque, quantidade_generica) if col_estoque else quantidade_generica]).iloc[0]),
            "AMOSTRA": float(to_float([row.get(col_amostra, 0) if col_amostra else 0]).iloc[0]),
            "DOA": float(to_float([row.get(col_doa, 0) if col_doa else 0]).iloc[0]),
        }

        adicionou = False
        for tipo, quantidade in quantidades.items():
            if quantidade <= 0:
                continue
            nova = row.copy()
            nova["TIPO_ESTOQUE"] = tipo
            nova["QUANTIDADE"] = quantidade
            linhas.append(nova)
            adicionou = True

        if not adicionou:
            nova = row.copy()
            nova["TIPO_ESTOQUE"] = normalizar_tipo_estoque(row.get("TIPO_ESTOQUE", "ESTOQUE"))
            nova["QUANTIDADE"] = quantidade_generica
            linhas.append(nova)

    return pd.DataFrame(linhas)


# ✅ NOVO: helper para paginação segura por timestamp
def obter_proximo_timestamp(df, timestamp_atual):
    if df is None or df.empty or "timestamp" not in df.columns:
        return None

    ts_series = pd.to_numeric(df["timestamp"], errors="coerce").dropna()
    if ts_series.empty:
        return None

    novo_ts = int(ts_series.max())

    # proteção contra loop infinito
    if novo_ts <= timestamp_atual:
        return None

    return novo_ts

# ✅ NOVO: leitor das abas em_linha e cluster
def carregar_classificacoes_excel():
    """
    Lê o arquivo em_linha.xlsx e devolve:
    - mapa_em_linha: referencia -> em_linha
    - mapa_cluster: loja -> cluster
    """
    if not os.path.exists(EXCEL_CLASSIFICACAO):
        log(f"⚠️ Arquivo de classificação não encontrado: {EXCEL_CLASSIFICACAO}")
        return {}, {}

    try:
        xls = pd.ExcelFile(EXCEL_CLASSIFICACAO)

        if "em_linha" not in xls.sheet_names:
            log("⚠️ Aba 'em_linha' não encontrada no Excel.")
            df_em_linha = pd.DataFrame()
        else:
            df_em_linha = pd.read_excel(xls, sheet_name="em_linha")

        if "cluster" not in xls.sheet_names:
            log("⚠️ Aba 'cluster' não encontrada no Excel.")
            df_cluster = pd.DataFrame()
        else:
            df_cluster = pd.read_excel(xls, sheet_name="cluster")

        mapa_em_linha = {}
        if not df_em_linha.empty:
            df_em_linha.columns = [str(c).strip().lower() for c in df_em_linha.columns]

            col_ref = None
            col_linha = None

            for c in df_em_linha.columns:
                if c in ["reference", "referencia", "ref", "referência"]:
                    col_ref = c
                    break

            for c in df_em_linha.columns:
                if c in ["em_linha", "linha", "linha_produto", "classificacao_linha"]:
                    col_linha = c
                    break

            if col_ref and col_linha:
                for _, row in df_em_linha.iterrows():
                    ref = normalizar_referencia(row.get(col_ref))
                    linha = str(row.get(col_linha) or "").strip()
                    if ref:
                        mapa_em_linha[ref] = linha
            else:
                log("⚠️ Não consegui identificar as colunas da aba 'em_linha'.")

        mapa_cluster = {}
        if not df_cluster.empty:
            df_cluster.columns = [str(c).strip().lower() for c in df_cluster.columns]

            col_loja = None
            col_cluster = None

            for c in df_cluster.columns:
                if c in ["storename", "loja", "nome_loja", "store_name"]:
                    col_loja = c
                    break

            for c in df_cluster.columns:
                if c in ["cluster", "grupo", "agrupamento"]:
                    col_cluster = c
                    break

            if col_loja and col_cluster:
                for _, row in df_cluster.iterrows():
                    loja = normalizar_loja(row.get(col_loja))
                    cluster = str(row.get(col_cluster) or "").strip()
                    if loja:
                        mapa_cluster[loja] = cluster
            else:
                log("⚠️ Não consegui identificar as colunas da aba 'cluster'.")

        log(f"✅ Classificações carregadas | em_linha: {len(mapa_em_linha)} | cluster: {len(mapa_cluster)}")
        return mapa_em_linha, mapa_cluster

    except Exception as e:
        log(f"❌ Erro ao ler Excel de classificações: {e}")
        return {}, {}

# ===========================================
# 1. EXTRAÇÃO DE CADASTRO (LINX PRODUTOS)
# ===========================================
def chamar_api_catalogo(dt_ini, dt_fim):
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutos</Name>
        <Parameters>
          <Parameter id="chave">{CHAVE}</Parameter>
          <Parameter id="cnpjEmp">{CNPJ_CONTEXTO}</Parameter>
          <Parameter id="dt_update_inicio">{dt_ini}</Parameter>
          <Parameter id="dt_update_fim">{dt_fim}</Parameter>
        </Parameters>
      </Command>
    </LinxMicrovix>"""
    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=300)
        if r.status_code != 200:
            return None
        root = etree.fromstring(r.content)
        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].lower() == "false":
            return None
        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except:
        return None

def baixar_intervalo_recursivo(dt_ini, dt_fim):
    df = chamar_api_catalogo(dt_ini, dt_fim)
    if df is None:
        return pd.DataFrame()
    qtd = len(df)
    if qtd >= 4900:
        dt_ini_dt = datetime.combine(dt_ini, datetime.min.time()) if isinstance(dt_ini, datetime) else datetime.strptime(str(dt_ini), "%Y-%m-%d")
        dt_fim_dt = datetime.combine(dt_fim, datetime.min.time()) if isinstance(dt_fim, datetime) else datetime.strptime(str(dt_fim), "%Y-%m-%d")
        meio_dt = dt_ini_dt + (dt_fim_dt - dt_ini_dt) / 2
        meio = meio_dt.date()
        log(f"🔁 Dividindo intervalo cheio: {dt_ini} -> {meio} -> {dt_fim}")
        df1 = baixar_intervalo_recursivo(dt_ini, meio)
        df2 = baixar_intervalo_recursivo(meio, dt_fim)
        return pd.concat([df1, df2], ignore_index=True)
    if qtd > 0:
        log(f"   📅 {dt_ini} a {dt_fim}: {qtd} produtos.")
    return df

def extrair_catalogo_completo():
    log("📚 Iniciando download do catálogo...")
    inicio = datetime(2015, 1, 1).date()
    fim = datetime.now().date()
    df = baixar_intervalo_recursivo(inicio, fim)
    if df.empty:
        return pd.DataFrame()
    df.columns = [c.lower() for c in df.columns]

    if "cod_produto" in df.columns:
        df["cod_produto"] = pd.to_numeric(df["cod_produto"], errors="coerce")
        df = df.drop_duplicates(subset=["cod_produto"], keep='last')

    df["NOME_REAL"] = None
    for c in ["nome_produto", "descricao_basica", "nome", "desc_produto"]:
        if c in df.columns:
            df["NOME_REAL"] = df[c].fillna(df["NOME_REAL"])
            break

    df["REF_REAL"] = df["referencia"] if "referencia" in df.columns else None

    df["CAT_REAL"] = "GERAL"
    for c in ["desc_setor", "nome_setor", "setor", "categoria"]:
        if c in df.columns:
            df["CAT_REAL"] = df[c].fillna(df["CAT_REAL"])
            break

    df.rename(columns={"cod_produto": "CODIGO_PRODUTO"}, inplace=True)
    final_cols = ["CODIGO_PRODUTO", "NOME_REAL", "REF_REAL", "CAT_REAL"]
    for c in final_cols:
        if c not in df.columns:
            df[c] = "-"
    return df[final_cols]

# ===========================================
# 2. EXTRAÇÃO DE ESTOQUE E SALDOS POR DEPÓSITO
# ===========================================
def chamar_api_detalhes(parametros):
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k, v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosDetalhes</Name>
        <Parameters><Parameter id="chave">{CHAVE}</Parameter>{params_xml}</Parameters>
      </Command>
    </LinxMicrovix>"""

    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=120)

        if r.status_code != 200:
            log(f"❌ HTTP {r.status_code} em LinxProdutosDetalhes | params={parametros}")
            try:
                log(r.text[:1000])
            except Exception:
                pass
            return pd.DataFrame()

        root = etree.fromstring(r.content)

        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].strip().lower() == "false":
            msg = root.xpath(".//ResponseMessage/text()")
            erro = msg[0] if msg else "Sem mensagem"
            log(f"❌ ResponseSuccess=false em LinxProdutosDetalhes | params={parametros} | msg={erro}")
            try:
                log(r.text[:1000])
            except Exception:
                pass
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")

        if not rows:
            log(f"⚠️ LinxProdutosDetalhes sem linhas | params={parametros}")
            return pd.DataFrame()

        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)

    except Exception as e:
        log(f"❌ Exceção em chamar_api_detalhes: {e} | params={parametros}")
        return pd.DataFrame()


def chamar_api_depositos(parametros):
    """Consulta o cadastro de depósitos: cod_deposito + nome_deposito."""
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k, v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosDepositos</Name>
        <Parameters><Parameter id="chave">{CHAVE}</Parameter>{params_xml}</Parameters>
      </Command>
    </LinxMicrovix>"""

    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=120)
        if r.status_code != 200:
            log(f"❌ HTTP {r.status_code} em LinxProdutosDepositos | params={parametros}")
            return pd.DataFrame()

        root = etree.fromstring(r.content)
        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].strip().lower() == "false":
            msg = root.xpath(".//ResponseMessage/text()")
            erro = msg[0] if msg else "Sem mensagem"
            log(f"❌ ResponseSuccess=false em LinxProdutosDepositos | params={parametros} | msg={erro}")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        if not rows:
            return pd.DataFrame()

        return pd.DataFrame([
            dict(zip(cols, [d.text for d in rr.xpath('./D')]))
            for rr in rows
        ])
    except Exception as e:
        log(f"❌ Exceção em LinxProdutosDepositos: {e} | params={parametros}")
        return pd.DataFrame()


def extrair_depositos_loja(cnpj):
    """
    Descobre os códigos reais dos depósitos em cada loja.

    Retorno:
        {
            "1": {"nome": "Estoque", "tipo": "ESTOQUE"},
            "2": {"nome": "DOA", "tipo": "DOA"},
            "4": {"nome": "AMOSTRAS", "tipo": "AMOSTRA"},
        }
    """
    dfs = []
    ts = 0

    while True:
        df = chamar_api_depositos({"cnpjEmp": cnpj, "timestamp": str(ts)})
        if df.empty:
            break

        df.columns = [str(c).strip().lower() for c in df.columns]
        dfs.append(df)

        novo_ts = obter_proximo_timestamp(df, ts)
        if novo_ts is None:
            break

        ts = novo_ts
        time.sleep(TEMPO_ESPERA_API)

    if not dfs:
        log(f"   ⚠️ Nenhum cadastro de depósito retornado para {LOJAS_NOME.get(cnpj, cnpj)}.")
        return {}

    base = pd.concat(dfs, ignore_index=True)
    if "timestamp" in base.columns:
        base["timestamp"] = pd.to_numeric(base["timestamp"], errors="coerce")
        base = base.sort_values("timestamp", ascending=False)

    if "cod_deposito" not in base.columns or "nome_deposito" not in base.columns:
        log(f"   ⚠️ LinxProdutosDepositos não retornou cod_deposito/nome_deposito para {LOJAS_NOME.get(cnpj, cnpj)}.")
        return {}

    base["COD_DEPOSITO_NORMALIZADO"] = base["cod_deposito"].apply(normalizar_codigo_deposito)
    base = base.drop_duplicates(subset=["COD_DEPOSITO_NORMALIZADO"], keep="first")

    mapa = {}
    ignorados = []

    for _, row in base.iterrows():
        codigo = normalizar_codigo_deposito(row.get("cod_deposito"))
        nome = str(row.get("nome_deposito") or "").strip()
        tipo = classificar_nome_deposito(nome)

        if codigo and tipo:
            mapa[codigo] = {"nome": nome, "tipo": tipo}
        elif codigo:
            ignorados.append(f"{codigo}={nome or '(sem nome)'}")

    if mapa:
        resumo = ", ".join(
            f"{codigo}={dados['nome']}→{dados['tipo']}"
            for codigo, dados in sorted(mapa.items(), key=lambda item: item[0])
        )
        log(f"   🗂️ Depósitos considerados em {LOJAS_NOME.get(cnpj, cnpj)}: {resumo}")
    else:
        log(f"   ⚠️ Não encontrei depósitos chamados Estoque, DOA ou Amostras em {LOJAS_NOME.get(cnpj, cnpj)}.")

    if ignorados:
        log(f"   ℹ️ Outros depósitos ignorados: {', '.join(ignorados)}")

    return mapa


def chamar_api_saldos_depositos(parametros):
    """Consulta cod_produto + cod_deposito + saldo atual."""
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k, v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosDetalhesDepositos</Name>
        <Parameters><Parameter id="chave">{CHAVE}</Parameter>{params_xml}</Parameters>
      </Command>
    </LinxMicrovix>"""

    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=180)
        if r.status_code != 200:
            log(f"❌ HTTP {r.status_code} em LinxProdutosDetalhesDepositos | params={parametros}")
            try:
                log(r.text[:1000])
            except Exception:
                pass
            return pd.DataFrame()

        root = etree.fromstring(r.content)
        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].strip().lower() == "false":
            msg = root.xpath(".//ResponseMessage/text()")
            erro = msg[0] if msg else "Sem mensagem"
            log(f"❌ ResponseSuccess=false em LinxProdutosDetalhesDepositos | params={parametros} | msg={erro}")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        if not rows:
            return pd.DataFrame()

        return pd.DataFrame([
            dict(zip(cols, [d.text for d in rr.xpath('./D')]))
            for rr in rows
        ])
    except Exception as e:
        log(f"❌ Exceção em LinxProdutosDetalhesDepositos: {e} | params={parametros}")
        return pd.DataFrame()


def extrair_saldos_por_deposito(cnpj, mapa_depositos):
    """Obtém e soma o saldo de cada produto por ESTOQUE, AMOSTRA e DOA."""
    if not mapa_depositos:
        return pd.DataFrame()

    codigos_ordenados = sorted(mapa_depositos.keys(), key=lambda codigo: (not str(codigo).isdigit(), int(codigo) if str(codigo).isdigit() else str(codigo)))
    codigos = ",".join(codigos_ordenados)
    dfs = []
    ts = 0

    log(f"   📚 Extraindo saldos por depósito de {LOJAS_NOME.get(cnpj, cnpj)}...")

    while True:
        params = {
            "cnpjEmp": cnpj,
            "timestamp": str(ts),
            "cod_deposito": codigos,
        }
        df = chamar_api_saldos_depositos(params)
        if df.empty:
            break

        df.columns = [str(c).strip().lower() for c in df.columns]
        dfs.append(df)

        novo_ts = obter_proximo_timestamp(df, ts)
        if novo_ts is None:
            break

        ts = novo_ts
        time.sleep(TEMPO_ESPERA_API)

    if not dfs:
        return pd.DataFrame()

    base = pd.concat(dfs, ignore_index=True)
    campos_obrigatorios = {"cod_produto", "cod_deposito", "saldo"}
    if not campos_obrigatorios.issubset(set(base.columns)):
        log(
            "   ⚠️ LinxProdutosDetalhesDepositos retornou colunas inesperadas: "
            + ", ".join(map(str, base.columns))
        )
        return pd.DataFrame()

    if "timestamp" in base.columns:
        base["timestamp"] = pd.to_numeric(base["timestamp"], errors="coerce")
        base = base.sort_values("timestamp", ascending=False)

    base["cod_produto"] = pd.to_numeric(base["cod_produto"], errors="coerce")
    base["COD_DEPOSITO_NORMALIZADO"] = base["cod_deposito"].apply(normalizar_codigo_deposito)
    base["saldo"] = to_float(base["saldo"])

    # Mantém o registro mais recente de cada produto em cada depósito.
    base = base.drop_duplicates(
        subset=["cod_produto", "COD_DEPOSITO_NORMALIZADO"],
        keep="first",
    )

    base = base[base["COD_DEPOSITO_NORMALIZADO"].isin(mapa_depositos.keys())].copy()
    base["TIPO_ESTOQUE"] = base["COD_DEPOSITO_NORMALIZADO"].map(
        lambda codigo: mapa_depositos.get(codigo, {}).get("tipo")
    )
    base["NOME_DEPOSITO"] = base["COD_DEPOSITO_NORMALIZADO"].map(
        lambda codigo: mapa_depositos.get(codigo, {}).get("nome", "")
    )

    # O TeleFluxo exibe posição disponível; saldos zerados/negativos não geram linhas.
    base = base[base["saldo"] > 0].copy()
    base = base.dropna(subset=["cod_produto", "TIPO_ESTOQUE"])

    if base.empty:
        return pd.DataFrame()

    # Caso existam dois depósitos com o mesmo tipo, soma-os em uma única categoria.
    agrupado = (
        base.groupby(["cod_produto", "TIPO_ESTOQUE"], as_index=False)
        .agg(
            saldo=("saldo", "sum"),
            CODIGOS_DEPOSITO=("COD_DEPOSITO_NORMALIZADO", lambda s: ",".join(dict.fromkeys(map(str, s)))),
            NOMES_DEPOSITO=("NOME_DEPOSITO", lambda s: " | ".join(dict.fromkeys(str(v) for v in s if str(v).strip()))),
        )
    )

    agrupado.rename(columns={
        "cod_produto": "CODIGO_PRODUTO",
        "saldo": "QUANTIDADE",
    }, inplace=True)
    agrupado["CNPJ_ORIGEM"] = cnpj
    agrupado["NOME_FANTASIA"] = LOJAS_NOME.get(cnpj, f"LOJA {cnpj[-4:]}")

    resumo = agrupado.groupby("TIPO_ESTOQUE")["QUANTIDADE"].sum().round(2).to_dict()
    log(f"   ✅ Saldos por depósito: {len(agrupado)} registros | quantidades: {resumo}")
    return agrupado


def extrair_estoque(cnpj, modo_completo=False, mapa_depositos=None):
    """
    Mantém LinxProdutosDetalhes para preços/custos e usa
    LinxProdutosDetalhesDepositos para a quantidade separada por depósito.

    Se o método por depósito não retornar dados, preserva o comportamento antigo
    usando o saldo agregado como ESTOQUE.
    """
    hoje = datetime.now().date()
    mov_ini = hoje - timedelta(days=JANELA_DIAS_MOV)
    dfs = []
    ts = 0

    if modo_completo:
        log(f"   📦 Extraindo estoque COMPLETO da loja {LOJAS_NOME.get(cnpj, cnpj)}...")
        while True:
            params = {
                "cnpjEmp": cnpj,
                "timestamp": str(ts),
                "retornar_saldo_zero": "1"
            }

            df = chamar_api_detalhes(params)
            if df.empty:
                break

            df.columns = [str(c).strip().lower() for c in df.columns]
            dfs.append(df)

            novo_ts = obter_proximo_timestamp(df, ts)
            if novo_ts is None:
                break

            ts = novo_ts
            time.sleep(TEMPO_ESPERA_API)

    else:
        log(f"   📅 Extraindo estoque por movimentação ({JANELA_DIAS_MOV} dias) da loja {LOJAS_NOME.get(cnpj, cnpj)}...")
        while True:
            params = {
                "cnpjEmp": cnpj,
                "data_mov_ini": iso(mov_ini),
                "data_mov_fim": iso(hoje),
                "timestamp": str(ts)
            }

            df = chamar_api_detalhes(params)
            if df.empty:
                break

            df.columns = [str(c).strip().lower() for c in df.columns]
            dfs.append(df)

            novo_ts = obter_proximo_timestamp(df, ts)
            if novo_ts is None:
                break

            ts = novo_ts
            time.sleep(TEMPO_ESPERA_API)

        # Fallback automático para o modo completo, mantendo a lógica já existente.
        if not dfs:
            log(f"   🔁 Sem retorno por movimentação para {LOJAS_NOME.get(cnpj, cnpj)}. Tentando modo completo...")
            return extrair_estoque(
                cnpj,
                modo_completo=True,
                mapa_depositos=mapa_depositos,
            )

    if not dfs:
        # Mesmo que LinxProdutosDetalhes não retorne dados, ainda tenta o método
        # específico por depósito. O catálogo carregado depois preencherá nome,
        # referência e categoria; preços/custos ficam zerados somente nesse fallback.
        saldos_sem_detalhes = extrair_saldos_por_deposito(cnpj, mapa_depositos or {})
        if not saldos_sem_detalhes.empty:
            for coluna in ["PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
                saldos_sem_detalhes[coluna] = 0
            log(
                f"   ⚠️ Sem LinxProdutosDetalhes em {LOJAS_NOME.get(cnpj, cnpj)}, "
                "mas os saldos por depósito foram preservados."
            )
            return saldos_sem_detalhes
        return pd.DataFrame()

    detalhes = pd.concat(dfs, ignore_index=True)

    if "timestamp" in detalhes.columns:
        detalhes["timestamp"] = pd.to_numeric(detalhes["timestamp"], errors="coerce")
        detalhes = detalhes.sort_values("timestamp", ascending=False)

    if "cod_produto" in detalhes.columns:
        detalhes["cod_produto"] = pd.to_numeric(detalhes["cod_produto"], errors="coerce")

    detalhes = detalhes.drop_duplicates(subset=["cod_produto"], keep="first")
    detalhes["CNPJ_ORIGEM"] = cnpj
    detalhes["NOME_FANTASIA"] = LOJAS_NOME.get(cnpj, f"LOJA {cnpj[-4:]}")
    detalhes.rename(columns={
        "cod_produto": "CODIGO_PRODUTO",
        "quantidade": "QUANTIDADE",
        "preco_custo": "PRECO_CUSTO",
        "preco_venda": "PRECO_VENDA",
        "custo_medio": "CUSTO_MEDIO"
    }, inplace=True)

    saldos_depositos = extrair_saldos_por_deposito(cnpj, mapa_depositos or {})

    if not saldos_depositos.empty:
        # Quantidade vem exclusivamente do método por depósito; detalhes continuam
        # fornecendo preço, custo, custo médio e os demais campos já usados.
        colunas_detalhes = [
            coluna for coluna in detalhes.columns
            if coluna not in {"QUANTIDADE", "TIPO_ESTOQUE", "CNPJ_ORIGEM", "NOME_FANTASIA"}
        ]
        detalhes_para_merge = detalhes[colunas_detalhes].copy()
        base = saldos_depositos.merge(
            detalhes_para_merge,
            on="CODIGO_PRODUTO",
            how="left",
        )

        for coluna in ["PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
            if coluna not in base.columns:
                base[coluna] = 0

        tipos_encontrados = base["TIPO_ESTOQUE"].value_counts().to_dict()
        log(f"   ✅ {LOJAS_NOME.get(cnpj, cnpj)}: {len(base)} registros separados | tipos: {tipos_encontrados}")
        return base

    # Fallback seguro: mantém exatamente o comportamento anterior.
    detalhes["TIPO_ESTOQUE"] = "ESTOQUE"
    if "QUANTIDADE" not in detalhes.columns:
        detalhes["QUANTIDADE"] = 0
    detalhes["QUANTIDADE"] = to_float(detalhes["QUANTIDADE"])
    detalhes = detalhes[detalhes["QUANTIDADE"] > 0].copy()
    log(
        f"   ⚠️ Sem saldo por depósito em {LOJAS_NOME.get(cnpj, cnpj)}; "
        f"usando {len(detalhes)} registros do estoque agregado como ESTOQUE."
    )
    return detalhes


# ===========================================
# 3. EXTRAÇÃO DE SERIAIS (IMEI) POR DEPÓSITO
# ===========================================
def chamar_api_seriais(parametros):
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k, v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosSerial</Name>
        <Parameters><Parameter id="chave">{CHAVE}</Parameter>{params_xml}</Parameters>
      </Command>
    </LinxMicrovix>"""
    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=120)
        if r.status_code != 200:
            log(f"❌ HTTP {r.status_code} em LinxProdutosSerial | params={parametros}")
            return pd.DataFrame()

        root = etree.fromstring(r.content)
        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].strip().lower() == "false":
            msg = root.xpath(".//ResponseMessage/text()")
            erro = msg[0] if msg else "Sem mensagem"
            log(f"❌ ResponseSuccess=false em LinxProdutosSerial | params={parametros} | msg={erro}")
            return pd.DataFrame()

        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except Exception as e:
        log(f"❌ Exceção em LinxProdutosSerial: {e} | params={parametros}")
        return pd.DataFrame()


def extrair_seriais_loja(cnpj, mapa_depositos=None):
    dfs = []
    ts = 0
    mapa_depositos = mapa_depositos or {}
    codigos_ordenados = sorted(mapa_depositos.keys(), key=lambda codigo: (not str(codigo).isdigit(), int(codigo) if str(codigo).isdigit() else str(codigo)))
    codigos_depositos = ",".join(codigos_ordenados)

    while True:
        params = {"cnpjEmp": cnpj, "timestamp": str(ts)}
        if codigos_depositos:
            # Na documentação, o filtro deste método se chama "depositos".
            params["depositos"] = codigos_depositos

        df = chamar_api_seriais(params)
        if df.empty:
            break

        df.columns = [str(c).strip().lower() for c in df.columns]

        # Calcula a próxima página antes do filtro de saldo. Assim, uma página
        # contendo somente seriais inativos não interrompe a paginação.
        novo_ts = obter_proximo_timestamp(df, ts)

        if "saldo" in df.columns:
            df = df[df["saldo"].astype(str).str.lower().isin(["true", "1", "s", "sim", "1.0"])]

        if not df.empty:
            dfs.append(df)

        if novo_ts is None:
            break

        ts = novo_ts
        time.sleep(TEMPO_ESPERA_API)

    if not dfs:
        return pd.DataFrame()

    base = pd.concat(dfs, ignore_index=True)

    if "timestamp" in base.columns:
        base["timestamp"] = pd.to_numeric(base["timestamp"], errors="coerce")
        base = base.sort_values("timestamp", ascending=False)

    if "id_deposito" in base.columns:
        base["COD_DEPOSITO_NORMALIZADO"] = base["id_deposito"].apply(normalizar_codigo_deposito)

        if mapa_depositos:
            base = base[base["COD_DEPOSITO_NORMALIZADO"].isin(mapa_depositos.keys())].copy()
            base["TIPO_ESTOQUE"] = base["COD_DEPOSITO_NORMALIZADO"].map(
                lambda codigo: mapa_depositos.get(codigo, {}).get("tipo", "ESTOQUE")
            )
            base["NOME_DEPOSITO"] = base["COD_DEPOSITO_NORMALIZADO"].map(
                lambda codigo: mapa_depositos.get(codigo, {}).get("nome", "")
            )
        else:
            base["TIPO_ESTOQUE"] = "ESTOQUE"
    else:
        # Compatibilidade com respostas antigas que não tragam id_deposito.
        base["TIPO_ESTOQUE"] = "ESTOQUE"

    if base.empty:
        return pd.DataFrame()

    base = base.drop_duplicates(subset=["serial"], keep="first")
    base["CNPJ_ORIGEM"] = cnpj

    resumo = base["TIPO_ESTOQUE"].value_counts().to_dict()
    log(f"   🔢 IMEIs ativos por tipo em {LOJAS_NOME.get(cnpj, cnpj)}: {resumo}")
    return base

# ===========================================
# 4. SALVAR NA NUVEM VIA API (EM LOTES)
# ===========================================
def limpar_valor_json(valor):
    """
    Garante que nenhum valor inválido vá para o JSON.
    Converte:
    - NaN -> None
    - NaT -> None
    - Infinity -> None
    - -Infinity -> None
    - Timestamp/datetime -> string ISO
    """
    if valor is None:
        return None

    try:
        if pd.isna(valor):
            return None
    except Exception:
        pass

    if isinstance(valor, float):
        if valor != valor or valor == float("inf") or valor == float("-inf"):
            return None
        return valor

    if isinstance(valor, (pd.Timestamp, datetime)):
        return valor.isoformat()

    return valor


def limpar_registro_json(registro):
    """
    Limpa um dicionário inteiro antes de enviar para a API.
    """
    return {
        chave: limpar_valor_json(valor)
        for chave, valor in registro.items()
    }


def encontrar_valores_invalidos(lote):
    """
    Ajuda a descobrir exatamente qual campo ainda está com NaN/Infinity.

    Importante:
    - None é permitido, porque em JSON vira null.
    - O problema real é NaN/Infinity/-Infinity, que quebram o requests.post(json=...).
    """
    problemas = []

    for indice, registro in enumerate(lote):
        for campo, valor in registro.items():
            # None é válido em JSON: vira null.
            if valor is None:
                continue

            # Float inválido: NaN, Infinity ou -Infinity.
            if isinstance(valor, float):
                if valor != valor or valor == float("inf") or valor == float("-inf"):
                    problemas.append(f"linha_lote={indice} | campo={campo} | valor={valor}")

    return problemas


def enviar_para_api(dataframe):
    base_url = API_STOCK_SYNC_URL

    if dataframe is None or dataframe.empty:
        log("⚠️ Nenhum dado para enviar para a API.")
        return False

    # ✅ Correção principal:
    # dataframe.where(pd.notnull(...), None) nem sempre remove NaN de colunas numéricas.
    # Por isso limpamos registro por registro depois do to_dict.
    dados_completos = dataframe.to_dict(orient="records")
    dados_completos = [limpar_registro_json(registro) for registro in dados_completos]

    # Divide os itens em pacotes de 100 para não pesar no Render
    BATCH_SIZE = 100
    total_lotes = (len(dados_completos) + BATCH_SIZE - 1) // BATCH_SIZE

    log(f"📡 Preparando envio de {len(dados_completos)} registros em {total_lotes} lotes...")

    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados_completos), BATCH_SIZE):
        lote = dados_completos[i: i + BATCH_SIZE]
        lote_num = (i // BATCH_SIZE) + 1

        # ✅ Segurança extra:
        # Se ainda existir valor inválido, mostra exatamente onde está antes de tentar enviar.
        problemas = encontrar_valores_invalidos(lote)
        if problemas:
            log(f"❌ Valores inválidos encontrados no Lote {lote_num}:")
            for problema in problemas[:30]:
                log(f"   - {problema}")

            if len(problemas) > 30:
                log(f"   ... e mais {len(problemas) - 30} problemas.")

            return False

        # O primeiro lote apaga o banco, os outros apenas empilham os dados
        param_reset = "true" if i == 0 else "false"
        url_lote = f"{base_url}?reset={param_reset}"

        log(f"   📦 Enviando Lote {lote_num}/{total_lotes}...")

        for attempt in range(1, 6):
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=120)

                if 200 <= response.status_code < 300:
                    time.sleep(0.5)
                    break

                log(f"      ⚠️ Erro no Lote {lote_num} (Tentativa {attempt}): {response.status_code}")

                try:
                    resposta_api = response.text or ""
                    log(f"      Resposta API: {resposta_api[:500]}")

                    # Erro estrutural: não adianta repetir cinco vezes.
                    # O banco de produção precisa receber a migration/DB push
                    # que cria a coluna Stock.stockType.
                    resposta_normalizada = resposta_api.lower()
                    if (
                        "stocktype" in resposta_normalizada
                        and (
                            "does not exist" in resposta_normalizada
                            or "nao existe" in resposta_normalizada
                            or "não existe" in resposta_normalizada
                        )
                    ):
                        log("❌ O banco do backend ainda não possui a coluna stockType.")
                        log("👉 Faça o deploy da migration/schema no Render antes de executar o sincronizador novamente.")
                        return False
                except Exception:
                    pass

                time.sleep(5)

            except Exception as e:
                log(f"      ⚠️ Falha ao enviar Lote {lote_num} (Tentativa {attempt}): {e}")
                time.sleep(5)

        else:
            log(f"❌ Desistindo do Lote {lote_num} após várias tentativas.")
            return False

    log("✅ Sucesso Absoluto! Estoque e IMEIs atualizados na Produção.")
    return True

# ===========================================
# ▶ EXECUÇÃO PRINCIPAL
# ===========================================
def main():
    log("🚀 Iniciando Sincronização v9.2 (DEPÓSITOS: ESTOQUE / AMOSTRA / DOA + IMEI)...")

    # ✅ NOVO: carrega classificações do Excel
    mapa_em_linha, mapa_cluster = carregar_classificacoes_excel()

    # 1. Catálogo
    catalogo = extrair_catalogo_completo()
    if catalogo.empty:
        log("⚠️ ERRO: Catálogo vazio.")
        return
    log(f"✅ Catálogo OK: {len(catalogo)} produtos carregados.")

    # 2. Estoque Agregado e Seriais
    todos_dados = []
    todos_seriais = []

    for i, cnpj in enumerate(CNPJS):
        log(f"[{i+1}/{len(CNPJS)}] CNPJ: {cnpj}...")

        # Descobre os códigos dos depósitos daquela loja pelo nome cadastrado no ERP.
        mapa_depositos = extrair_depositos_loja(cnpj)

        # Mantém preços/custos do método já usado e substitui somente a origem
        # das quantidades pelos saldos fragmentados por depósito.
        df_est = extrair_estoque(
            cnpj,
            modo_completo=False,
            mapa_depositos=mapa_depositos,
        )
        if not df_est.empty:
            todos_dados.append(df_est)

        # Puxa os IMEIs e preserva o id_deposito para não misturar os tipos.
        df_ser = extrair_seriais_loja(cnpj, mapa_depositos=mapa_depositos)
        if not df_ser.empty:
            todos_seriais.append(df_ser)

    if not todos_dados:
        log("❌ Nenhum estoque encontrado.")
        return

    df_estoque = pd.concat(todos_dados, ignore_index=True)
    df_seriais = pd.concat(todos_seriais, ignore_index=True) if todos_seriais else pd.DataFrame(columns=["CNPJ_ORIGEM", "codigoproduto", "serial", "TIPO_ESTOQUE"])

    # 3. Cruzamento Estoque x Catálogo
    log("🔄 Unificando dados de Catálogo...")
    df_estoque["CODIGO_PRODUTO"] = pd.to_numeric(df_estoque["CODIGO_PRODUTO"], errors="coerce")
    catalogo["CODIGO_PRODUTO"] = pd.to_numeric(catalogo["CODIGO_PRODUTO"], errors="coerce")
    df_seriais["codigoproduto"] = pd.to_numeric(df_seriais["codigoproduto"], errors="coerce")

    df_estoque = df_estoque.merge(catalogo, on="CODIGO_PRODUTO", how="left")
    df_estoque["DESCRICAO"] = df_estoque["NOME_REAL"].fillna("PRODUTO S/ CADASTRO")
    df_estoque["REFERENCIA"] = df_estoque["REF_REAL"].fillna("-")
    df_estoque["CATEGORIA"] = df_estoque["CAT_REAL"].fillna("GERAL")

    for col in ["QUANTIDADE", "PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
        df_estoque[col] = to_float(df_estoque.get(col, 0))

    # Bases alternativas podem trazer ESTOQUE, AMOSTRA e DOA em colunas separadas.
    # A expansão ocorre antes do IMEI; cada tipo usa somente seriais do seu depósito.
    df_estoque = expandir_quantidades_por_tipo(df_estoque)

    # 4. A MÁGICA: DESDOBRAMENTO POR IMEI
    log("🔍 Desdobrando itens com IMEI...")
    linhas_expandidas = []

    for _, row in df_estoque.iterrows():
        cnpj = row["CNPJ_ORIGEM"]
        cod = row["CODIGO_PRODUTO"]
        qtd_total = float(row["QUANTIDADE"])

        tipo_estoque = normalizar_tipo_estoque(row.get("TIPO_ESTOQUE", "ESTOQUE"))

        # Usa somente os IMEIs pertencentes ao mesmo depósito/tipo da quantidade.
        # Assim um aparelho em DOA ou AMOSTRA não aparece no ESTOQUE normal.
        mascara_seriais = (
            (df_seriais["CNPJ_ORIGEM"] == cnpj) &
            (df_seriais["codigoproduto"] == cod)
        )

        if "TIPO_ESTOQUE" in df_seriais.columns:
            mascara_seriais = mascara_seriais & (
                df_seriais["TIPO_ESTOQUE"].apply(normalizar_tipo_estoque) == tipo_estoque
            )
        elif tipo_estoque != "ESTOQUE":
            # Resposta antiga sem id_deposito: não atribui o mesmo IMEI a AMOSTRA/DOA.
            mascara_seriais = mascara_seriais & False

        seriais_produto = df_seriais[mascara_seriais]["serial"].tolist()

        # ✅ NOVO: limpa, deduplica e evita serial vazio
        seriais_produto = list(dict.fromkeys(
            [str(s).strip() for s in seriais_produto if str(s).strip()]
        ))

        if len(seriais_produto) > 0 and qtd_total > 0:
            # ✅ NOVO: limita o número de seriais ao saldo da API, para não inflar quantidade
            qtd_serializada = min(len(seriais_produto), int(qtd_total))

            if len(seriais_produto) > int(qtd_total):
                log(f"⚠️ Divergência de serial x saldo | Loja: {row['NOME_FANTASIA']} | Produto: {cod} | Saldo API: {qtd_total} | Seriais: {len(seriais_produto)}")

            # Aparelho com IMEI encontrado! Quebra em 1 linha para cada IMEI válido até o saldo da API
            for s in seriais_produto[:qtd_serializada]:
                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = 1.0  # Cada IMEI é 1 unidade
                nova_linha["SERIAL"] = s
                linhas_expandidas.append(nova_linha)

            # Se o sistema diz que tem 5, mas só achou 4 IMEIs, cria uma linha pro restante
            qtd_restante = max(qtd_total - qtd_serializada, 0)
            if qtd_restante > 0:
                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = qtd_restante
                nova_linha["SERIAL"] = ""
                linhas_expandidas.append(nova_linha)
        else:
            # Acessórios (ou itens sem IMEI) ficam na mesma linha somada
            nova_linha = row.copy()
            nova_linha["SERIAL"] = ""
            linhas_expandidas.append(nova_linha)

    df_final = pd.DataFrame(linhas_expandidas)

    # ✅ NOVO: normaliza para fazer o PROCV
    df_final["REFERENCIA"] = df_final["REFERENCIA"].fillna("").astype(str).str.strip().str.upper()
    df_final["NOME_FANTASIA"] = df_final["NOME_FANTASIA"].fillna("").astype(str).str.strip().str.upper()

    # ✅ NOVO: busca a linha do produto pela referência
    df_final["EM_LINHA"] = df_final["REFERENCIA"].map(mapa_em_linha).fillna("")

    # ✅ NOVO: busca o cluster pela loja
    df_final["CLUSTER"] = df_final["NOME_FANTASIA"].map(mapa_cluster).fillna("")

    # Garante que todo registro enviado tenha um tipo de estoque explícito.
    if "TIPO_ESTOQUE" not in df_final.columns:
        df_final["TIPO_ESTOQUE"] = "ESTOQUE"

    df_final["TIPO_ESTOQUE"] = df_final["TIPO_ESTOQUE"].apply(normalizar_tipo_estoque)

    resumo_tipos = (
        df_final.groupby("TIPO_ESTOQUE")["QUANTIDADE"]
        .sum()
        .round(2)
        .to_dict()
    )
    log(f"📊 Quantidades por tipo antes do envio: {resumo_tipos}")

    # Auditoria local: permite conferir exatamente o que será enviado ao backend.
    auditoria_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "auditoria_estoque_por_tipo.csv",
    )
    colunas_auditoria = [
        coluna for coluna in [
            "CNPJ_ORIGEM", "NOME_FANTASIA", "CODIGO_PRODUTO",
            "DESCRICAO", "REFERENCIA", "TIPO_ESTOQUE",
            "QUANTIDADE", "SERIAL",
        ]
        if coluna in df_final.columns
    ]
    df_final[colunas_auditoria].to_csv(
        auditoria_path,
        index=False,
        encoding="utf-8-sig",
    )
    log(f"🧾 Auditoria pré-envio salva em: {auditoria_path}")

    # O diagnóstico oficial da própria API confirmou saldo no depósito AMOSTRAS
    # (código 4) para a loja Araguaia. Se AMOSTRA continuar zerada aqui,
    # interrompemos antes do primeiro lote para não limpar a produção com uma
    # carga novamente classificada apenas como ESTOQUE.
    if float(resumo_tipos.get("AMOSTRA", 0) or 0) <= 0:
        log("❌ Validação de segurança: nenhuma AMOSTRA foi preparada para envio.")
        log("👉 A API confirmou saldo no depósito AMOSTRAS; o banco de produção NÃO será limpo.")
        return 1

    # 5. SALVAMENTO DIRETO
    log("💾 Disparando dados com IMEIs para a API da Produção...")
    sucesso = enviar_para_api(df_final)

    if not sucesso:
        log("❌ Sincronização não concluída. O estoque não foi totalmente enviado.")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
