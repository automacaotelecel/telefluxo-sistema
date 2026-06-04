import json
import os
import sys
import traceback
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests


SHEET_BASE_CANDIDATES = ["BASE TRATADA"]
SHEET_EXTRATO_CANDIDATES = ["EXTRATO BANCARIO", "EXTRATO_BANCARIO"]

HOLIDAY_API_URL = "https://date.nager.at/api/v3/PublicHolidays/{year}/BR"
REQUEST_TIMEOUT = 20
HOLIDAY_CACHE_FILENAME = "feriados_cache_br.json"

ADDITIONAL_MANUAL_HOLIDAYS: List[str] = []
EXTRATO_ONLY_POSITIVE_VALUES = True

MAX_DETALHES_POR_DIA = 30
MAX_DESCARTADAS_RETORNO = 200


BASE_COL_ALIASES = {
    "data_venda": ["data de venda", "data da venda", "data_venda", "data venda"],
    "valor_liquido": [
        "valor liquido",
        "valor líquido",
        "valor_liq",
        "vlr liquido",
        "vlr líquido",
        "vlr liq",
    ],
    "valor_parcela": [
        "vlr parcela",
        "valor parcela",
        "valor da parcela",
        "vlr_parcela",
        "parcela liquida",
        "parcela líquida",
    ],
    "produto": ["produto", "tipo", "modalidade"],
    "parcelas": [
        "n de parcelas",
        "n parcelas",
        "parcelas",
        "numero de parcelas",
        "nro parcelas",
        "qtde parcelas",
    ],
    "documento": ["documento", "doc", "numero documento", "n documento"],
    "bandeira": ["bandeira", "cartao", "cartão", "bandeira cartao", "bandeira cartão"],
}

EXTRATO_COL_ALIASES = {
    "data_extrato": [
        "data",
        "data extrato",
        "data lancamento",
        "data lançamento",
        "data do credito",
        "data do crédito",
        "data recebimento",
        "data pagamento",
        "data movimento",
        "data movimentacao",
        "data movimentação",
    ],
    "valor_extrato": [
        "valor",
        "valor recebido",
        "valor credito",
        "valor crédito",
        "credito",
        "crédito",
        "entrada",
        "deposito",
        "depósito",
        "valor lancamento",
        "valor lançamento",
        "valor do credito",
        "valor do crédito",
        "valor liquido",
        "valor líquido",
    ],
    "credito_extrato": [
        "credito",
        "crédito",
        "entrada",
        "valor credito",
        "valor crédito",
        "deposito",
        "depósito",
    ],
    "debito_extrato": [
        "debito",
        "débito",
        "saida",
        "saída",
        "valor debito",
        "valor débito",
    ],
    "descricao": [
        "descricao",
        "descrição",
        "historico",
        "histórico",
        "detalhe",
        "complemento",
    ],
}

WEEKDAY_PT = {
    0: "Segunda-Feira",
    1: "Terça-Feira",
    2: "Quarta-Feira",
    3: "Quinta-Feira",
    4: "Sexta-Feira",
    5: "Sábado",
    6: "Domingo",
}


def log(message: str) -> None:
    print(str(message), file=sys.stderr, flush=True)


def normalize_text(text: Any) -> str:
    if text is None:
        return ""

    text = str(text).strip().upper()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    for token in ["_", "-", "/", "\\", ".", "(", ")", "[", "]", ":"]:
        text = text.replace(token, " ")

    while "  " in text:
        text = text.replace("  ", " ")

    return text.strip()


def get_engine(path: Path) -> Optional[str]:
    if path.suffix.lower() == ".xlsb":
        return "pyxlsb"
    return None


def get_cache_dir() -> Path:
    cache_dir = Path(os.getenv("STONE_CACHE_DIR", "/tmp/telefluxo-stone"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def resolve_sheet_name(xls: pd.ExcelFile, candidates: List[str]) -> str:
    normalized_map = {normalize_text(name): name for name in xls.sheet_names}

    for candidate in candidates:
        key = normalize_text(candidate)
        if key in normalized_map:
            return normalized_map[key]

    for candidate in candidates:
        key = normalize_text(candidate)
        for norm_name, original in normalized_map.items():
            if key == norm_name or key in norm_name or norm_name in key:
                return original

    raise ValueError(f"Não encontrei a aba esperada. Abas disponíveis: {xls.sheet_names}")


def build_normalized_column_map(df: pd.DataFrame) -> Dict[str, Any]:
    return {normalize_text(col): col for col in df.columns}


def find_column(df: pd.DataFrame, aliases: List[str], required: bool = True) -> Any:
    normalized_map = build_normalized_column_map(df)

    for alias in aliases:
        key = normalize_text(alias)
        if key in normalized_map:
            return normalized_map[key]

    for alias in aliases:
        key = normalize_text(alias)

        for norm_col, original_col in normalized_map.items():
            if key in norm_col or norm_col in key:
                return original_col

    if required:
        raise ValueError(f"Não encontrei a coluna. Tente uma destas variações: {aliases}")

    return None


def get_series(df: pd.DataFrame, col_name: Any) -> pd.Series:
    if col_name is None:
        return pd.Series([None] * len(df), index=df.index)

    obj = df[col_name]

    if isinstance(obj, pd.DataFrame):
        return obj.iloc[:, 0]

    return obj


def parse_money(value: Any) -> float:
    if pd.isna(value):
        return np.nan

    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)

    s = str(value).strip()

    if not s:
        return np.nan

    s = s.replace("R$", "").replace("r$", "")
    s = s.replace(" ", "").replace("\u00A0", "")

    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]

    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")

    try:
        return float(s)
    except ValueError:
        return np.nan


def parse_money_series(series: pd.Series) -> pd.Series:
    return series.apply(parse_money)


def _parse_single_date(value: Any) -> Any:
    if pd.isna(value):
        return pd.NaT

    if isinstance(value, pd.Timestamp):
        return value.normalize()

    if isinstance(value, datetime):
        return pd.Timestamp(value.date())

    if isinstance(value, date):
        return pd.Timestamp(value)

    if isinstance(value, (int, float, np.integer, np.floating)):
        num = float(value)

        if np.isnan(num) or np.isinf(num):
            return pd.NaT

        if 20000 <= num <= 80000:
            return (pd.Timestamp("1899-12-30") + pd.to_timedelta(int(num), unit="D")).normalize()

        if 1_000_000_000_000 <= num <= 9_999_999_999_999:
            return pd.to_datetime(int(num), unit="ms", errors="coerce").normalize()

        if 1_000_000_000 <= num <= 9_999_999_999:
            return pd.to_datetime(int(num), unit="s", errors="coerce").normalize()

        if 19_000_000 <= num <= 29_999_999 and float(num).is_integer():
            s = str(int(num))
            return pd.to_datetime(s, format="%Y%m%d", errors="coerce")

        return pd.NaT

    s = str(value).strip()

    if not s:
        return pd.NaT

    s_clean = s.replace(".", "/").replace("-", "/")

    for fmt in [
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d",
        "%Y%m%d",
    ]:
        try:
            return pd.Timestamp(datetime.strptime(s_clean, fmt).date())
        except Exception:
            pass

    if s.isdigit():
        if len(s) == 13:
            return pd.to_datetime(int(s), unit="ms", errors="coerce").normalize()

        if len(s) == 10:
            return pd.to_datetime(int(s), unit="s", errors="coerce").normalize()

        if len(s) == 8 and s.startswith(("19", "20")):
            return pd.to_datetime(s, format="%Y%m%d", errors="coerce")

    dt = pd.to_datetime(s, errors="coerce", dayfirst=True)

    if pd.isna(dt):
        return pd.NaT

    return dt.normalize()


def parse_date_series(series: pd.Series) -> pd.Series:
    return series.apply(_parse_single_date)


def parse_int_safe(value: Any, default: int = 1) -> int:
    if pd.isna(value):
        return default

    s = str(value).strip()

    if not s:
        return default

    if "/" in s:
        s = s.split("/")[0]

    s = s.replace(",", ".")

    try:
        out = int(float(s))
        return out if out > 0 else default
    except Exception:
        return default


def is_business_day(d: date, holidays: set) -> bool:
    return d.weekday() < 5 and d not in holidays


def load_holiday_cache(cache_path: Path) -> Dict[str, Any]:
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    return {}


def save_holiday_cache(cache_path: Path, cache: Dict[str, Any]) -> None:
    try:
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        log(f"AVISO: não foi possível salvar cache de feriados: {exc}")


def fetch_holidays_for_year(year: int) -> List[str]:
    url = HOLIDAY_API_URL.format(year=year)
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    payload = response.json()

    dates = []

    for item in payload:
        dt = item.get("date")

        if dt:
            dates.append(dt)

    return sorted(set(dates))


def load_holidays(years: List[int]) -> set:
    cache_path = get_cache_dir() / HOLIDAY_CACHE_FILENAME
    cache = load_holiday_cache(cache_path)
    holidays = set()

    for year in sorted(set(int(y) for y in years)):
        year_key = str(year)

        if year_key not in cache:
            try:
                log(f"Consultando feriados do ano {year} na API...")
                cache[year_key] = fetch_holidays_for_year(year)
            except Exception as exc:
                log(f"AVISO: não foi possível consultar feriados de {year}: {exc}")
                cache[year_key] = []

        for iso_date in cache.get(year_key, []):
            try:
                holidays.add(pd.to_datetime(iso_date).date())
            except Exception:
                pass

    for iso_date in ADDITIONAL_MANUAL_HOLIDAYS:
        try:
            holidays.add(pd.to_datetime(iso_date).date())
        except Exception:
            pass

    save_holiday_cache(cache_path, cache)
    return holidays


def status_from_diff(diff: float) -> str:
    if pd.isna(diff):
        return ""

    if abs(float(diff)) < 0.005:
        return "OK"

    return "PGT MAIOR" if diff > 0 else "PGT MENOR"


def calcular_fluxo_recebimento_vetorizado(
    data_venda: pd.Series,
    prazo_base: np.ndarray,
    prazo_delay: np.ndarray,
    holidays: set,
) -> Tuple[pd.DatetimeIndex, pd.DatetimeIndex, pd.DatetimeIndex]:
    datas = pd.to_datetime(data_venda, errors="coerce").values.astype("datetime64[D]")
    base = np.asarray(prazo_base, dtype="timedelta64[D]")
    delay = np.asarray(prazo_delay, dtype="timedelta64[D]")

    holiday_values = []

    for h in sorted(holidays):
        try:
            holiday_values.append(np.datetime64(pd.Timestamp(h).date(), "D"))
        except Exception:
            pass

    holidays_np = np.array(holiday_values, dtype="datetime64[D]")

    inicio = np.busday_offset(datas, 0, roll="forward", holidays=holidays_np)

    liquidacao_candidata = inicio + base
    liquidacao = np.busday_offset(liquidacao_candidata, 0, roll="forward", holidays=holidays_np)

    recebimento_candidato = liquidacao + delay
    recebimento = np.busday_offset(recebimento_candidato, 0, roll="forward", holidays=holidays_np)

    return pd.to_datetime(inicio), pd.to_datetime(liquidacao), pd.to_datetime(recebimento)


def prepare_base(df_base: pd.DataFrame, holidays: set) -> Tuple[pd.DataFrame, pd.DataFrame]:
    base = df_base.copy()
    base = base.dropna(how="all").reset_index(drop=True)

    col_data_venda = find_column(base, BASE_COL_ALIASES["data_venda"])
    col_valor_liquido = find_column(base, BASE_COL_ALIASES["valor_liquido"])
    col_valor_parcela = find_column(base, BASE_COL_ALIASES["valor_parcela"], required=False)
    col_produto = find_column(base, BASE_COL_ALIASES["produto"])
    col_parcelas = find_column(base, BASE_COL_ALIASES["parcelas"])
    col_documento = find_column(base, BASE_COL_ALIASES["documento"], required=False)
    col_bandeira = find_column(base, BASE_COL_ALIASES["bandeira"], required=False)

    base["LINHA_ORIGEM"] = np.arange(len(base)) + 2
    base["DATA_VENDA"] = parse_date_series(get_series(base, col_data_venda))
    base["VALOR_VENDA_LIQUIDO"] = parse_money_series(get_series(base, col_valor_liquido))

    if col_valor_parcela:
        base["VALOR_PARCELA_ORIGINAL"] = parse_money_series(get_series(base, col_valor_parcela))
    else:
        base["VALOR_PARCELA_ORIGINAL"] = np.nan

    base["PRODUTO"] = get_series(base, col_produto).astype(str).str.strip()
    base["PRODUTO_NORM"] = base["PRODUTO"].apply(normalize_text)
    base["TOTAL_PARCELAS"] = get_series(base, col_parcelas).apply(lambda x: parse_int_safe(x, 1))
    base["DOCUMENTO"] = get_series(base, col_documento).fillna("").astype(str).str.strip()
    base["BANDEIRA"] = get_series(base, col_bandeira).fillna("").astype(str).str.strip()

    invalid_mask = (
        base["DATA_VENDA"].isna()
        | base["VALOR_VENDA_LIQUIDO"].isna()
        | (base["TOTAL_PARCELAS"] <= 0)
    )

    descartadas = base[invalid_mask].copy()

    if not descartadas.empty:
        descartadas["MOTIVO_DESCARTE"] = np.select(
            [
                descartadas["DATA_VENDA"].isna(),
                descartadas["VALOR_VENDA_LIQUIDO"].isna(),
                descartadas["TOTAL_PARCELAS"] <= 0,
            ],
            ["DATA_VENDA_INVALIDA", "VALOR_LIQUIDO_INVALIDO", "N_DE_PARCELAS_INVALIDO"],
            default="LINHA_INVALIDA",
        )
    else:
        descartadas = pd.DataFrame(columns=list(base.columns) + ["MOTIVO_DESCARTE"])

    base_valid = base[~invalid_mask].copy()

    if base_valid.empty:
        validas = pd.DataFrame(
            columns=[
                "LINHA_ORIGEM",
                "DOCUMENTO",
                "BANDEIRA",
                "PRODUTO",
                "DATA_VENDA",
                "VALOR_VENDA_LIQUIDO",
                "TOTAL_PARCELAS",
                "PARCELA_ATUAL",
                "VALOR_PARCELA_ORIGINAL",
                "VALOR_LIQUIDO",
                "DATA_INICIO_CONTAGEM",
                "DATA_LIQUIDACAO",
                "PRAZO_BASE_DIAS_CORRIDOS",
                "PRAZO_DELAY_DIAS_CORRIDOS",
                "REGRA_APLICADA",
                "DATA_PREVISTA_RECEBIMENTO",
                "MES_PREVISTO",
                "DIA_SEMANA_PREVISTO",
                "DETALHE_CONCAT",
                "MOTIVO_DESCARTE",
            ]
        )

        return validas, descartadas.reset_index(drop=True)

    base_valid["EH_CREDITO"] = base_valid["PRODUTO_NORM"].str.contains("CREDITO", na=False)
    base_valid["EH_DEBITO"] = base_valid["PRODUTO_NORM"].str.contains("DEBITO", na=False)
    base_valid["EH_PIX"] = base_valid["PRODUTO_NORM"].str.contains("PIX", na=False)

    base_valid["QTD_LINHAS_PREVISTAS"] = np.where(
        base_valid["EH_CREDITO"] & (base_valid["TOTAL_PARCELAS"] > 1),
        base_valid["TOTAL_PARCELAS"],
        1,
    ).astype(int)

    cols_expandir = [
        "LINHA_ORIGEM",
        "DOCUMENTO",
        "BANDEIRA",
        "PRODUTO",
        "PRODUTO_NORM",
        "DATA_VENDA",
        "VALOR_VENDA_LIQUIDO",
        "VALOR_PARCELA_ORIGINAL",
        "TOTAL_PARCELAS",
        "EH_CREDITO",
        "EH_DEBITO",
        "EH_PIX",
        "QTD_LINHAS_PREVISTAS",
    ]

    base_expandir = base_valid[cols_expandir].copy()

    expanded = base_expandir.loc[
        base_expandir.index.repeat(base_expandir["QTD_LINHAS_PREVISTAS"])
    ].copy()

    expanded["PARCELA_ATUAL"] = expanded.groupby(level=0).cumcount() + 1
    expanded = expanded.reset_index(drop=True)

    expanded["VALOR_PARCELA_BASE"] = expanded["VALOR_PARCELA_ORIGINAL"]

    mask_sem_parcela = (
        expanded["VALOR_PARCELA_BASE"].isna()
        | (expanded["VALOR_PARCELA_BASE"].astype(float) == 0)
    )

    expanded.loc[mask_sem_parcela, "VALOR_PARCELA_BASE"] = (
        expanded.loc[mask_sem_parcela, "VALOR_VENDA_LIQUIDO"].astype(float)
        / expanded.loc[mask_sem_parcela, "TOTAL_PARCELAS"].astype(float)
    )

    parcelado_mask = expanded["EH_CREDITO"] & (expanded["TOTAL_PARCELAS"] > 1)

    expanded["VALOR_LIQUIDO"] = expanded["VALOR_VENDA_LIQUIDO"].astype(float).round(2)

    expanded.loc[parcelado_mask, "VALOR_LIQUIDO"] = (
        expanded.loc[parcelado_mask, "VALOR_PARCELA_BASE"].astype(float).round(2)
    )

    last_parcela_mask = parcelado_mask & (
        expanded["PARCELA_ATUAL"] == expanded["TOTAL_PARCELAS"]
    )

    expanded.loc[last_parcela_mask, "VALOR_LIQUIDO"] = (
        expanded.loc[last_parcela_mask, "VALOR_VENDA_LIQUIDO"].astype(float)
        - (
            expanded.loc[last_parcela_mask, "VALOR_PARCELA_BASE"].astype(float).round(2)
            * (expanded.loc[last_parcela_mask, "TOTAL_PARCELAS"].astype(int) - 1)
        )
    ).round(2)

    expanded["PRAZO_BASE_DIAS_CORRIDOS"] = np.nan
    expanded["PRAZO_DELAY_DIAS_CORRIDOS"] = np.nan
    expanded["REGRA_APLICADA"] = ""
    expanded["MOTIVO_DESCARTE"] = ""

    mask_debito = expanded["EH_DEBITO"]
    mask_pix = expanded["EH_PIX"]
    mask_credito = expanded["EH_CREDITO"]
    mask_credito_1x = mask_credito & (expanded["TOTAL_PARCELAS"] <= 1)
    mask_credito_parc = mask_credito & (expanded["TOTAL_PARCELAS"] > 1)
    mask_prod_invalido = ~(mask_debito | mask_pix | mask_credito)

    expanded.loc[mask_debito, "PRAZO_BASE_DIAS_CORRIDOS"] = 1
    expanded.loc[mask_debito, "PRAZO_DELAY_DIAS_CORRIDOS"] = 30
    expanded.loc[mask_debito, "REGRA_APLICADA"] = (
        "DÉBITO = D+1 + 30 corridos → recebimento no próximo útil"
    )

    expanded.loc[mask_pix, "PRAZO_BASE_DIAS_CORRIDOS"] = 1
    expanded.loc[mask_pix, "PRAZO_DELAY_DIAS_CORRIDOS"] = 0
    expanded.loc[mask_pix, "REGRA_APLICADA"] = "PIX = D+1 corrido → recebimento no próximo útil"

    expanded.loc[mask_credito_1x, "PRAZO_BASE_DIAS_CORRIDOS"] = 30
    expanded.loc[mask_credito_1x, "PRAZO_DELAY_DIAS_CORRIDOS"] = 30
    expanded.loc[mask_credito_1x, "REGRA_APLICADA"] = (
        "CRÉDITO 1X = D+30 + 30 corridos → recebimento no próximo útil"
    )

    expanded.loc[mask_credito_parc, "PRAZO_BASE_DIAS_CORRIDOS"] = (
        expanded.loc[mask_credito_parc, "PARCELA_ATUAL"].astype(int) * 30
    )

    expanded.loc[mask_credito_parc, "PRAZO_DELAY_DIAS_CORRIDOS"] = 30

    expanded.loc[mask_credito_parc, "REGRA_APLICADA"] = (
        "CRÉDITO PARCELADO "
        + expanded.loc[mask_credito_parc, "PARCELA_ATUAL"].astype(str)
        + "/"
        + expanded.loc[mask_credito_parc, "TOTAL_PARCELAS"].astype(str)
        + " = D+(parcela x 30) + 30 corridos → recebimento no próximo útil"
    )

    expanded.loc[mask_prod_invalido, "MOTIVO_DESCARTE"] = (
        "Produto não suportado para regra de recebimento: "
        + expanded.loc[mask_prod_invalido, "PRODUTO"].astype(str)
    )

    invalid_expanded = expanded[expanded["MOTIVO_DESCARTE"] != ""].copy()

    if not invalid_expanded.empty:
        descartadas = pd.concat([descartadas, invalid_expanded], ignore_index=True)

    validas = expanded[expanded["MOTIVO_DESCARTE"] == ""].copy()

    if validas.empty:
        return validas.reset_index(drop=True), descartadas.reset_index(drop=True)

    validas["PRAZO_BASE_DIAS_CORRIDOS"] = validas["PRAZO_BASE_DIAS_CORRIDOS"].astype(int)
    validas["PRAZO_DELAY_DIAS_CORRIDOS"] = validas["PRAZO_DELAY_DIAS_CORRIDOS"].astype(int)

    log("Calculando datas previstas de recebimento em modo rápido...")

    datas_inicio_validas, datas_liquidacao_validas, datas_recebimento_validas = (
        calcular_fluxo_recebimento_vetorizado(
            validas["DATA_VENDA"],
            validas["PRAZO_BASE_DIAS_CORRIDOS"].astype(int).to_numpy(),
            validas["PRAZO_DELAY_DIAS_CORRIDOS"].astype(int).to_numpy(),
            holidays,
        )
    )

    validas["DATA_INICIO_CONTAGEM"] = datas_inicio_validas.strftime("%Y-%m-%d")
    validas["DATA_LIQUIDACAO"] = datas_liquidacao_validas.strftime("%Y-%m-%d")
    validas["DATA_PREVISTA_RECEBIMENTO"] = datas_recebimento_validas.strftime("%Y-%m-%d")
    validas["MES_PREVISTO"] = datas_recebimento_validas.strftime("%m/%Y")
    validas["DIA_SEMANA_PREVISTO"] = pd.Series(datas_recebimento_validas.dayofweek).map(WEEKDAY_PT).values

    validas["DETALHE_CONCAT"] = (
        "Doc "
        + validas["DOCUMENTO"].astype(str)
        + " - "
        + validas["PRODUTO"].astype(str)
        + " - Parcela "
        + validas["PARCELA_ATUAL"].astype(str)
        + "/"
        + validas["TOTAL_PARCELAS"].astype(str)
    )

    keep_cols = [
        "LINHA_ORIGEM",
        "DOCUMENTO",
        "BANDEIRA",
        "PRODUTO",
        "DATA_VENDA",
        "VALOR_VENDA_LIQUIDO",
        "TOTAL_PARCELAS",
        "PARCELA_ATUAL",
        "VALOR_PARCELA_ORIGINAL",
        "VALOR_LIQUIDO",
        "DATA_INICIO_CONTAGEM",
        "DATA_LIQUIDACAO",
        "PRAZO_BASE_DIAS_CORRIDOS",
        "PRAZO_DELAY_DIAS_CORRIDOS",
        "REGRA_APLICADA",
        "DATA_PREVISTA_RECEBIMENTO",
        "MES_PREVISTO",
        "DIA_SEMANA_PREVISTO",
        "DETALHE_CONCAT",
        "MOTIVO_DESCARTE",
    ]

    return validas[keep_cols].reset_index(drop=True), descartadas.reset_index(drop=True)


def prepare_extrato(df_extrato: pd.DataFrame) -> pd.DataFrame:
    extr = df_extrato.copy()
    extr = extr.dropna(how="all").reset_index(drop=True)

    col_data = find_column(extr, EXTRATO_COL_ALIASES["data_extrato"])
    col_valor = find_column(extr, EXTRATO_COL_ALIASES["valor_extrato"], required=False)
    col_credito = find_column(extr, EXTRATO_COL_ALIASES["credito_extrato"], required=False)
    col_debito = find_column(extr, EXTRATO_COL_ALIASES["debito_extrato"], required=False)
    col_desc = find_column(extr, EXTRATO_COL_ALIASES["descricao"], required=False)

    extr["DATA_EXTRATO"] = parse_date_series(get_series(extr, col_data))

    if col_valor:
        extr["VALOR_EXTRATO"] = parse_money_series(get_series(extr, col_valor))
    else:
        if not col_credito:
            raise ValueError(
                "Não encontrei a coluna de valor do extrato. Ajuste EXTRATO_COL_ALIASES com os nomes reais da sua aba EXTRATO."
            )

        credito = parse_money_series(get_series(extr, col_credito)).fillna(0)

        if col_debito:
            debito = parse_money_series(get_series(extr, col_debito)).fillna(0)
        else:
            debito = 0

        extr["VALOR_EXTRATO"] = credito - debito

    extr["DESCRICAO"] = get_series(extr, col_desc).fillna("").astype(str).str.strip()

    extr = extr[extr["DATA_EXTRATO"].notna()].copy()
    extr = extr[extr["VALOR_EXTRATO"].notna()].copy()

    if EXTRATO_ONLY_POSITIVE_VALUES:
        extr = extr[extr["VALOR_EXTRATO"] > 0].copy()

    extr = extr.reset_index(drop=True)
    extr["MES_EXTRATO"] = extr["DATA_EXTRATO"].dt.strftime("%m/%Y")
    extr["DIA_SEMANA_EXTRATO"] = extr["DATA_EXTRATO"].dt.dayofweek.map(WEEKDAY_PT)

    return extr


def detalhes_resumidos(series: pd.Series, limite: int = MAX_DETALHES_POR_DIA) -> str:
    itens = [str(x) for x in series if str(x).strip()]

    if len(itens) > limite:
        return " | ".join(itens[:limite]) + f" | ... +{len(itens) - limite} lançamentos"

    return " | ".join(itens)


def build_previsto_concatenado(validas: pd.DataFrame) -> pd.DataFrame:
    agrupado = (
        validas.groupby("DATA_PREVISTA_RECEBIMENTO", as_index=False)
        .agg(
            MES=("MES_PREVISTO", "first"),
            DIA_DA_SEMANA=("DIA_SEMANA_PREVISTO", "first"),
            TOTAL_PREVISTO=("VALOR_LIQUIDO", "sum"),
            QTD_LANCAMENTOS=("VALOR_LIQUIDO", "size"),
            DETALHES=("DETALHE_CONCAT", detalhes_resumidos),
        )
        .sort_values("DATA_PREVISTA_RECEBIMENTO")
        .reset_index(drop=True)
    )

    agrupado["DATA_PREVISTA_RECEBIMENTO"] = pd.to_datetime(
        agrupado["DATA_PREVISTA_RECEBIMENTO"], errors="coerce"
    )

    return agrupado


def build_extrato_concatenado(extr: pd.DataFrame) -> pd.DataFrame:
    agrupado = (
        extr.groupby("DATA_EXTRATO", as_index=False)
        .agg(
            MES=("MES_EXTRATO", "first"),
            DIA_DA_SEMANA=("DIA_SEMANA_EXTRATO", "first"),
            TOTAL_EXTRATO=("VALOR_EXTRATO", "sum"),
            QTD_LANCAMENTOS=("VALOR_EXTRATO", "size"),
            DETALHES_EXTRATO=("DESCRICAO", detalhes_resumidos),
        )
        .sort_values("DATA_EXTRATO")
        .reset_index(drop=True)
    )

    return agrupado


def build_conciliacao(previsto_conc: pd.DataFrame, extrato_conc: pd.DataFrame) -> pd.DataFrame:
    conciliacao = previsto_conc.merge(
        extrato_conc,
        left_on="DATA_PREVISTA_RECEBIMENTO",
        right_on="DATA_EXTRATO",
        how="outer",
    )

    conciliacao["DATA"] = conciliacao["DATA_PREVISTA_RECEBIMENTO"].combine_first(
        conciliacao["DATA_EXTRATO"]
    )

    conciliacao["MES"] = conciliacao["MES_x"].combine_first(conciliacao["MES_y"])
    conciliacao["DIA_DA_SEMANA"] = conciliacao["DIA_DA_SEMANA_x"].combine_first(
        conciliacao["DIA_DA_SEMANA_y"]
    )

    conciliacao["PROJETADO"] = conciliacao["TOTAL_PREVISTO"].fillna(0.0)
    conciliacao["VLR_EXTRATO"] = conciliacao["TOTAL_EXTRATO"].fillna(0.0)
    conciliacao["QTD_PREVISTA"] = conciliacao["QTD_LANCAMENTOS_x"].fillna(0).astype(int)
    conciliacao["QTD_EXTRATO"] = conciliacao["QTD_LANCAMENTOS_y"].fillna(0).astype(int)
    conciliacao["DIFERENCA"] = conciliacao["VLR_EXTRATO"] - conciliacao["PROJETADO"]
    conciliacao["STATUS"] = conciliacao["DIFERENCA"].apply(status_from_diff)
    conciliacao["DETALHES_PREVISTO"] = conciliacao["DETALHES"].fillna("")
    conciliacao["DETALHES_EXTRATO"] = conciliacao["DETALHES_EXTRATO"].fillna("")

    conciliacao = conciliacao[
        [
            "MES",
            "DATA",
            "PROJETADO",
            "VLR_EXTRATO",
            "DIFERENCA",
            "STATUS",
            "DIA_DA_SEMANA",
            "QTD_PREVISTA",
            "QTD_EXTRATO",
            "DETALHES_PREVISTO",
            "DETALHES_EXTRATO",
        ]
    ].sort_values("DATA").reset_index(drop=True)

    return conciliacao


def build_calendar_daily(conciliacao: pd.DataFrame) -> pd.DataFrame:
    min_date = conciliacao["DATA"].min()
    max_date = conciliacao["DATA"].max()

    if pd.isna(min_date) or pd.isna(max_date):
        raise ValueError("Não foi possível montar o calendário diário, pois não há datas válidas.")

    start = pd.Timestamp(year=min_date.year, month=min_date.month, day=1)
    end = pd.Timestamp(year=max_date.year, month=max_date.month, day=1) + pd.offsets.MonthEnd(1)

    calendario = pd.DataFrame({"DATA": pd.date_range(start, end, freq="D")})
    out = calendario.merge(conciliacao, on="DATA", how="left")

    out["MES"] = out["DATA"].dt.strftime("%m/%Y")
    out["DIA_DA_SEMANA"] = out["DATA"].dt.dayofweek.map(WEEKDAY_PT)
    out["PROJETADO"] = out["PROJETADO"].fillna(0.0)
    out["VLR_EXTRATO"] = out["VLR_EXTRATO"].fillna(0.0)
    out["DIFERENCA"] = out["VLR_EXTRATO"] - out["PROJETADO"]

    hoje = pd.Timestamp("today").normalize()

    out["STATUS"] = out.apply(
        lambda row: "A RECEBER" if row["DATA"] > hoje else status_from_diff(row["DIFERENCA"]),
        axis=1,
    )

    out["QTD_PREVISTA"] = out["QTD_PREVISTA"].fillna(0).astype(int)
    out["QTD_EXTRATO"] = out["QTD_EXTRATO"].fillna(0).astype(int)
    out["DETALHES_PREVISTO"] = out["DETALHES_PREVISTO"].fillna("")
    out["DETALHES_EXTRATO"] = out["DETALHES_EXTRATO"].fillna("")

    return out


def build_monthly(calendar_daily: pd.DataFrame, extr: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    max_extrato_date = None

    if extr is not None and not extr.empty and "DATA_EXTRATO" in extr.columns:
        max_extrato_date = extr["DATA_EXTRATO"].max()

    rows = []

    for period, block in calendar_daily.groupby(calendar_daily["DATA"].dt.to_period("M")):
        block_calc = block.copy()
        status_forcado = None

        if max_extrato_date is not None:
            max_period = max_extrato_date.to_period("M")

            if period == max_period:
                block_calc = block_calc[block_calc["DATA"] <= max_extrato_date]
            elif period > max_period:
                status_forcado = "A RECEBER"

        projetado = float(block_calc["PROJETADO"].sum())
        vlr_extrato = float(block_calc["VLR_EXTRATO"].sum())
        diferenca = vlr_extrato - projetado
        status = status_forcado if status_forcado else status_from_diff(diferenca)

        rows.append(
            {
                "MES_REF": period,
                "MES": period.strftime("%m/%Y"),
                "PROJETADO": projetado,
                "VLR_EXTRATO": vlr_extrato,
                "DIFERENCA": diferenca,
                "STATUS": status,
            }
        )

    mensal = pd.DataFrame(rows)

    if mensal.empty:
        return pd.DataFrame(columns=["MES_REF", "MES", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS"])

    return mensal[["MES_REF", "MES", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS"]]


def to_float(value: Any) -> float:
    if pd.isna(value):
        return 0.0

    return float(value)


def to_int(value: Any) -> int:
    if pd.isna(value):
        return 0

    return int(value)


def iso_date(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None

    try:
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    except Exception:
        return None


def build_json_response(
    input_path: Path,
    base_sheet_name: str,
    extrato_sheet_name: str,
    validas: pd.DataFrame,
    descartadas: pd.DataFrame,
    extr: pd.DataFrame,
    conciliacao: pd.DataFrame,
    daily_calendar: pd.DataFrame,
    mensal: pd.DataFrame,
) -> Dict[str, Any]:
    total_projetado = float(daily_calendar["PROJETADO"].sum())
    total_extrato = float(daily_calendar["VLR_EXTRATO"].sum())
    diferenca_total = total_extrato - total_projetado

    diario = []

    for _, row in daily_calendar.iterrows():
        diario.append(
            {
                "data": iso_date(row["DATA"]),
                "mes": str(row["MES"] or ""),
                "diaSemana": str(row["DIA_DA_SEMANA"] or ""),
                "projetado": to_float(row["PROJETADO"]),
                "vlrExtrato": to_float(row["VLR_EXTRATO"]),
                "diferenca": to_float(row["DIFERENCA"]),
                "status": str(row["STATUS"] or ""),
                "qtdPrevista": to_int(row["QTD_PREVISTA"]),
                "qtdExtrato": to_int(row["QTD_EXTRATO"]),
                "detalhesPrevisto": str(row["DETALHES_PREVISTO"] or ""),
                "detalhesExtrato": str(row["DETALHES_EXTRATO"] or ""),
            }
        )

    mensal_json = []

    for _, row in mensal.iterrows():
        mensal_json.append(
            {
                "mes": str(row["MES"] or ""),
                "projetado": to_float(row["PROJETADO"]),
                "vlrExtrato": to_float(row["VLR_EXTRATO"]),
                "diferenca": to_float(row["DIFERENCA"]),
                "status": str(row["STATUS"] or ""),
            }
        )

    descartadas_json = []

    if not descartadas.empty:
        descartadas_preview = descartadas.head(MAX_DESCARTADAS_RETORNO).copy()

        for _, row in descartadas_preview.iterrows():
            item = {}

            for col in descartadas_preview.columns:
                value = row[col]

                if isinstance(value, (pd.Timestamp, datetime, date)):
                    item[str(col)] = iso_date(value)
                elif pd.isna(value):
                    item[str(col)] = None
                elif isinstance(value, (np.integer,)):
                    item[str(col)] = int(value)
                elif isinstance(value, (np.floating,)):
                    item[str(col)] = float(value)
                else:
                    item[str(col)] = str(value)

            descartadas_json.append(item)

    periodo_inicio = iso_date(daily_calendar["DATA"].min())
    periodo_fim = iso_date(daily_calendar["DATA"].max())

    response = {
        "ok": True,
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "processedBy": "python-stone",
        "fileName": input_path.name,
        "resumo": {
            "totalProjetado": total_projetado,
            "totalExtrato": total_extrato,
            "diferencaTotal": diferenca_total,
            "qtdVendasProcessadas": int(len(validas)),
            "qtdLancamentosExtrato": int(len(extr)),
            "diasOk": int((daily_calendar["STATUS"] == "OK").sum()),
            "diasPgtMaior": int((daily_calendar["STATUS"] == "PGT MAIOR").sum()),
            "diasPgtMenor": int((daily_calendar["STATUS"] == "PGT MENOR").sum()),
            "periodoInicio": periodo_inicio,
            "periodoFim": periodo_fim,
        },
        "mensal": mensal_json,
        "diario": diario,
        "descartadas": descartadas_json,
        "meta": {
            "baseSheetName": base_sheet_name,
            "extratoSheetName": extrato_sheet_name,
            "linhasValidasBase": int(len(validas)),
            "linhasValidasExtrato": int(len(extr)),
            "linhasDescartadas": int(len(descartadas)),
            "linhasConciliacao": int(len(conciliacao)),
            "arquivoEntrada": input_path.name,
            "regraDebito": "D+1 + 30 corridos, próximo dia útil",
            "regraPix": "D+1 corrido, próximo dia útil",
            "regraCredito1x": "D+30 + 30 corridos, próximo dia útil",
            "regraCreditoParcelado": "cada parcela usa VLR PARCELA; parcela N recebe em D+(N x 30)+30, próximo dia útil",
        },
    }

    return response


def process_file(input_path: Path) -> Dict[str, Any]:
    if not input_path.exists():
        raise FileNotFoundError(f"Arquivo recebido do backend não encontrado: {input_path}")

    if input_path.suffix.lower() not in {".xlsb", ".xlsx", ".xlsm"}:
        raise ValueError("Arquivo inválido. Envie uma planilha .xlsb, .xlsx ou .xlsm.")

    log("=" * 80)
    log("INICIANDO MOTOR JSON DE RECEBIMENTOS STONE")
    log(f"Arquivo recebido: {input_path}")
    log(f"Tamanho: {input_path.stat().st_size} bytes")

    engine = get_engine(input_path)
    xls = pd.ExcelFile(input_path, engine=engine)

    sheet_base = resolve_sheet_name(xls, SHEET_BASE_CANDIDATES)
    sheet_extrato = resolve_sheet_name(xls, SHEET_EXTRATO_CANDIDATES)

    log(f"Aba base localizada: {sheet_base}")
    log(f"Aba extrato localizada: {sheet_extrato}")

    df_base = pd.read_excel(input_path, sheet_name=sheet_base, engine=engine, dtype=object)
    df_extrato = pd.read_excel(input_path, sheet_name=sheet_extrato, engine=engine, dtype=object)

    col_data_venda = find_column(df_base, BASE_COL_ALIASES["data_venda"])
    anos_base = parse_date_series(get_series(df_base, col_data_venda)).dropna().dt.year.unique().tolist()

    if not anos_base:
        raise ValueError("Não foi possível identificar anos válidos na coluna de DATA DA VENDA.")

    anos_feriados = set(int(y) for y in anos_base)
    anos_feriados.update(int(y) + 1 for y in anos_base)
    anos_feriados.update(int(y) + 2 for y in anos_base)

    holidays = load_holidays(list(anos_feriados))
    log(f"Total de feriados carregados: {len(holidays)}")

    validas, descartadas = prepare_base(df_base, holidays)

    log(f"Linhas previstas válidas geradas: {len(validas)}")
    log(f"Linhas descartadas na base: {len(descartadas)}")

    extr = prepare_extrato(df_extrato)
    log(f"Linhas válidas no extrato: {len(extr)}")

    if validas.empty:
        raise ValueError("Nenhuma linha válida foi gerada a partir da BASE TRATADA.")

    previsto_conc = build_previsto_concatenado(validas)
    extrato_conc = build_extrato_concatenado(extr)
    conciliacao = build_conciliacao(previsto_conc, extrato_conc)
    daily_calendar = build_calendar_daily(conciliacao)
    mensal = build_monthly(daily_calendar, extr)

    log(
        f"Período consolidado: {daily_calendar['DATA'].min().date()} até {daily_calendar['DATA'].max().date()}"
    )

    response = build_json_response(
        input_path=input_path,
        base_sheet_name=sheet_base,
        extrato_sheet_name=sheet_extrato,
        validas=validas,
        descartadas=descartadas,
        extr=extr,
        conciliacao=conciliacao,
        daily_calendar=daily_calendar,
        mensal=mensal,
    )

    log("Motor finalizado com sucesso.")
    log("=" * 80)

    return response


def main() -> None:
    try:
        if len(sys.argv) < 2:
            raise ValueError(
                "Caminho da planilha não informado. Uso correto: python stone_recebimentos_engine.py arquivo.xlsb"
            )

        input_path = Path(sys.argv[1]).resolve()
        result = process_file(input_path)

        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)

    except Exception as exc:
        error_payload = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }

        print(json.dumps(error_payload, ensure_ascii=False, allow_nan=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()