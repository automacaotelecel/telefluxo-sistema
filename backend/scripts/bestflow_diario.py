import os
import re
import sys
import time
from datetime import date, datetime
import xml.etree.ElementTree as ET

import pandas as pd
import requests
from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context
from zeep import Client
from zeep.transports import Transport

# ============================================================
# BESTFLOW -> TELEFLUXO (SINCRONIZAÇÃO DIÁRIA)
# Arquivo único: consulta o mês atual, filtra vazamentos do mês
# anterior, consolida por CNPJ/data e envia ao backend.
# Não cria .db, .xml, .xlsx ou arquivos auxiliares.
# ============================================================

WSDL_URL = "https://www.bestflowserver.com.br/samsung/service/soap/bestflow.php?wsdl"
DS_LOGIN = os.getenv("BESTFLOW_LOGIN", "mrf.ws")
DS_SENHA = os.getenv("BESTFLOW_SENHA", "424DAsp2LZ@c")

API_BESTFLOW_SYNC_URL = os.getenv(
    "BESTFLOW_SYNC_URL",
    "https://telefluxo-aplicacao.onrender.com/api/sync/bestflow",
)

TIMEOUT = int(os.getenv("BESTFLOW_TIMEOUT", "90"))
BATCH_SIZE = max(20, int(os.getenv("BESTFLOW_BATCH_SIZE", "200")))
MAX_RETRIES = max(1, int(os.getenv("BESTFLOW_MAX_RETRIES", "5")))

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


class LegacySSLAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        ctx = create_urllib3_context()
        ctx.load_default_certs()
        try:
            ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        except Exception:
            pass
        pool_kwargs["ssl_context"] = ctx
        return super().init_poolmanager(connections, maxsize, block, **pool_kwargs)


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def digits_only(value) -> str:
    return re.sub(r"\D+", "", "" if value is None else str(value))


def parse_any_datetime(value):
    if value is None or value == "":
        return pd.NaT

    text = str(value).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            pass

    return pd.to_datetime(text, errors="coerce", dayfirst=True)


def periodo_mes_atual():
    hoje = date.today()
    inicio = date(hoje.year, hoje.month, 1)
    return inicio, hoje


def periodo_mes_atual_ptbr():
    inicio, fim = periodo_mes_atual()
    return inicio.strftime("%d/%m/%Y"), fim.strftime("%d/%m/%Y")


def fetch_xml(dt_ini: str, dt_fim: str) -> str:
    session = Session()
    session.mount("https://", LegacySSLAdapter())
    transport = Transport(session=session, timeout=TIMEOUT, operation_timeout=TIMEOUT)
    client = Client(WSDL_URL, transport=transport)
    return str(client.service.obterContagem(DS_LOGIN, DS_SENHA, dt_ini, dt_fim) or "")


def parse_contagem(xml_text: str) -> pd.DataFrame:
    xml_text = (xml_text or "").strip()
    if not xml_text:
        return pd.DataFrame()

    root = ET.fromstring(xml_text)
    rows = []

    for contagem in root.findall(".//CONTAGEM"):
        row = {}
        for key, value in contagem.attrib.items():
            row[str(key).strip().lower()] = (value or "").strip()
        for child in list(contagem):
            row[str(child.tag or "").strip().lower()] = (child.text or "").strip()
        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["entradas"] = pd.to_numeric(df.get("entradas", 0), errors="coerce").fillna(0).astype(int)
    df["saidas"] = pd.to_numeric(df.get("saidas", 0), errors="coerce").fillna(0).astype(int)

    id_col = "idloja" if "idloja" in df.columns else None
    if not id_col:
        for column in df.columns:
            lowered = column.lower()
            if "idloja" in lowered or "cnpj" in lowered:
                id_col = column
                break

    if not id_col:
        raise ValueError("Não encontrei a coluna de CNPJ/ID da loja no retorno BestFlow.")

    df["cnpj14"] = df[id_col].apply(digits_only).str[:14]
    df["loja"] = df["cnpj14"].map(LOJAS_MAP)

    if "nome_loja" in df.columns:
        df["loja"] = df["loja"].fillna(df["nome_loja"].astype(str).str.strip())
    else:
        df["loja"] = df["loja"].fillna("")

    preferred_datetime_columns = [
        "dataehora_inicio",
        "datahora_inicio",
        "data_hora_inicio",
    ]
    dt_col = next((column for column in preferred_datetime_columns if column in df.columns), None)

    if dt_col is None:
        for column in df.columns:
            if "inicio" in column.lower():
                dt_col = column
                break

    if dt_col is None:
        dt_col = "dataliberacaofluxo" if "dataliberacaofluxo" in df.columns else None

    if dt_col is None:
        raise ValueError("Não encontrei a data/hora do fluxo no retorno BestFlow.")

    df["_dt"] = df[dt_col].apply(parse_any_datetime)
    df = df[df["_dt"].notna()].copy()
    df["data"] = pd.to_datetime(df["_dt"], errors="coerce").dt.strftime("%Y-%m-%d")

    return df


def filtrar_mes_corrente(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    inicio, fim = periodo_mes_atual()
    result = df[(df["data"] >= inicio.isoformat()) & (df["data"] <= fim.isoformat())].copy()
    return result.reset_index(drop=True)


def resumo_diario(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["data", "cnpj14", "loja", "entradas", "saidas"])

    valid = df[(df["cnpj14"].str.len() == 14) & (df["data"].notna())].copy()

    return (
        valid.groupby(["data", "cnpj14", "loja"], as_index=False)[["entradas", "saidas"]]
        .sum()
        .sort_values(["data", "loja"])
        .reset_index(drop=True)
    )


def limpar_valor_json(value):
    if value is None:
        return None
    if isinstance(value, float):
        if pd.isna(value) or value in (float("inf"), float("-inf")):
            return None
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def preparar_payload(summary: pd.DataFrame):
    records = []
    for row in summary.to_dict(orient="records"):
        clean = {key: limpar_valor_json(value) for key, value in row.items()}
        clean["cnpj14"] = digits_only(clean.get("cnpj14"))[:14]
        clean["loja"] = LOJAS_MAP.get(clean["cnpj14"], str(clean.get("loja") or "").strip())
        clean["entradas"] = int(clean.get("entradas") or 0)
        clean["saidas"] = int(clean.get("saidas") or 0)
        records.append(clean)
    return records


def enviar_para_backend(summary: pd.DataFrame) -> bool:
    records = preparar_payload(summary)
    if not records:
        log("Nenhum registro válido para enviar ao TeleFluxo.")
        return False

    total_batches = (len(records) + BATCH_SIZE - 1) // BATCH_SIZE
    log(f"Enviando {len(records)} lojas-dia em {total_batches} lote(s) para o TeleFluxo...")

    headers = {"Content-Type": "application/json"}

    for offset in range(0, len(records), BATCH_SIZE):
        batch = records[offset : offset + BATCH_SIZE]
        batch_number = (offset // BATCH_SIZE) + 1
        reset = "true" if offset == 0 else "false"
        url = f"{API_BESTFLOW_SYNC_URL}?reset={reset}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(url, json=batch, headers=headers, timeout=TIMEOUT)
                if 200 <= response.status_code < 300:
                    try:
                        result = response.json()
                        log(
                            f"Lote {batch_number}/{total_batches} recebido "
                            f"| gravados: {result.get('gravados', len(batch))}"
                        )
                    except Exception:
                        log(f"Lote {batch_number}/{total_batches} recebido.")
                    break

                log(
                    f"Lote {batch_number}/{total_batches} falhou "
                    f"({response.status_code}) - tentativa {attempt}/{MAX_RETRIES}: "
                    f"{(response.text or '')[:400]}"
                )
            except Exception as exc:
                log(
                    f"Falha de rede no lote {batch_number}/{total_batches} "
                    f"- tentativa {attempt}/{MAX_RETRIES}: {exc}"
                )

            if attempt < MAX_RETRIES:
                time.sleep(min(2 * attempt, 8))
        else:
            log(f"Não foi possível enviar o lote {batch_number}.")
            return False

    log("BestFlow sincronizado com o TeleFluxo.")
    return True


def main() -> int:
    dt_ini, dt_fim = periodo_mes_atual_ptbr()
    inicio, fim = periodo_mes_atual()

    log("Iniciando sincronização BestFlow -> TeleFluxo")
    log(f"Período: {dt_ini} até {dt_fim}")

    try:
        xml_text = fetch_xml(dt_ini, dt_fim)
    except Exception as exc:
        log(f"Erro ao consultar a API BestFlow: {exc}")
        return 1

    if "<CONTAGEM" not in (xml_text or ""):
        log("A API não devolveu registros <CONTAGEM>. Nada foi alterado no TeleFluxo.")
        return 1

    try:
        raw = parse_contagem(xml_text)
        current_month = filtrar_mes_corrente(raw)
        daily = resumo_diario(current_month)
    except Exception as exc:
        log(f"Erro ao interpretar os dados BestFlow: {exc}")
        return 1

    removed = max(0, len(raw) - len(current_month))
    if removed:
        log(f"{removed} registro(s) fora do mês atual foram descartados.")

    if daily.empty:
        log("Nenhum dado válido do mês atual. Nada foi alterado no TeleFluxo.")
        return 1

    log(
        f"Dados prontos: {daily['data'].nunique()} dia(s), "
        f"{daily['cnpj14'].nunique()} loja(s), {len(daily)} linhas consolidadas."
    )

    if not enviar_para_backend(daily):
        return 1

    log(f"Concluído. Sincronizado de {inicio.isoformat()} até {fim.isoformat()}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
