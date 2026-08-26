# ===========================================
# 📦 SINCRONIZADOR DE ESTOQUE v10.3.1 (CUSTO POR IMEI + DEPÓSITOS)
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
from lxml import etree
import pandas as pd
from datetime import date, datetime, timedelta
import os
import sys
import time
import json
import sqlite3
import uuid
import re
import unicodedata
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

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

# === CUSTO REAL POR IMEI ===
#
# A API não devolve o custo dentro de LinxProdutosSerial. O custo correto é
# reconstruído ligando:
#   LinxProdutosSerial -> LinxMovimentoSerial -> LinxMovimento.
#
# No LinxMovimento, o campo que reproduz o "CUSTO_SERIAL_ENTRADA" do ERP é
# preco_unitario da compra original. preco_custo e custo_medio NÃO representam
# o preço de aquisição individual do IMEI.
SCRIPT_DIR = Path(__file__).resolve().parent
CUSTO_IMEI_CACHE = Path(
    os.getenv(
        "CUSTO_IMEI_CACHE",
        str(SCRIPT_DIR / "cache_custos_imei.sqlite3"),
    )
)
CUSTO_IMEI_AUDITORIA = Path(
    os.getenv(
        "CUSTO_IMEI_AUDITORIA",
        str(SCRIPT_DIR / "auditoria_custos_imei_sync.csv"),
    )
)

# Os dois caches abaixo já existiam nas versões de diagnóstico do projeto.
# Eles são importados uma única vez para evitar refazer todo o histórico.
CUSTO_IMEI_CACHES_LEGADOS = [
    SCRIPT_DIR / "diagnosticos" / "cache_custos_notas_microvix_v95.sqlite3",
    SCRIPT_DIR / "diagnosticos" / "cache_custos_notas_microvix.sqlite3",
]

# Um mapa exportado pelo relatório Faturamento (5298) também pode ser usado
# como fonte. O script mapear_custos_imei.py gera esse arquivo.
CUSTO_IMEI_MAPAS_CSV = [
    SCRIPT_DIR / "mapa_custos_imei.csv",
    SCRIPT_DIR / "diagnosticos" / "mapa_custos_imei.csv",
]

# Se ainda houver IMEIs sem custo após ler os caches, o histórico é pesquisado
# por janelas crescentes. A primeira janela resolve compras recentes sem baixar
# anos de movimentos. As demais só são executadas para IMEIs ainda faltantes.
CUSTO_IMEI_DATA_MINIMA = date(2015, 1, 1)
CUSTO_IMEI_LIMITES_DIAS = (120, 365, 1095)
CUSTO_IMEI_ATUALIZAR_API = (
    os.getenv("CUSTO_IMEI_ATUALIZAR_API", "true").strip().lower()
    not in {"0", "false", "nao", "não", "n"}
)
CUSTO_IMEI_TEMPO_ESPERA_API = float(
    os.getenv("CUSTO_IMEI_TEMPO_ESPERA_API", "0.08")
)

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

# Depósitos cadastrados no Microvix, confirmados pelo diagnóstico do projeto:
# 1 = Estoque normal, 2 = DOA e 4 = Amostras.
DEPOSITOS_POR_TIPO = {
    "ESTOQUE": "1",
    "DOA": "2",
    "AMOSTRA": "4",
}
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


def numero_api(valor: Any) -> float:
    """
    Converte números devolvidos pela API ou por relatórios CSV.

    Aceita tanto o padrão da API (986.7400) quanto o padrão brasileiro
    (986,74 ou 1.234,56).
    """
    if valor is None:
        return 0.0

    try:
        if pd.isna(valor):
            return 0.0
    except (TypeError, ValueError):
        pass

    if isinstance(valor, (int, float)):
        try:
            return float(valor)
        except (TypeError, ValueError):
            return 0.0

    texto = (
        str(valor)
        .strip()
        .replace("R$", "")
        .replace("\u00a0", "")
        .replace(" ", "")
    )
    texto = re.sub(r"[^0-9,.\-]", "", texto)

    if not texto or texto in {"-", ".", ","}:
        return 0.0

    if "," in texto and "." in texto:
        if texto.rfind(",") > texto.rfind("."):
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", "")
    elif "," in texto:
        texto = texto.replace(".", "").replace(",", ".")

    try:
        return float(texto)
    except ValueError:
        return 0.0


def normalizar_texto_custo(valor: Any) -> str:
    texto = str(valor or "").strip()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(
        caractere
        for caractere in texto
        if not unicodedata.combining(caractere)
    )
    return re.sub(r"\s+", " ", texto.upper()).strip()


def normalizar_serial(valor: Any) -> str:
    return "".join(
        caractere
        for caractere in normalizar_texto_custo(valor)
        if caractere.isalnum()
    )


def normalizar_codigo_produto(valor: Any) -> str:
    texto = str(valor or "").strip()
    if not texto:
        return ""
    try:
        return str(int(float(texto.replace(",", "."))))
    except (TypeError, ValueError):
        return texto.upper()


def valor_booleano_verdadeiro(valor: Any) -> bool:
    return normalizar_texto_custo(valor) in {
        "S",
        "SIM",
        "1",
        "TRUE",
        "VERDADEIRO",
        "CANCELADO",
        "EXCLUIDO",
    }

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


# ===========================================
# 💰 CUSTO REAL DA COMPRA POR IMEI
# ===========================================
def resposta_api_para_dataframe(conteudo: bytes) -> pd.DataFrame:
    root = etree.fromstring(conteudo)

    sucesso = root.xpath(".//ResponseSuccess/text()")
    if sucesso and sucesso[0].strip().lower() == "false":
        mensagem = root.xpath(".//ResponseMessage/text()")
        detalhe = mensagem[0] if mensagem else "Sem mensagem"
        raise RuntimeError(detalhe)

    colunas = [item.text for item in root.xpath(".//C[last()]/D")]
    linhas = root.xpath(".//R")

    if not colunas or not linhas:
        return pd.DataFrame()

    dados = [
        dict(
            zip(
                colunas,
                [item.text for item in linha.xpath("./D")],
            )
        )
        for linha in linhas
    ]
    resultado = pd.DataFrame(dados)
    resultado.columns = [
        str(coluna).strip().lower()
        for coluna in resultado.columns
    ]
    return resultado


def chamar_api_metodo(
    metodo: str,
    parametros: dict[str, Any],
    timeout: int = 180,
) -> pd.DataFrame:
    parametros_xml = "".join(
        f'<Parameter id="{escape(str(chave))}">'
        f"{escape(str(valor))}</Parameter>"
        for chave, valor in parametros.items()
        if valor is not None
    )

    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{escape(str(USUARIO))}" password="{escape(str(SENHA))}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>{escape(str(metodo))}</Name>
        <Parameters>
          <Parameter id="chave">{escape(str(CHAVE))}</Parameter>
          {parametros_xml}
        </Parameters>
      </Command>
    </LinxMicrovix>"""

    try:
        resposta = requests.post(
            URL,
            data=xml.encode("utf-8"),
            headers=headers,
            auth=auth,
            timeout=timeout,
        )

        if resposta.status_code != 200:
            log(
                f"❌ HTTP {resposta.status_code} em {metodo} "
                f"| params={parametros}"
            )
            return pd.DataFrame()

        return resposta_api_para_dataframe(resposta.content)
    except Exception as erro:
        log(
            f"❌ Falha em {metodo} | params={parametros} "
            f"| erro={erro}"
        )
        return pd.DataFrame()


def inicializar_cache_custos() -> sqlite3.Connection:
    CUSTO_IMEI_CACHE.parent.mkdir(parents=True, exist_ok=True)

    conexao = sqlite3.connect(CUSTO_IMEI_CACHE)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA journal_mode=WAL")
    conexao.execute("PRAGMA synchronous=NORMAL")

    conexao.executescript(
        """
        CREATE TABLE IF NOT EXISTS custo_imei (
            serial_normalizado TEXT PRIMARY KEY,
            codigo_produto TEXT,
            custo_aquisicao REAL NOT NULL,
            documento TEXT,
            serie TEXT,
            data_entrada TEXT,
            cnpj_compra TEXT,
            identificador TEXT,
            transacao TEXT,
            campo_origem TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documento_movimento (
            cnpj_emp TEXT NOT NULL,
            identificador TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            consultado_em TEXT NOT NULL,
            PRIMARY KEY (cnpj_emp, identificador)
        );

        CREATE TABLE IF NOT EXISTS cache_meta (
            chave TEXT PRIMARY KEY,
            valor TEXT,
            atualizado_em TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_custo_imei_produto
        ON custo_imei (codigo_produto);
        """
    )
    conexao.commit()
    return conexao


def cache_meta_existe(
    conexao: sqlite3.Connection,
    chave: str,
) -> bool:
    linha = conexao.execute(
        "SELECT 1 FROM cache_meta WHERE chave = ?",
        (chave,),
    ).fetchone()
    return linha is not None


def gravar_cache_meta(
    conexao: sqlite3.Connection,
    chave: str,
    valor: str,
) -> None:
    conexao.execute(
        """
        INSERT INTO cache_meta (chave, valor, atualizado_em)
        VALUES (?, ?, ?)
        ON CONFLICT(chave) DO UPDATE SET
            valor = excluded.valor,
            atualizado_em = excluded.atualizado_em
        """,
        (
            chave,
            valor,
            datetime.now().isoformat(timespec="seconds"),
        ),
    )


def importar_caches_legados(
    conexao: sqlite3.Connection,
) -> None:
    """
    Importa os custos já levantados pelos diagnósticos anteriores.

    A versão v95 é consultada primeiro por ser a mais completa. INSERT OR
    IGNORE evita que um cache antigo substitua um custo novo já resolvido.
    """
    total_importado = 0

    for caminho in CUSTO_IMEI_CACHES_LEGADOS:
        if not caminho.exists():
            continue

        assinatura = (
            f"{caminho.resolve()}::{caminho.stat().st_size}::"
            f"{int(caminho.stat().st_mtime)}"
        )
        chave_meta = f"cache_legado::{assinatura}"

        if cache_meta_existe(conexao, chave_meta):
            continue

        try:
            legado = sqlite3.connect(
                f"file:{caminho.resolve()}?mode=ro",
                uri=True,
            )
            legado.row_factory = sqlite3.Row

            tabela = legado.execute(
                """
                SELECT 1
                FROM sqlite_master
                WHERE type = 'table' AND name = 'custo_imei'
                """
            ).fetchone()

            if tabela is None:
                legado.close()
                continue

            registros = legado.execute(
                """
                SELECT
                    serial_normalizado,
                    codigo_produto,
                    custo_aquisicao,
                    documento,
                    serie,
                    data_entrada,
                    cnpj_compra,
                    identificador,
                    transacao,
                    campo_origem,
                    atualizado_em
                FROM custo_imei
                WHERE custo_aquisicao > 0
                """
            ).fetchall()
            legado.close()

            antes = conexao.total_changes
            conexao.executemany(
                """
                INSERT OR IGNORE INTO custo_imei (
                    serial_normalizado,
                    codigo_produto,
                    custo_aquisicao,
                    documento,
                    serie,
                    data_entrada,
                    cnpj_compra,
                    identificador,
                    transacao,
                    campo_origem,
                    atualizado_em
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        normalizar_serial(registro["serial_normalizado"]),
                        normalizar_codigo_produto(registro["codigo_produto"]),
                        numero_api(registro["custo_aquisicao"]),
                        str(registro["documento"] or ""),
                        str(registro["serie"] or ""),
                        str(registro["data_entrada"] or ""),
                        str(registro["cnpj_compra"] or ""),
                        str(registro["identificador"] or ""),
                        str(registro["transacao"] or ""),
                        str(registro["campo_origem"] or "preco_unitario"),
                        str(
                            registro["atualizado_em"]
                            or datetime.now().isoformat(timespec="seconds")
                        ),
                    )
                    for registro in registros
                    if normalizar_serial(registro["serial_normalizado"])
                    and numero_api(registro["custo_aquisicao"]) > 0
                ],
            )
            importados = conexao.total_changes - antes
            total_importado += importados
            gravar_cache_meta(
                conexao,
                chave_meta,
                f"{len(registros)} registros lidos; {importados} importados",
            )
            conexao.commit()
        except Exception as erro:
            log(
                f"⚠️ Não foi possível importar o cache legado "
                f"{caminho.name}: {erro}"
            )

    if total_importado > 0:
        log(
            f"✅ Cache de custos inicializado com "
            f"{total_importado} IMEIs históricos."
        )


def localizar_coluna_csv(
    colunas: list[str],
    candidatos: tuple[str, ...],
) -> str | None:
    mapa = {
        normalizar_texto_custo(coluna)
        .lower()
        .replace(" ", "_"): coluna
        for coluna in colunas
    }
    for candidato in candidatos:
        chave = (
            normalizar_texto_custo(candidato)
            .lower()
            .replace(" ", "_")
        )
        if chave in mapa:
            return mapa[chave]
    return None


def importar_mapas_csv(
    conexao: sqlite3.Connection,
) -> None:
    for caminho in CUSTO_IMEI_MAPAS_CSV:
        if not caminho.exists():
            continue

        assinatura = (
            f"{caminho.resolve()}::{caminho.stat().st_size}::"
            f"{int(caminho.stat().st_mtime)}"
        )
        chave_meta = f"mapa_csv::{assinatura}"

        if cache_meta_existe(conexao, chave_meta):
            continue

        try:
            tabela = None
            for separador in (";", ",", "\t"):
                try:
                    candidata = pd.read_csv(
                        caminho,
                        sep=separador,
                        dtype=object,
                        encoding="utf-8-sig",
                        low_memory=False,
                    )
                    if len(candidata.columns) > 1:
                        tabela = candidata
                        break
                except Exception:
                    continue

            if tabela is None or tabela.empty:
                continue

            colunas = list(tabela.columns)
            coluna_imei = localizar_coluna_csv(
                colunas,
                ("IMEI", "SERIAL", "SERIAL_NORMALIZADO"),
            )
            coluna_custo = localizar_coluna_csv(
                colunas,
                (
                    "PRECO_CUSTO_SERIAL",
                    "CUSTO_SERIAL_ENTRADA",
                    "PRECO_UNITARIO",
                ),
            )

            if not coluna_imei or not coluna_custo:
                continue

            coluna_produto = localizar_coluna_csv(
                colunas,
                ("CODIGO_PRODUTO", "COD_PRODUTO", "CODIGOPRODUTO"),
            )
            coluna_documento = localizar_coluna_csv(
                colunas,
                ("NOTA_FISCAL", "DOCUMENTO", "DOCUMENTO_ENTRADA"),
            )
            coluna_serie = localizar_coluna_csv(
                colunas,
                ("SERIE", "SERIE_ENTRADA"),
            )
            coluna_data = localizar_coluna_csv(
                colunas,
                ("DATA_COMPRA", "DATA_ENTRADA", "DATA_LANCAMENTO"),
            )
            coluna_cnpj = localizar_coluna_csv(
                colunas,
                ("CNPJ_COMPRA", "CNPJ_EMP", "CNPJ"),
            )
            coluna_identificador = localizar_coluna_csv(
                colunas,
                ("IDENTIFICADOR", "IDENTIFICADOR_COMPRA"),
            )

            agora = datetime.now().isoformat(timespec="seconds")
            registros = []

            for _, linha in tabela.iterrows():
                serial = normalizar_serial(linha.get(coluna_imei))
                custo = numero_api(linha.get(coluna_custo))

                if not serial or custo <= 0:
                    continue

                registros.append(
                    (
                        serial,
                        normalizar_codigo_produto(
                            linha.get(coluna_produto)
                            if coluna_produto
                            else ""
                        ),
                        custo,
                        str(
                            linha.get(coluna_documento, "")
                            if coluna_documento
                            else ""
                        ),
                        str(
                            linha.get(coluna_serie, "")
                            if coluna_serie
                            else ""
                        ),
                        str(
                            linha.get(coluna_data, "")
                            if coluna_data
                            else ""
                        ),
                        str(
                            linha.get(coluna_cnpj, "")
                            if coluna_cnpj
                            else ""
                        ),
                        str(
                            linha.get(coluna_identificador, "")
                            if coluna_identificador
                            else ""
                        ),
                        "",
                        f"FATURAMENTO_5298::{coluna_custo}",
                        agora,
                    )
                )

            antes = conexao.total_changes
            conexao.executemany(
                """
                INSERT OR IGNORE INTO custo_imei (
                    serial_normalizado,
                    codigo_produto,
                    custo_aquisicao,
                    documento,
                    serie,
                    data_entrada,
                    cnpj_compra,
                    identificador,
                    transacao,
                    campo_origem,
                    atualizado_em
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                registros,
            )
            importados = conexao.total_changes - antes
            gravar_cache_meta(
                conexao,
                chave_meta,
                f"{len(registros)} registros lidos; {importados} importados",
            )
            conexao.commit()

            if importados:
                log(
                    f"✅ {importados} custos importados de "
                    f"{caminho.name}."
                )
        except Exception as erro:
            log(
                f"⚠️ Não foi possível importar {caminho.name}: {erro}"
            )


def buscar_custos_no_cache(
    conexao: sqlite3.Connection,
    seriais: set[str],
) -> dict[str, dict[str, Any]]:
    if not seriais:
        return {}

    resultado: dict[str, dict[str, Any]] = {}
    lista = sorted(seriais)
    tamanho_lote = 800

    for inicio in range(0, len(lista), tamanho_lote):
        lote = lista[inicio: inicio + tamanho_lote]
        placeholders = ",".join("?" for _ in lote)
        linhas = conexao.execute(
            f"""
            SELECT
                serial_normalizado,
                codigo_produto,
                custo_aquisicao,
                documento,
                serie,
                data_entrada,
                cnpj_compra,
                identificador,
                transacao,
                campo_origem
            FROM custo_imei
            WHERE serial_normalizado IN ({placeholders})
              AND custo_aquisicao > 0
            """,
            lote,
        ).fetchall()

        for linha in linhas:
            resultado[linha["serial_normalizado"]] = dict(linha)

    return resultado


def gerar_janelas_historicas() -> list[tuple[date, date]]:
    hoje = date.today()
    janelas: list[tuple[date, date]] = []
    inicio_anterior: date | None = None

    for limite_dias in CUSTO_IMEI_LIMITES_DIAS:
        inicio = max(
            CUSTO_IMEI_DATA_MINIMA,
            hoje - timedelta(days=limite_dias),
        )
        fim = (
            hoje
            if inicio_anterior is None
            else inicio_anterior - timedelta(days=1)
        )

        if inicio <= fim:
            janelas.append((inicio, fim))

        inicio_anterior = inicio

        if inicio == CUSTO_IMEI_DATA_MINIMA:
            break

    if (
        inicio_anterior is not None
        and inicio_anterior > CUSTO_IMEI_DATA_MINIMA
    ):
        fim = inicio_anterior - timedelta(days=1)
        if CUSTO_IMEI_DATA_MINIMA <= fim:
            janelas.append((CUSTO_IMEI_DATA_MINIMA, fim))

    return janelas


def buscar_movimentos_seriais_janela(
    seriais_alvo: set[str],
    data_inicial: date,
    data_final: date,
) -> pd.DataFrame:
    encontrados: list[pd.DataFrame] = []

    for indice, cnpj in enumerate(CNPJS):
        ts = 0
        nome_loja = LOJAS_NOME.get(cnpj, cnpj)

        log(
            f"   🔎 Histórico de seriais {indice + 1}/{len(CNPJS)} "
            f"| {nome_loja} | {data_inicial} a {data_final}"
        )

        while True:
            pagina = chamar_api_metodo(
                "LinxMovimentoSerial",
                {
                    "cnpjEmp": cnpj,
                    "data_inicial": data_inicial.isoformat(),
                    "data_fim": data_final.isoformat(),
                    "timestamp": str(ts),
                },
            )

            if pagina.empty:
                break

            proximo_ts = obter_proximo_timestamp(pagina, ts)

            if "serial" in pagina.columns:
                pagina["serial_normalizado"] = (
                    pagina["serial"].map(normalizar_serial)
                )
                filtrada = pagina[
                    pagina["serial_normalizado"].isin(seriais_alvo)
                ].copy()

                if not filtrada.empty:
                    filtrada["cnpj_consultado"] = cnpj
                    filtrada["janela_data_inicial"] = (
                        data_inicial.isoformat()
                    )
                    filtrada["janela_data_final"] = (
                        data_final.isoformat()
                    )
                    encontrados.append(filtrada)

            if proximo_ts is None:
                break

            ts = proximo_ts
            time.sleep(CUSTO_IMEI_TEMPO_ESPERA_API)

    if not encontrados:
        return pd.DataFrame()

    resultado = pd.concat(
        encontrados,
        ignore_index=True,
        sort=False,
    )
    chaves = [
        coluna
        for coluna in [
            "cnpj_consultado",
            "identificador",
            "transacao",
            "serial_normalizado",
        ]
        if coluna in resultado.columns
    ]

    if chaves:
        resultado = resultado.drop_duplicates(
            subset=chaves,
            keep="last",
        )

    return resultado


def obter_documento_movimento(
    conexao: sqlite3.Connection,
    cnpj: str,
    identificador: str,
    data_inicial: str,
    data_final: str,
) -> pd.DataFrame:
    cache = conexao.execute(
        """
        SELECT payload_json
        FROM documento_movimento
        WHERE cnpj_emp = ? AND identificador = ?
        """,
        (cnpj, identificador),
    ).fetchone()

    if cache is not None:
        try:
            registros = json.loads(cache["payload_json"])
            if isinstance(registros, list):
                return pd.DataFrame(registros)
        except Exception:
            pass

    documento = chamar_api_metodo(
        "LinxMovimento",
        {
            "cnpjEmp": cnpj,
            "data_inicial": data_inicial,
            "data_fim": data_final,
            "timestamp": "0",
            "identificador": identificador,
        },
    )

    if documento.empty:
        return documento

    conexao.execute(
        """
        INSERT INTO documento_movimento (
            cnpj_emp,
            identificador,
            payload_json,
            consultado_em
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cnpj_emp, identificador) DO UPDATE SET
            payload_json = excluded.payload_json,
            consultado_em = excluded.consultado_em
        """,
        (
            cnpj,
            identificador,
            json.dumps(
                documento.astype(object).where(
                    pd.notnull(documento),
                    None,
                ).to_dict(orient="records"),
                ensure_ascii=False,
                default=str,
            ),
            datetime.now().isoformat(timespec="seconds"),
        ),
    )
    conexao.commit()
    return documento


def classificar_compra_original(
    linha: pd.Series,
) -> tuple[bool, int, str]:
    operacao = normalizar_texto_custo(linha.get("operacao"))
    tipo_transacao = normalizar_texto_custo(
        linha.get("tipo_transacao")
    )
    natureza = normalizar_texto_custo(
        linha.get("natureza_operacao")
    )
    cfop = normalizar_texto_custo(linha.get("id_cfop"))
    desc_cfop = normalizar_texto_custo(linha.get("desc_cfop"))
    conjunto = f"{natureza} {desc_cfop} {cfop}"

    if valor_booleano_verdadeiro(linha.get("cancelado")):
        return False, 99, "CANCELADO"

    if valor_booleano_verdadeiro(linha.get("excluido")):
        return False, 99, "EXCLUIDO"

    eh_entrada = (
        operacao == "E"
        or operacao.startswith("E ")
        or "(E)" in operacao
        or "ENTRADA" in operacao
    )
    if not eh_entrada:
        return False, 99, "NAO_E_ENTRADA"

    termos_descartar = (
        "TRANSFER",
        "AJUSTE",
        "DEVOLU",
        "REMESSA",
        "CONSIGN",
        "BONIFICACAO",
    )
    if tipo_transacao in {"D", "T", "J"}:
        return False, 99, "TRANSFERENCIA_OU_AJUSTE"

    if any(termo in conjunto for termo in termos_descartar):
        return False, 99, "NATUREZA_NAO_E_COMPRA"

    termos_compra = (
        "COMPRA",
        "COMERCIALIZACAO",
        "REVENDA",
        "AQUISICAO",
        "IMPORTACAO",
        "MERCADORIA PARA REVENDA",
    )
    if any(termo in conjunto for termo in termos_compra):
        return True, 0, "COMPRA_EXPLICITA"

    cfop_numerico = re.sub(r"\D", "", cfop)
    if cfop_numerico.startswith(("1", "2", "3")):
        return True, 1, "COMPRA_POR_CFOP"

    return True, 2, "ENTRADA_NAO_CLASSIFICADA"


def extrair_custo_compra(
    linha: pd.Series,
) -> tuple[float, str]:
    preco_unitario = numero_api(linha.get("preco_unitario"))
    if preco_unitario > 0:
        return round(preco_unitario, 4), "preco_unitario"

    quantidade = abs(numero_api(linha.get("quantidade")))
    divisor = quantidade if quantidade > 0 else 1.0

    valor_total_unitario = (
        numero_api(linha.get("valor_total")) / divisor
    )
    if valor_total_unitario > 0:
        return round(valor_total_unitario, 4), "valor_total/quantidade"

    valor_liquido_unitario = (
        numero_api(linha.get("valor_liquido")) / divisor
    )
    if valor_liquido_unitario > 0:
        return (
            round(valor_liquido_unitario, 4),
            "valor_liquido/quantidade",
        )

    return 0.0, ""


def data_ordenacao_movimento(linha: pd.Series) -> pd.Timestamp:
    for campo in ("data_lancamento", "data_documento", "dt_insert"):
        valor = linha.get(campo)
        if valor is None or str(valor).strip() == "":
            continue
        convertido = pd.to_datetime(valor, errors="coerce")
        if not pd.isna(convertido):
            return convertido
    return pd.Timestamp.max


def resolver_custos_dos_movimentos(
    conexao: sqlite3.Connection,
    movimentos_serial: pd.DataFrame,
    produto_por_serial: dict[str, str],
) -> int:
    if movimentos_serial.empty:
        return 0

    candidatos_por_serial: dict[str, list[dict[str, Any]]] = {}
    chaves_documentos: dict[
        tuple[str, str, str, str, str],
        set[str],
    ] = {}

    for _, movimento in movimentos_serial.iterrows():
        serial = normalizar_serial(
            movimento.get("serial_normalizado")
            or movimento.get("serial")
        )
        cnpj = str(
            movimento.get("cnpj_consultado")
            or movimento.get("cnpj_emp")
            or ""
        ).strip()
        identificador = str(
            movimento.get("identificador") or ""
        ).strip()
        transacao = normalizar_codigo_produto(
            movimento.get("transacao")
        )
        data_inicial = str(
            movimento.get("janela_data_inicial") or ""
        )
        data_final = str(
            movimento.get("janela_data_final") or ""
        )

        if not serial or not cnpj or not identificador:
            continue

        chave = (
            cnpj,
            identificador,
            transacao,
            data_inicial,
            data_final,
        )
        chaves_documentos.setdefault(chave, set()).add(serial)

    total_documentos = len(chaves_documentos)

    for indice, (
        (
            cnpj,
            identificador,
            transacao,
            data_inicial,
            data_final,
        ),
        seriais,
    ) in enumerate(chaves_documentos.items()):
        log(
            f"      📄 Documento {indice + 1}/{total_documentos} "
            f"| {identificador}"
        )
        documento = obter_documento_movimento(
            conexao,
            cnpj,
            identificador,
            data_inicial,
            data_final,
        )

        if documento.empty:
            continue

        if "transacao" in documento.columns and transacao:
            transacoes = documento["transacao"].map(
                normalizar_codigo_produto
            )
            por_transacao = documento[transacoes == transacao].copy()
            if not por_transacao.empty:
                documento = por_transacao

        for serial in seriais:
            codigo_esperado = produto_por_serial.get(serial, "")
            linhas_serial = documento

            if codigo_esperado and "cod_produto" in documento.columns:
                codigos = documento["cod_produto"].map(
                    normalizar_codigo_produto
                )
                por_produto = documento[
                    codigos == codigo_esperado
                ].copy()
                if not por_produto.empty:
                    linhas_serial = por_produto

            for _, linha in linhas_serial.iterrows():
                valida, prioridade, tipo_candidato = (
                    classificar_compra_original(linha)
                )
                if not valida:
                    continue

                custo, campo_origem = extrair_custo_compra(linha)
                if custo <= 0:
                    continue

                candidatos_por_serial.setdefault(serial, []).append(
                    {
                        "serial": serial,
                        "codigo_produto": (
                            normalizar_codigo_produto(
                                linha.get("cod_produto")
                            )
                            or codigo_esperado
                        ),
                        "custo": custo,
                        "documento": str(
                            linha.get("documento") or ""
                        ).strip(),
                        "serie": str(
                            linha.get("serie") or ""
                        ).strip(),
                        "data_entrada": str(
                            linha.get("data_lancamento")
                            or linha.get("data_documento")
                            or ""
                        ).strip(),
                        "cnpj": cnpj,
                        "identificador": identificador,
                        "transacao": (
                            normalizar_codigo_produto(
                                linha.get("transacao")
                            )
                            or transacao
                        ),
                        "campo_origem": campo_origem,
                        "prioridade": prioridade,
                        "tipo_candidato": tipo_candidato,
                        "data_ordenacao": data_ordenacao_movimento(
                            linha
                        ),
                    }
                )

    agora = datetime.now().isoformat(timespec="seconds")
    registros = []

    for serial, candidatos in candidatos_por_serial.items():
        candidatos.sort(
            key=lambda item: (
                item["prioridade"],
                item["data_ordenacao"],
                item["documento"],
            )
        )
        escolhido = candidatos[0]
        registros.append(
            (
                serial,
                escolhido["codigo_produto"],
                escolhido["custo"],
                escolhido["documento"],
                escolhido["serie"],
                escolhido["data_entrada"],
                escolhido["cnpj"],
                escolhido["identificador"],
                escolhido["transacao"],
                (
                    f"{escolhido['campo_origem']}::"
                    f"{escolhido['tipo_candidato']}"
                ),
                agora,
            )
        )

    conexao.executemany(
        """
        INSERT INTO custo_imei (
            serial_normalizado,
            codigo_produto,
            custo_aquisicao,
            documento,
            serie,
            data_entrada,
            cnpj_compra,
            identificador,
            transacao,
            campo_origem,
            atualizado_em
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(serial_normalizado) DO UPDATE SET
            codigo_produto = excluded.codigo_produto,
            custo_aquisicao = excluded.custo_aquisicao,
            documento = excluded.documento,
            serie = excluded.serie,
            data_entrada = excluded.data_entrada,
            cnpj_compra = excluded.cnpj_compra,
            identificador = excluded.identificador,
            transacao = excluded.transacao,
            campo_origem = excluded.campo_origem,
            atualizado_em = excluded.atualizado_em
        """,
        registros,
    )
    conexao.commit()
    return len(registros)


def salvar_auditoria_custos_imei(
    df_seriais: pd.DataFrame,
    mapa_custos: dict[str, dict[str, Any]],
) -> None:
    if df_seriais.empty:
        return

    linhas = []

    for _, item in df_seriais.iterrows():
        serial = normalizar_serial(item.get("serial"))
        if not serial:
            continue

        custo = mapa_custos.get(serial)
        linhas.append(
            {
                "CNPJ_ORIGEM": str(
                    item.get("CNPJ_ORIGEM") or item.get("cnpj_emp") or ""
                ),
                "CODIGO_PRODUTO": normalizar_codigo_produto(
                    item.get("codigoproduto")
                    or item.get("cod_produto")
                ),
                "SERIAL": serial,
                "CUSTO_SERIAL_ENTRADA": (
                    numero_api(custo.get("custo_aquisicao"))
                    if custo
                    else 0.0
                ),
                "STATUS_CUSTO": (
                    "CUSTO_EXATO_ENCONTRADO"
                    if custo
                    else "CUSTO_NAO_ENCONTRADO"
                ),
                "CAMPO_ORIGEM": (
                    str(custo.get("campo_origem") or "")
                    if custo
                    else ""
                ),
                "DOCUMENTO_ENTRADA": (
                    str(custo.get("documento") or "")
                    if custo
                    else ""
                ),
                "SERIE_ENTRADA": (
                    str(custo.get("serie") or "")
                    if custo
                    else ""
                ),
                "DATA_ENTRADA": (
                    str(custo.get("data_entrada") or "")
                    if custo
                    else ""
                ),
                "CNPJ_COMPRA": (
                    str(custo.get("cnpj_compra") or "")
                    if custo
                    else ""
                ),
            }
        )

    auditoria = pd.DataFrame(linhas)
    if auditoria.empty:
        return

    auditoria = auditoria.drop_duplicates(
        subset=["SERIAL"],
        keep="last",
    ).sort_values(
        by=["STATUS_CUSTO", "CODIGO_PRODUTO", "SERIAL"],
        kind="stable",
    )
    CUSTO_IMEI_AUDITORIA.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    auditoria.to_csv(
        CUSTO_IMEI_AUDITORIA,
        index=False,
        encoding="utf-8-sig",
    )


def obter_mapa_custos_imei(
    df_seriais: pd.DataFrame,
) -> dict[str, dict[str, Any]]:
    if df_seriais.empty or "serial" not in df_seriais.columns:
        return {}

    seriais_atuais = {
        normalizar_serial(serial)
        for serial in df_seriais["serial"].tolist()
        if normalizar_serial(serial)
    }

    if not seriais_atuais:
        return {}

    produto_por_serial: dict[str, str] = {}
    for _, linha in df_seriais.iterrows():
        serial = normalizar_serial(linha.get("serial"))
        if not serial:
            continue
        produto_por_serial[serial] = normalizar_codigo_produto(
            linha.get("codigoproduto")
            or linha.get("cod_produto")
        )

    conexao = inicializar_cache_custos()

    try:
        importar_caches_legados(conexao)
        importar_mapas_csv(conexao)

        mapa = buscar_custos_no_cache(
            conexao,
            seriais_atuais,
        )
        faltantes = seriais_atuais - set(mapa)

        log(
            f"💰 Custos por IMEI no cache: {len(mapa)}/"
            f"{len(seriais_atuais)}"
        )

        if faltantes and CUSTO_IMEI_ATUALIZAR_API:
            for data_inicial, data_final in gerar_janelas_historicas():
                if not faltantes:
                    break

                log(
                    f"🔄 Procurando {len(faltantes)} IMEIs sem custo "
                    f"entre {data_inicial} e {data_final}..."
                )
                movimentos = buscar_movimentos_seriais_janela(
                    faltantes,
                    data_inicial,
                    data_final,
                )
                resolvidos = resolver_custos_dos_movimentos(
                    conexao,
                    movimentos,
                    produto_por_serial,
                )

                mapa = buscar_custos_no_cache(
                    conexao,
                    seriais_atuais,
                )
                faltantes = seriais_atuais - set(mapa)

                log(
                    f"   ✅ Novos custos resolvidos: {resolvidos} "
                    f"| ainda faltam: {len(faltantes)}"
                )

        salvar_auditoria_custos_imei(
            df_seriais,
            mapa,
        )

        percentual = (
            (len(mapa) / len(seriais_atuais)) * 100
            if seriais_atuais
            else 100.0
        )
        log(
            f"📊 Cobertura de custo serial: "
            f"{len(mapa)}/{len(seriais_atuais)} "
            f"({percentual:.2f}%)"
        )

        if faltantes:
            log(
                f"⚠️ {len(faltantes)} IMEIs continuam sem a nota "
                f"original. Eles ficarão sinalizados na auditoria e "
                f"usarão o fallback do sistema."
            )
            log(f"📄 Auditoria: {CUSTO_IMEI_AUDITORIA}")

        return mapa
    finally:
        conexao.close()


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
# 2. EXTRAÇÃO DE ESTOQUE AGREGADO
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
            except:
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
            except:
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

def extrair_estoque(cnpj, modo_completo=False):
    """
    modo_completo=False -> modo principal e mais seguro:
                           busca por movimentação no período
    modo_completo=True  -> tenta carga completa com retornar_saldo_zero=1
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
                # Nesta versão do LinxProdutosDetalhes as datas continuam
                # obrigatórias mesmo com retornar_saldo_zero=1. O histórico
                # amplo é necessário para alcançar AMOSTRA/DOA sem
                # movimentação recente.
                "data_mov_ini": iso(CUSTO_IMEI_DATA_MINIMA),
                "data_mov_fim": iso(hoje),
                "timestamp": str(ts),
                "retornar_saldo_zero": "1"
            }

            df = chamar_api_detalhes(params)
            if df.empty:
                break

            df.columns = [c.lower() for c in df.columns]
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

            df.columns = [c.lower() for c in df.columns]
            dfs.append(df)

            novo_ts = obter_proximo_timestamp(df, ts)
            if novo_ts is None:
                break

            ts = novo_ts
            time.sleep(TEMPO_ESPERA_API)

        # fallback automático pro modo completo
        if not dfs:
            log(f"   🔁 Sem retorno por movimentação para {LOJAS_NOME.get(cnpj, cnpj)}. Tentando modo completo...")
            return extrair_estoque(cnpj, modo_completo=True)

    if not dfs:
        return pd.DataFrame()

    base = pd.concat(dfs, ignore_index=True)

    if "timestamp" in base.columns:
        base["timestamp"] = pd.to_numeric(base["timestamp"], errors="coerce")
        base = base.sort_values("timestamp", ascending=False)

    if "cod_produto" in base.columns:
        base["cod_produto"] = pd.to_numeric(base["cod_produto"], errors="coerce")

    # Mantém uma linha por produto e tipo de estoque. Sem o tipo na chave,
    # ESTOQUE, AMOSTRA e DOA poderiam ser misturados ou sobrescritos.
    base["TIPO_ESTOQUE"] = base.apply(identificar_tipo_estoque_linha, axis=1)
    base = base.drop_duplicates(subset=["cod_produto", "TIPO_ESTOQUE"], keep="first")
    base["CNPJ_ORIGEM"] = cnpj
    base["NOME_FANTASIA"] = LOJAS_NOME.get(cnpj, f"LOJA {cnpj[-4:]}")
    base.rename(columns={
        "cod_produto": "CODIGO_PRODUTO",
        "quantidade": "QUANTIDADE",
        "preco_custo": "PRECO_CUSTO",
        "preco_venda": "PRECO_VENDA",
        "custo_medio": "CUSTO_MEDIO"
    }, inplace=True)

    tipos_encontrados = base["TIPO_ESTOQUE"].value_counts().to_dict() if "TIPO_ESTOQUE" in base.columns else {}
    log(f"   ✅ {LOJAS_NOME.get(cnpj, cnpj)}: {len(base)} registros | tipos: {tipos_encontrados}")
    return base


def extrair_saldos_depositos(cnpj):
    """
    Extrai os saldos dos depósitos 1 (ESTOQUE), 2 (DOA) e 4 (AMOSTRAS).

    Esta é a fonte oficial das quantidades por depósito. Os preços continuam
    vindo de LinxProdutosDetalhes e são unidos posteriormente.
    """
    partes = []

    for tipo_estoque in ("ESTOQUE", "DOA", "AMOSTRA"):
        codigo_deposito = DEPOSITOS_POR_TIPO[tipo_estoque]
        paginas = []
        ts = 0

        while True:
            pagina = chamar_api_metodo(
                "LinxProdutosDetalhesDepositos",
                {
                    "cnpjEmp": cnpj,
                    "cod_deposito": codigo_deposito,
                    "timestamp": str(ts),
                },
            )

            if pagina.empty:
                break

            proximo_ts = obter_proximo_timestamp(pagina, ts)
            paginas.append(pagina)

            if proximo_ts is None:
                break

            ts = proximo_ts
            time.sleep(TEMPO_ESPERA_API)

        if not paginas:
            continue

        base = pd.concat(
            paginas,
            ignore_index=True,
            sort=False,
        )

        if "timestamp" in base.columns:
            base["timestamp_numero"] = pd.to_numeric(
                base["timestamp"],
                errors="coerce",
            )
            base = base.sort_values(
                "timestamp_numero",
                ascending=False,
            )

        if "cod_produto" not in base.columns:
            log(
                f"⚠️ Depósito {codigo_deposito} de "
                f"{LOJAS_NOME.get(cnpj, cnpj)} sem cod_produto."
            )
            continue

        base["cod_produto"] = pd.to_numeric(
            base["cod_produto"],
            errors="coerce",
        )
        base["saldo_numero"] = to_float(
            base.get("saldo", 0)
        )

        if "cod_deposito" in base.columns:
            base = base[
                base["cod_deposito"].map(
                    normalizar_codigo_produto
                )
                == codigo_deposito
            ].copy()

        base = base.drop_duplicates(
            subset=["cod_produto"],
            keep="first",
        )
        base = base[base["saldo_numero"] > 0].copy()

        if base.empty:
            continue

        especial = pd.DataFrame(
            {
                "CNPJ_ORIGEM": cnpj,
                "NOME_FANTASIA": LOJAS_NOME.get(
                    cnpj,
                    f"LOJA {cnpj[-4:]}",
                ),
                "CODIGO_PRODUTO": base["cod_produto"],
                "QUANTIDADE": base["saldo_numero"],
                "PRECO_CUSTO": 0.0,
                "PRECO_VENDA": 0.0,
                "CUSTO_MEDIO": 0.0,
                "TIPO_ESTOQUE": tipo_estoque,
                "COD_DEPOSITO": codigo_deposito,
            }
        )
        partes.append(especial)

        log(
            f"   ✅ {LOJAS_NOME.get(cnpj, cnpj)} | "
            f"{tipo_estoque}: "
            f"{especial['QUANTIDADE'].sum():.0f} un."
        )

    if not partes:
        return pd.DataFrame()

    return pd.concat(
        partes,
        ignore_index=True,
        sort=False,
    )


def aplicar_precos_nos_saldos(
    saldos: pd.DataFrame,
    detalhes: pd.DataFrame,
) -> pd.DataFrame:
    if saldos.empty:
        return saldos

    resultado = saldos.copy()
    colunas_preco = [
        "PRECO_CUSTO",
        "PRECO_VENDA",
        "CUSTO_MEDIO",
    ]

    if not detalhes.empty and "CODIGO_PRODUTO" in detalhes.columns:
        precos = detalhes.copy()
        precos["CODIGO_PRODUTO"] = pd.to_numeric(
            precos["CODIGO_PRODUTO"],
            errors="coerce",
        )

        for coluna in colunas_preco:
            if coluna not in precos.columns:
                precos[coluna] = 0.0

        precos = precos[
            ["CODIGO_PRODUTO", *colunas_preco]
        ].drop_duplicates(
            subset=["CODIGO_PRODUTO"],
            keep="first",
        )

        resultado = resultado.drop(
            columns=colunas_preco,
            errors="ignore",
        ).merge(
            precos,
            on="CODIGO_PRODUTO",
            how="left",
        )

    for coluna in colunas_preco:
        if coluna not in resultado.columns:
            resultado[coluna] = 0.0
        else:
            # Pandas 3/Python 3.14 mantém os valores da API como dtype
            # string e não permite atribuir 0.0 em parte dessa coluna.
            # Convertemos a coluna inteira antes de zerar AMOSTRA/DOA.
            resultado[coluna] = (
                resultado[coluna]
                .map(numero_api)
                .astype(float)
            )

    # AMOSTRA e DOA nunca compõem custo ou cálculos operacionais.
    especiais = resultado["TIPO_ESTOQUE"].isin(
        ["AMOSTRA", "DOA"]
    )
    for coluna in colunas_preco:
        resultado[coluna] = resultado[coluna].mask(
            especiais,
            0.0,
        )

    return resultado

# ===========================================
# 3. EXTRAÇÃO DE SERIAIS (IMEI) - NOVIDADE!
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
            return pd.DataFrame()
        root = etree.fromstring(r.content)
        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except:
        return pd.DataFrame()

def extrair_seriais_loja(cnpj):
    dfs = []
    ts = 0
    while True:
        params = {
            "cnpjEmp": cnpj,
            "timestamp": str(ts),
            "depositos": ",".join(
                DEPOSITOS_POR_TIPO.values()
            ),
        }
        df = chamar_api_seriais(params)
        if df.empty:
            break
        df.columns = [c.lower() for c in df.columns]

        # Calcula a próxima página antes do filtro de saldo. Caso uma página
        # contenha apenas seriais inativos, a paginação não pode ser encerrada.
        novo_ts = obter_proximo_timestamp(df, ts)

        # Filtra apenas IMEIs que estão efetivamente em estoque (saldo = True ou 1)
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

    base = base.drop_duplicates(subset=["serial"], keep="first")  # Garante 1 registro por IMEI
    base["CNPJ_ORIGEM"] = cnpj

    if "id_deposito" in base.columns:
        base["id_deposito_normalizado"] = base[
            "id_deposito"
        ].map(normalizar_codigo_produto)
    else:
        # Compatibilidade com respostas antigas que não informavam depósito.
        base["id_deposito_normalizado"] = DEPOSITOS_POR_TIPO[
            "ESTOQUE"
        ]

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
    log("🚀 Iniciando Sincronização v10.3.1 (CUSTO POR IMEI + DEPÓSITOS)...")

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

        # LinxProdutosDetalhes fornece os preços dos produtos, mas não é a
        # fonte correta para separar as quantidades por depósito.
        df_detalhes = extrair_estoque(
            cnpj,
            modo_completo=False,
        )

        # As quantidades oficiais vêm separadas dos depósitos:
        # 1 = ESTOQUE, 2 = DOA e 4 = AMOSTRA.
        df_saldos = extrair_saldos_depositos(cnpj)
        df_saldos = aplicar_precos_nos_saldos(
            df_saldos,
            df_detalhes,
        )
        if not df_saldos.empty:
            todos_dados.append(df_saldos)

        # Puxa os IMEIs dos depósitos 1, 2 e 4.
        df_ser = extrair_seriais_loja(cnpj)
        if not df_ser.empty:
            todos_seriais.append(df_ser)

    if not todos_dados:
        log("❌ Nenhum estoque encontrado.")
        return

    df_estoque = pd.concat(todos_dados, ignore_index=True)
    df_seriais = (
        pd.concat(
            todos_seriais,
            ignore_index=True,
        )
        if todos_seriais
        else pd.DataFrame(
            columns=[
                "CNPJ_ORIGEM",
                "codigoproduto",
                "serial",
                "id_deposito_normalizado",
            ]
        )
    )

    if "id_deposito_normalizado" not in df_seriais.columns:
        df_seriais["id_deposito_normalizado"] = (
            DEPOSITOS_POR_TIPO["ESTOQUE"]
        )

    # 3. Resolve o preço real da compra somente dos IMEIs do estoque normal.
    # AMOSTRA e DOA não compõem o custo operacional.
    # A consulta usa primeiro os caches históricos existentes e só chama
    # LinxMovimentoSerial/LinxMovimento para os IMEIs ainda não resolvidos.
    df_seriais_normais = df_seriais[
        df_seriais["id_deposito_normalizado"]
        == DEPOSITOS_POR_TIPO["ESTOQUE"]
    ].copy()
    log("💰 Resolvendo CUSTO_SERIAL_ENTRADA dos IMEIs atuais...")
    mapa_custos_imei = obter_mapa_custos_imei(
        df_seriais_normais
    )

    # 4. Cruzamento Estoque x Catálogo
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

    # Os saldos já chegam em linhas separadas por depósito. Não use a
    # expansão por colunas aqui, pois ela poderia duplicar quantidades.

    # 5. A MÁGICA: DESDOBRAMENTO POR IMEI + CUSTO DA COMPRA ORIGINAL
    log("🔍 Desdobrando itens com IMEI...")
    linhas_expandidas = []

    for _, row in df_estoque.iterrows():
        cnpj = row["CNPJ_ORIGEM"]
        cod = row["CODIGO_PRODUTO"]
        qtd_total = float(row["QUANTIDADE"])

        tipo_estoque = normalizar_tipo_estoque(row.get("TIPO_ESTOQUE", "ESTOQUE"))

        codigo_deposito = DEPOSITOS_POR_TIPO[tipo_estoque]
        seriais_produto = df_seriais[
            (df_seriais["CNPJ_ORIGEM"] == cnpj) &
            (df_seriais["codigoproduto"] == cod) &
            (
                df_seriais["id_deposito_normalizado"]
                == codigo_deposito
            )
        ]["serial"].tolist()

        # ✅ NOVO: limpa, deduplica e evita serial vazio
        seriais_produto = list(dict.fromkeys(
            [str(s).strip() for s in seriais_produto if str(s).strip()]
        ))

        if len(seriais_produto) > 0 and qtd_total > 0:
            # ✅ NOVO: limita o número de seriais ao saldo da API, para não inflar quantidade
            qtd_serializada = min(len(seriais_produto), int(qtd_total))

            if len(seriais_produto) > int(qtd_total):
                log(
                    "⚠️ Divergência de serial x saldo "
                    f"| Loja: {row['NOME_FANTASIA']} "
                    f"| Produto: {cod} "
                    f"| Tipo: {tipo_estoque} "
                    f"| Saldo API: {qtd_total} "
                    f"| Seriais: {len(seriais_produto)}"
                )

            # Aparelho com IMEI encontrado! Quebra em 1 linha para cada IMEI válido até o saldo da API
            for s in seriais_produto[:qtd_serializada]:
                serial_normalizado = normalizar_serial(s)
                dados_custo = (
                    mapa_custos_imei.get(serial_normalizado)
                    if tipo_estoque == "ESTOQUE"
                    else None
                )
                custo_serial = (
                    numero_api(
                        dados_custo.get("custo_aquisicao")
                    )
                    if dados_custo
                    else 0.0
                )

                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = 1.0  # Cada IMEI é 1 unidade
                nova_linha["SERIAL"] = s
                nova_linha["CUSTO_SERIAL_ENTRADA"] = custo_serial
                if tipo_estoque == "ESTOQUE":
                    nova_linha["CUSTO_SERIAL_STATUS"] = (
                        "CUSTO_EXATO_ENCONTRADO"
                        if custo_serial > 0
                        else "CUSTO_NAO_ENCONTRADO"
                    )
                else:
                    nova_linha["CUSTO_SERIAL_STATUS"] = (
                        "NAO_APLICAVEL"
                    )
                nova_linha["CUSTO_SERIAL_ORIGEM"] = (
                    str(
                        dados_custo.get("campo_origem")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                nova_linha["DOCUMENTO_COMPRA"] = (
                    str(
                        dados_custo.get("documento")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                nova_linha["CNPJ_COMPRA"] = (
                    str(
                        dados_custo.get("cnpj_compra")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                nova_linha["IDENTIFICADOR_COMPRA"] = (
                    str(
                        dados_custo.get("identificador")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                nova_linha["TRANSACAO_COMPRA"] = (
                    str(
                        dados_custo.get("transacao")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                nova_linha["DATA_COMPRA"] = (
                    str(
                        dados_custo.get("data_entrada")
                        or ""
                    )
                    if dados_custo
                    else ""
                )
                linhas_expandidas.append(nova_linha)

            # Se o sistema diz que tem 5, mas só achou 4 IMEIs, cria uma linha pro restante
            qtd_restante = max(qtd_total - qtd_serializada, 0)
            if qtd_restante > 0:
                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = qtd_restante
                nova_linha["SERIAL"] = ""
                nova_linha["CUSTO_SERIAL_ENTRADA"] = 0.0
                nova_linha["CUSTO_SERIAL_STATUS"] = (
                    "SEM_IMEI"
                    if tipo_estoque == "ESTOQUE"
                    else "NAO_APLICAVEL"
                )
                nova_linha["CUSTO_SERIAL_ORIGEM"] = ""
                nova_linha["DOCUMENTO_COMPRA"] = ""
                nova_linha["CNPJ_COMPRA"] = ""
                nova_linha["IDENTIFICADOR_COMPRA"] = ""
                nova_linha["TRANSACAO_COMPRA"] = ""
                nova_linha["DATA_COMPRA"] = ""
                linhas_expandidas.append(nova_linha)
        else:
            # Acessórios (ou itens sem IMEI) ficam na mesma linha somada
            nova_linha = row.copy()
            nova_linha["SERIAL"] = ""
            nova_linha["CUSTO_SERIAL_ENTRADA"] = 0.0
            nova_linha["CUSTO_SERIAL_STATUS"] = (
                "SEM_IMEI"
                if tipo_estoque == "ESTOQUE"
                else "NAO_APLICAVEL"
            )
            nova_linha["CUSTO_SERIAL_ORIGEM"] = ""
            nova_linha["DOCUMENTO_COMPRA"] = ""
            nova_linha["CNPJ_COMPRA"] = ""
            nova_linha["IDENTIFICADOR_COMPRA"] = ""
            nova_linha["TRANSACAO_COMPRA"] = ""
            nova_linha["DATA_COMPRA"] = ""
            linhas_expandidas.append(nova_linha)

    df_final = pd.DataFrame(linhas_expandidas)

    df_final["CUSTO_SERIAL_ENTRADA"] = to_float(
        df_final.get("CUSTO_SERIAL_ENTRADA", 0)
    )

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

    # Segurança: como o primeiro lote substitui o estoque existente, não
    # permitimos o envio quando a extração completa deixou de trazer os
    # depósitos especiais. Isso evita zerar AMOSTRA/DOA silenciosamente.
    tipos_especiais_ausentes = [
        tipo
        for tipo in ("AMOSTRA", "DOA")
        if float(resumo_tipos.get(tipo, 0) or 0) <= 0
    ]
    if tipos_especiais_ausentes:
        log(
            "❌ ENVIO CANCELADO: a API não retornou saldo para "
            + ", ".join(tipos_especiais_ausentes)
            + "."
        )
        log(
            "👉 O estoque atual foi preservado. Verifique a extração "
            "completa dos depósitos antes de tentar novamente."
        )
        return 1

    linhas_com_imei = df_final[
        (
            df_final["TIPO_ESTOQUE"] == "ESTOQUE"
        )
        & df_final["SERIAL"]
        .fillna("")
        .astype(str)
        .str.strip()
        .ne("")
    ]
    linhas_com_custo_exato = linhas_com_imei[
        linhas_com_imei["CUSTO_SERIAL_ENTRADA"] > 0
    ]
    valor_custo_serial = float(
        (
            linhas_com_custo_exato["QUANTIDADE"]
            * linhas_com_custo_exato["CUSTO_SERIAL_ENTRADA"]
        ).sum()
    )
    log(
        f"💰 IMEIs enviados com custo exato: "
        f"{len(linhas_com_custo_exato)}/{len(linhas_com_imei)} "
        f"| total serial: R$ {valor_custo_serial:,.2f}"
    )

    # 6. SALVAMENTO DIRETO
    log("💾 Disparando dados com IMEIs para a API da Produção...")
    sucesso = enviar_para_api(df_final)

    if not sucesso:
        log("❌ Sincronização não concluída. O estoque não foi totalmente enviado.")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
