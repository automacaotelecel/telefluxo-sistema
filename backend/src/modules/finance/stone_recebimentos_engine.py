from pathlib import Path
import sys
import json
import traceback
import unicodedata
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import requests
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

INPUT_FILENAME = None
OUTPUT_FILENAME = "RECEBIMENTOS STONE TRATADOS.xlsx"

SHEET_BASE_CANDIDATES = ["BASE TRATADA"]
SHEET_EXTRATO_CANDIDATES = ["EXTRATO BANCARIO", "EXTRATO_BANCARIO"]

HOLIDAY_API_URL = "https://date.nager.at/api/v3/PublicHolidays/{year}/BR"
REQUEST_TIMEOUT = 20
HOLIDAY_CACHE_FILENAME = "feriados_cache_br.json"

ADDITIONAL_MANUAL_HOLIDAYS = []
EXTRATO_ONLY_POSITIVE_VALUES = True

BASE_COL_ALIASES = {
    "data_venda": ["data de venda", "data da venda", "data_venda", "data venda"],
    "valor_liquido": ["valor liquido", "valor líquido", "valor_liq", "vlr liquido", "vlr líquido"],
    "produto": ["produto", "tipo", "modalidade"],
    "parcelas": ["n de parcelas", "n parcelas", "parcelas", "numero de parcelas", "nro parcelas", "qtde parcelas"],
    "documento": ["documento", "doc", "numero documento", "n documento"],
    "bandeira": ["bandeira", "cartao", "cartão", "bandeira cartao", "bandeira cartão"],
}

EXTRATO_COL_ALIASES = {
    "data_extrato": [
        "data", "data extrato", "data lancamento", "data lançamento", "data do credito", "data do crédito",
        "data recebimento", "data pagamento", "data movimento", "data movimentacao", "data movimentação"
    ],
    "valor_extrato": [
        "valor", "valor recebido", "valor credito", "valor crédito", "credito", "crédito",
        "entrada", "deposito", "depósito", "valor lancamento", "valor lançamento",
        "valor do credito", "valor do crédito", "valor liquido", "valor líquido"
    ],
    "credito_extrato": ["credito", "crédito", "entrada", "valor credito", "valor crédito", "deposito", "depósito"],
    "debito_extrato": ["debito", "débito", "saida", "saída", "valor debito", "valor débito"],
    "descricao": ["descricao", "descrição", "historico", "histórico", "detalhe", "complemento"],
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


def normalize_text(text):
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


def get_app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    if "__file__" in globals():
        return Path(__file__).resolve().parent
    return Path.cwd()


def detect_input_file(base_dir: Path) -> Path:
    if INPUT_FILENAME:
        path = base_dir / INPUT_FILENAME
        if not path.exists():
            raise FileNotFoundError(f"Arquivo configurado não encontrado: {path}")
        return path

    candidates = [
        p for p in base_dir.iterdir()
        if p.is_file()
        and p.name.lower() != OUTPUT_FILENAME.lower()
        and p.suffix.lower() in {".xlsb", ".xlsx", ".xlsm"}
        and not p.name.startswith("~$")
    ]

    if not candidates:
        raise FileNotFoundError("Não encontrei nenhum arquivo .xlsb/.xlsx/.xlsm na mesma pasta do programa.")

    candidates.sort(key=lambda p: (0 if p.suffix.lower() == ".xlsb" else 1, -p.stat().st_mtime))
    return candidates[0]


def get_engine(path: Path):
    if path.suffix.lower() == ".xlsb":
        return "pyxlsb"
    return None


def resolve_sheet_name(xls: pd.ExcelFile, candidates):
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


def build_normalized_column_map(df: pd.DataFrame):
    return {normalize_text(col): col for col in df.columns}


def find_column(df: pd.DataFrame, aliases, required=True):
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


def get_series(df: pd.DataFrame, col_name):
    if col_name is None:
        return pd.Series([None] * len(df), index=df.index)

    obj = df[col_name]
    if isinstance(obj, pd.DataFrame):
        return obj.iloc[:, 0]
    return obj


def parse_money(value):
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


def _parse_single_date(value):
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


def calculate_rule_schedule(produto, parcelas):
    prod = normalize_text(produto)
    parcelas = 0 if pd.isna(parcelas) else int(float(parcelas))

    if "DEBITO" in prod:
        return 1, 30, "DÉBITO = D+1 corrido → liquidação no próximo útil se necessário → +30 corridos → recebimento no próximo útil"

    if "PIX" in prod:
        return 1, 30, "PIX = D+1 corrido → liquidação no próximo útil se necessário → +30 corridos → recebimento no próximo útil"

    if "CREDITO" in prod:
        if parcelas <= 1:
            return 30, 30, "CRÉDITO 1X = D+30 corridos → liquidação no próximo útil se necessário → +30 corridos → recebimento no próximo útil"
        return parcelas * 30, 30, f"CRÉDITO PARCELADO = D+({parcelas}x30 corridos) → liquidação no próximo útil se necessário → +30 corridos → recebimento no próximo útil"

    raise ValueError(f"Produto não suportado para regra de recebimento: {produto}")


def is_business_day(d: date, holidays: set) -> bool:
    return d.weekday() < 5 and d not in holidays


def move_to_next_business_day(d: date, holidays: set) -> date:
    current = d
    while not is_business_day(current, holidays):
        current += timedelta(days=1)
    return current


def calculate_receipt_flow(sale_date: date, base_calendar_days: int, delay_calendar_days: int, holidays: set, memo=None):
    if memo is None:
        memo = {}

    key = (sale_date.isoformat(), int(base_calendar_days), int(delay_calendar_days))
    if key in memo:
        return memo[key]

    start_count_date = move_to_next_business_day(sale_date, holidays)
    liquidation_candidate = start_count_date + timedelta(days=base_calendar_days)
    liquidation_date = move_to_next_business_day(liquidation_candidate, holidays)
    receipt_candidate = liquidation_date + timedelta(days=delay_calendar_days)
    receipt_date = move_to_next_business_day(receipt_candidate, holidays)

    result = {
        "data_inicio_contagem": start_count_date,
        "data_liquidacao": liquidation_date,
        "data_recebimento": receipt_date,
    }
    memo[key] = result
    return result


def load_holiday_cache(cache_path: Path):
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_holiday_cache(cache_path: Path, cache: dict):
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_holidays_for_year(year: int) -> list:
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


def load_holidays(years, base_dir: Path) -> set:
    cache_path = base_dir / HOLIDAY_CACHE_FILENAME
    cache = load_holiday_cache(cache_path)
    holidays = set()

    for year in sorted(set(int(y) for y in years)):
        year_key = str(year)

        if year_key not in cache:
            try:
                print(f"Consultando feriados do ano {year} na API...", file=sys.stderr)
                cache[year_key] = fetch_holidays_for_year(year)
            except Exception:
                if year_key not in cache:
                    raise

        for iso_date in cache.get(year_key, []):
            holidays.add(pd.to_datetime(iso_date).date())

    for iso_date in ADDITIONAL_MANUAL_HOLIDAYS:
        holidays.add(pd.to_datetime(iso_date).date())

    save_holiday_cache(cache_path, cache)
    return holidays


def status_from_diff(diff: float) -> str:
    if pd.isna(diff):
        return ""
    if abs(float(diff)) < 0.005:
        return "OK"
    return "PGT MAIOR" if diff > 0 else "PGT MENOR"


def format_brl(value):
    if pd.isna(value):
        return "R$ 0,00"
    s = f"{float(value):,.2f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def prepare_base(df_base: pd.DataFrame, holidays: set):
    base = df_base.copy()
    base = base.dropna(how="all").reset_index(drop=True)

    col_data_venda = find_column(base, BASE_COL_ALIASES["data_venda"])
    col_valor_liquido = find_column(base, BASE_COL_ALIASES["valor_liquido"])
    col_produto = find_column(base, BASE_COL_ALIASES["produto"])
    col_parcelas = find_column(base, BASE_COL_ALIASES["parcelas"])
    col_documento = find_column(base, BASE_COL_ALIASES["documento"], required=False)
    col_bandeira = find_column(base, BASE_COL_ALIASES["bandeira"], required=False)

    base["DATA_VENDA"] = parse_date_series(get_series(base, col_data_venda))
    base["VALOR_LIQUIDO"] = parse_money_series(get_series(base, col_valor_liquido))
    base["PRODUTO"] = get_series(base, col_produto).astype(str).str.strip()
    base["PARCELAS"] = pd.to_numeric(get_series(base, col_parcelas), errors="coerce").fillna(0).astype(int)
    base["DOCUMENTO"] = get_series(base, col_documento).fillna("").astype(str).str.strip()
    base["BANDEIRA"] = get_series(base, col_bandeira).fillna("").astype(str).str.strip()

    n = len(base)

    data_inicio_contagem = [pd.NaT] * n
    data_liquidacao = [pd.NaT] * n
    projected_dates = [pd.NaT] * n
    base_days = [np.nan] * n
    delay_days = [np.nan] * n
    rules_text = [""] * n
    detail_texts = [""] * n
    discard_reasons = [""] * n

    memo = {}

    for i in range(n):
        venda = base.at[i, "DATA_VENDA"]
        valor = base.at[i, "VALOR_LIQUIDO"]
        produto = base.at[i, "PRODUTO"]
        parcelas = base.at[i, "PARCELAS"]
        documento = base.at[i, "DOCUMENTO"]
        bandeira = base.at[i, "BANDEIRA"]

        if pd.isna(venda):
            discard_reasons[i] = "DATA_VENDA_INVALIDA"
            continue

        if pd.isna(valor):
            discard_reasons[i] = "VALOR_LIQUIDO_INVALIDO"
            continue

        try:
            prazo_base_corrido, prazo_delay_corrido, regra = calculate_rule_schedule(produto, parcelas)
            fluxo = calculate_receipt_flow(
                sale_date=venda.date(),
                base_calendar_days=prazo_base_corrido,
                delay_calendar_days=prazo_delay_corrido,
                holidays=holidays,
                memo=memo,
            )

            parts = []
            if documento:
                parts.append(f"Doc {documento}")
            if bandeira:
                parts.append(bandeira)
            if produto:
                parts.append(produto)
            if parcelas > 0:
                parts.append(f"{parcelas}x")
            parts.append(format_brl(valor))

            data_inicio_contagem[i] = pd.Timestamp(fluxo["data_inicio_contagem"])
            data_liquidacao[i] = pd.Timestamp(fluxo["data_liquidacao"])
            projected_dates[i] = pd.Timestamp(fluxo["data_recebimento"])
            base_days[i] = prazo_base_corrido
            delay_days[i] = prazo_delay_corrido
            rules_text[i] = regra
            detail_texts[i] = " - ".join(parts)
        except Exception as exc:
            discard_reasons[i] = str(exc)

    base["DATA_INICIO_CONTAGEM"] = data_inicio_contagem
    base["DATA_LIQUIDACAO"] = data_liquidacao
    base["PRAZO_BASE_DIAS_CORRIDOS"] = base_days
    base["PRAZO_DELAY_DIAS_CORRIDOS"] = delay_days
    base["REGRA_APLICADA"] = rules_text
    base["DATA_PREVISTA_RECEBIMENTO"] = projected_dates
    base["MES_PREVISTO"] = pd.Series(projected_dates).dt.strftime("%m/%Y")
    base["DIA_SEMANA_PREVISTO"] = pd.Series(projected_dates).dt.dayofweek.map(WEEKDAY_PT)
    base["DETALHE_CONCAT"] = detail_texts
    base["MOTIVO_DESCARTE"] = discard_reasons

    descartadas = base[base["MOTIVO_DESCARTE"] != ""].copy().reset_index(drop=True)
    validas = base[base["MOTIVO_DESCARTE"] == ""].copy().reset_index(drop=True)

    return validas, descartadas


def prepare_extrato(df_extrato: pd.DataFrame):
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
        debito = parse_money_series(get_series(extr, col_debito)).fillna(0) if col_debito else 0
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


def build_previsto_concatenado(validas: pd.DataFrame):
    agrupado = (
        validas.groupby("DATA_PREVISTA_RECEBIMENTO", as_index=False)
        .agg(
            MES=("MES_PREVISTO", "first"),
            DIA_DA_SEMANA=("DIA_SEMANA_PREVISTO", "first"),
            TOTAL_PREVISTO=("VALOR_LIQUIDO", "sum"),
            QTD_LANCAMENTOS=("VALOR_LIQUIDO", "size"),
            DETALHES=("DETALHE_CONCAT", lambda s: " | ".join([x for x in s if str(x).strip()]))
        )
        .sort_values("DATA_PREVISTA_RECEBIMENTO")
        .reset_index(drop=True)
    )
    return agrupado


def build_extrato_concatenado(extr: pd.DataFrame):
    agrupado = (
        extr.groupby("DATA_EXTRATO", as_index=False)
        .agg(
            MES=("MES_EXTRATO", "first"),
            DIA_DA_SEMANA=("DIA_SEMANA_EXTRATO", "first"),
            TOTAL_EXTRATO=("VALOR_EXTRATO", "sum"),
            QTD_LANCAMENTOS=("VALOR_EXTRATO", "size"),
            DETALHES_EXTRATO=("DESCRICAO", lambda s: " | ".join([x for x in s if str(x).strip()]))
        )
        .sort_values("DATA_EXTRATO")
        .reset_index(drop=True)
    )
    return agrupado


def build_conciliacao(previsto_conc: pd.DataFrame, extrato_conc: pd.DataFrame):
    conciliacao = previsto_conc.merge(
        extrato_conc,
        left_on="DATA_PREVISTA_RECEBIMENTO",
        right_on="DATA_EXTRATO",
        how="outer"
    )

    conciliacao["DATA"] = conciliacao["DATA_PREVISTA_RECEBIMENTO"].combine_first(conciliacao["DATA_EXTRATO"])
    conciliacao["MES"] = conciliacao["MES_x"].combine_first(conciliacao["MES_y"])
    conciliacao["DIA_DA_SEMANA"] = conciliacao["DIA_DA_SEMANA_x"].combine_first(conciliacao["DIA_DA_SEMANA_y"])
    conciliacao["PROJETADO"] = conciliacao["TOTAL_PREVISTO"].fillna(0.0)
    conciliacao["VLR_EXTRATO"] = conciliacao["TOTAL_EXTRATO"].fillna(0.0)
    conciliacao["QTD_PREVISTA"] = conciliacao["QTD_LANCAMENTOS_x"].fillna(0).astype(int)
    conciliacao["QTD_EXTRATO"] = conciliacao["QTD_LANCAMENTOS_y"].fillna(0).astype(int)
    conciliacao["DIFERENCA"] = conciliacao["VLR_EXTRATO"] - conciliacao["PROJETADO"]
    conciliacao["STATUS"] = conciliacao["DIFERENCA"].apply(status_from_diff)
    conciliacao["DETALHES_PREVISTO"] = conciliacao["DETALHES"].fillna("")
    conciliacao["DETALHES_EXTRATO"] = conciliacao["DETALHES_EXTRATO"].fillna("")

    conciliacao = conciliacao[[
        "MES", "DATA", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS",
        "DIA_DA_SEMANA", "QTD_PREVISTA", "QTD_EXTRATO", "DETALHES_PREVISTO", "DETALHES_EXTRATO"
    ]].sort_values("DATA").reset_index(drop=True)

    return conciliacao


def build_calendar_daily(conciliacao: pd.DataFrame):
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
    out["STATUS"] = out["DIFERENCA"].apply(status_from_diff)
    out["QTD_PREVISTA"] = out["QTD_PREVISTA"].fillna(0).astype(int)
    out["QTD_EXTRATO"] = out["QTD_EXTRATO"].fillna(0).astype(int)
    out["DETALHES_PREVISTO"] = out["DETALHES_PREVISTO"].fillna("")
    out["DETALHES_EXTRATO"] = out["DETALHES_EXTRATO"].fillna("")

    return out


def build_monthly(calendar_daily: pd.DataFrame):
    base = calendar_daily.copy()
    base["MES_REF"] = base["DATA"].dt.to_period("M")
    mensal = (
        base.groupby("MES_REF", as_index=False)
        .agg(
            PROJETADO=("PROJETADO", "sum"),
            VLR_EXTRATO=("VLR_EXTRATO", "sum"),
        )
    )
    mensal["DIFERENCA"] = mensal["VLR_EXTRATO"] - mensal["PROJETADO"]
    mensal["STATUS"] = mensal["DIFERENCA"].apply(status_from_diff)
    mensal["MES"] = mensal["MES_REF"].dt.strftime("%m/%Y")
    mensal = mensal[["MES_REF", "MES", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS"]]
    return mensal

def build_resumo_final(calendar_daily: pd.DataFrame):
    resumo = calendar_daily[["DATA", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS"]].copy()
    resumo.columns = ["DATA", "VALOR PREVISÃO", "VALOR ENTRADA", "DIFERENÇA", "STATUS"]
    resumo = resumo[(resumo["VALOR PREVISÃO"] != 0) | (resumo["VALOR ENTRADA"] != 0)].reset_index(drop=True)
    return resumo


def build_resumo_executivo(calendar_daily: pd.DataFrame, validas: pd.DataFrame, extr: pd.DataFrame):
    total_previsto = float(calendar_daily["PROJETADO"].sum())
    total_entrada = float(calendar_daily["VLR_EXTRATO"].sum())
    total_diferenca = float(calendar_daily["DIFERENCA"].sum())

    dias_ok = int((calendar_daily["STATUS"] == "OK").sum())
    dias_maior = int((calendar_daily["STATUS"] == "PGT MAIOR").sum())
    dias_menor = int((calendar_daily["STATUS"] == "PGT MENOR").sum())

    qtd_previstas = int(len(validas))
    qtd_extrato = int(len(extr))

    return pd.DataFrame({
        "INDICADOR": [
            "TOTAL PREVISTO",
            "TOTAL ENTRADA",
            "DIFERENÇA TOTAL",
            "QTDE VENDAS PROCESSADAS",
            "QTDE LANÇAMENTOS EXTRATO",
            "DIAS COM STATUS OK",
            "DIAS COM PGT MAIOR",
            "DIAS COM PGT MENOR",
        ],
        "VALOR": [
            total_previsto,
            total_entrada,
            total_diferenca,
            qtd_previstas,
            qtd_extrato,
            dias_ok,
            dias_maior,
            dias_menor,
        ]
    })


def autosize_sheet(ws, extra=2):
    for column_cells in ws.columns:
        max_length = 0
        col_letter = get_column_letter(column_cells[0].column)
        for cell in column_cells:
            val = "" if cell.value is None else str(cell.value)
            max_length = max(max_length, len(val))
        ws.column_dimensions[col_letter].width = min(max_length + extra, 60)


def _header_to_index(ws):
    return {normalize_text(cell.value): idx + 1 for idx, cell in enumerate(ws[1]) if cell.value is not None}


def style_basic_sheet(ws, currency_headers=None, date_headers=None, wrap_headers=None):
    currency_headers = currency_headers or []
    date_headers = date_headers or []
    wrap_headers = wrap_headers or []

    header_fill = PatternFill("solid", fgColor="D9E2F3")
    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    header_map = _header_to_index(ws)
    currency_indexes = {header_map.get(normalize_text(h)) for h in currency_headers}
    date_indexes = {header_map.get(normalize_text(h)) for h in date_headers}
    wrap_indexes = {header_map.get(normalize_text(h)) for h in wrap_headers}
    currency_indexes.discard(None)
    date_indexes.discard(None)
    wrap_indexes.discard(None)

    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.border = border
            if cell.column in currency_indexes and isinstance(cell.value, (int, float)):
                cell.number_format = 'R$ #,##0.00'
            if cell.column in date_indexes and cell.value is not None:
                cell.number_format = 'dd/mm/yyyy'
            if cell.column in wrap_indexes:
                cell.alignment = Alignment(wrap_text=True, vertical="top")

    ws.freeze_panes = "A2"
    autosize_sheet(ws)


def style_resumo_executivo(ws):
    header_fill = PatternFill("solid", fgColor="385D9D")
    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.border = border
            if cell.column == 2 and isinstance(cell.value, (int, float)):
                if row[0].value in ["TOTAL PREVISTO", "TOTAL ENTRADA", "DIFERENÇA TOTAL"]:
                    cell.number_format = 'R$ #,##0.00'

    ws.freeze_panes = "A2"
    autosize_sheet(ws, extra=4)


def write_panel(ws, daily_calendar: pd.DataFrame, mensal: pd.DataFrame):
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A4"

    title_fill_blue = PatternFill("solid", fgColor="385D9D")
    title_fill_beige = PatternFill("solid", fgColor="EAD7A4")
    header_fill = PatternFill("solid", fgColor="D9E2F3")
    thin = Side(style="thin", color="1F1F1F")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    white_bold = Font(bold=True, color="FFFFFF")
    bold = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center")

    start_row_summary = 2
    start_col_summary = 1

    ws.merge_cells(
        start_row=start_row_summary,
        start_column=start_col_summary,
        end_row=start_row_summary,
        end_column=start_col_summary + 4,
    )
    c = ws.cell(start_row_summary, start_col_summary, "CONSOLIDADO POR MÊS")
    c.fill = title_fill_blue
    c.font = white_bold
    c.alignment = center

    headers_summary = ["DIA/MÊS", "PROJETADO", "VLR EXTRATO", "DIFERENÇA", "STATUS"]
    for j, header in enumerate(headers_summary, start=start_col_summary):
        cell = ws.cell(start_row_summary + 2, j, header)
        cell.fill = header_fill
        cell.font = bold
        cell.alignment = center
        cell.border = border

    row = start_row_summary + 3
    for _, r in mensal.iterrows():
        values = [r["MES"], r["PROJETADO"], r["VLR_EXTRATO"], r["DIFERENCA"], r["STATUS"]]
        for j, value in enumerate(values, start=start_col_summary):
            cell = ws.cell(row, j, value)
            cell.border = border
            if j in (2, 3, 4):
                cell.number_format = 'R$ #,##0.00'
            if j == 5:
                if value == "PGT MAIOR":
                    cell.font = Font(color="008000", bold=True)
                elif value == "PGT MENOR":
                    cell.font = Font(color="C00000", bold=True)
        row += 1

    total_values = [
        "TOTAL",
        float(mensal["PROJETADO"].sum()),
        float(mensal["VLR_EXTRATO"].sum()),
        float(mensal["DIFERENCA"].sum()),
        status_from_diff(float(mensal["DIFERENCA"].sum())),
    ]
    for j, value in enumerate(total_values, start=start_col_summary):
        cell = ws.cell(row, j, value)
        cell.border = border
        cell.font = Font(bold=True)
        if j in (2, 3, 4):
            cell.number_format = 'R$ #,##0.00'

    months = list(daily_calendar["DATA"].dt.to_period("M").drop_duplicates().sort_values())
    base_col = 7
    current_top_row = 2
    block_gap_cols = 1
    block_width = 6
    max_block_height_in_band = 0

    for idx, period in enumerate(months):
        position_in_band = idx % 2

        if idx > 0 and position_in_band == 0:
            current_top_row += max_block_height_in_band + 3
            max_block_height_in_band = 0

        start_col = base_col + position_in_band * (block_width + block_gap_cols)
        block = daily_calendar[daily_calendar["DATA"].dt.to_period("M") == period].copy()

        ws.merge_cells(
            start_row=current_top_row,
            start_column=start_col,
            end_row=current_top_row,
            end_column=start_col + block_width - 1,
        )
        tc = ws.cell(current_top_row, start_col, "CONSOLIDADO POR DIA E MÊS")
        tc.fill = title_fill_beige
        tc.font = Font(bold=True)
        tc.alignment = center

        headers = ["MÊS", "DATA", "PROJETADO", "VLR EXTRATO", "DIFERENÇA", "DIA DA SEMANA"]
        for j, header in enumerate(headers, start=start_col):
            hc = ws.cell(current_top_row + 2, j, header)
            hc.fill = header_fill
            hc.font = Font(bold=True)
            hc.alignment = center
            hc.border = border

        write_row = current_top_row + 3
        for _, r in block.iterrows():
            vals = [
                r["MES"],
                r["DATA"].to_pydatetime(),
                float(r["PROJETADO"]),
                float(r["VLR_EXTRATO"]),
                float(r["DIFERENCA"]),
                r["DIA_DA_SEMANA"],
            ]
            for j, value in enumerate(vals, start=start_col):
                cell = ws.cell(write_row, j, value)
                cell.border = border
                if j == start_col + 1:
                    cell.number_format = "dd/mm/yyyy"
                if j in (start_col + 2, start_col + 3, start_col + 4):
                    cell.number_format = 'R$ #,##0.00'
            write_row += 1

        totals = [
            "",
            "TOTAL",
            float(block["PROJETADO"].sum()),
            float(block["VLR_EXTRATO"].sum()),
            float(block["DIFERENCA"].sum()),
            "",
        ]
        for j, value in enumerate(totals, start=start_col):
            cell = ws.cell(write_row, j, value)
            cell.border = border
            cell.font = Font(bold=True)
            if j in (start_col + 2, start_col + 3, start_col + 4):
                cell.number_format = 'R$ #,##0.00'

        block_height = len(block) + 4
        max_block_height_in_band = max(max_block_height_in_band, block_height)

    for col in range(1, ws.max_column + 1):
        ws.column_dimensions[get_column_letter(col)].width = 16

    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["E"].width = 14


def write_output(
    output_path: Path,
    input_path: Path,
    base_sheet_name: str,
    extrato_sheet_name: str,
    validas: pd.DataFrame,
    descartadas: pd.DataFrame,
    extr: pd.DataFrame,
    previsto_conc: pd.DataFrame,
    extrato_conc: pd.DataFrame,
    conciliacao: pd.DataFrame,
    daily_calendar: pd.DataFrame,
    mensal: pd.DataFrame,
):
    detalhado_previsto = validas[[
        "DOCUMENTO", "BANDEIRA", "DATA_VENDA", "DATA_INICIO_CONTAGEM", "DATA_LIQUIDACAO",
        "PRODUTO", "PARCELAS", "VALOR_LIQUIDO", "PRAZO_BASE_DIAS_CORRIDOS",
        "PRAZO_DELAY_DIAS_CORRIDOS", "REGRA_APLICADA", "DATA_PREVISTA_RECEBIMENTO",
        "MES_PREVISTO", "DIA_SEMANA_PREVISTO", "DETALHE_CONCAT"
    ]].copy().rename(columns={
        "DATA_VENDA": "DATA DA VENDA",
        "DATA_INICIO_CONTAGEM": "DATA INÍCIO CONTAGEM",
        "DATA_LIQUIDACAO": "DATA LIQUIDAÇÃO",
        "PARCELAS": "N DE PARCELAS",
        "VALOR_LIQUIDO": "VALOR LÍQUIDO",
        "PRAZO_BASE_DIAS_CORRIDOS": "PRAZO BASE DIAS CORRIDOS",
        "PRAZO_DELAY_DIAS_CORRIDOS": "PRAZO DELAY DIAS CORRIDOS",
        "REGRA_APLICADA": "REGRA APLICADA",
        "DATA_PREVISTA_RECEBIMENTO": "DATA PREVISTA RECEBIMENTO",
        "MES_PREVISTO": "MÊS PREVISTO",
        "DIA_SEMANA_PREVISTO": "DIA DA SEMANA PREVISTO",
        "DETALHE_CONCAT": "DETALHE CONCATENADO",
    })

    previsto_concat = previsto_conc.rename(columns={
        "DATA_PREVISTA_RECEBIMENTO": "DATA PREVISTA",
        "MES": "MÊS",
        "DIA_DA_SEMANA": "DIA DA SEMANA",
        "TOTAL_PREVISTO": "TOTAL PREVISTO",
        "QTD_LANCAMENTOS": "QTD LANÇAMENTOS",
        "DETALHES": "DETALHES",
    })

    extrato_tratado = extr[["DATA_EXTRATO", "VALOR_EXTRATO", "MES_EXTRATO", "DIA_SEMANA_EXTRATO", "DESCRICAO"]].copy().rename(columns={
        "DATA_EXTRATO": "DATA EXTRATO",
        "VALOR_EXTRATO": "VALOR EXTRATO",
        "MES_EXTRATO": "MÊS EXTRATO",
        "DIA_SEMANA_EXTRATO": "DIA DA SEMANA EXTRATO",
        "DESCRICAO": "DESCRIÇÃO",
    })

    extrato_concat_export = extrato_conc.rename(columns={
        "DATA_EXTRATO": "DATA EXTRATO",
        "MES": "MÊS",
        "DIA_DA_SEMANA": "DIA DA SEMANA",
        "TOTAL_EXTRATO": "TOTAL EXTRATO",
        "QTD_LANCAMENTOS": "QTD LANÇAMENTOS",
        "DETALHES_EXTRATO": "DETALHES EXTRATO",
    })

    conciliacao_export = conciliacao.rename(columns={
        "MES": "MÊS",
        "DATA": "DATA",
        "PROJETADO": "PROJETADO",
        "VLR_EXTRATO": "VLR EXTRATO",
        "DIFERENCA": "DIFERENÇA",
        "STATUS": "STATUS",
        "DIA_DA_SEMANA": "DIA DA SEMANA",
        "QTD_PREVISTA": "QTD PREVISTA",
        "QTD_EXTRATO": "QTD EXTRATO",
        "DETALHES_PREVISTO": "DETALHES PREVISTO",
        "DETALHES_EXTRATO": "DETALHES EXTRATO",
    })

    resumo_final = build_resumo_final(daily_calendar)
    resumo_executivo = build_resumo_executivo(daily_calendar, validas, extr)

    auditoria = validas[[
        "DOCUMENTO", "BANDEIRA", "DATA_VENDA", "DATA_INICIO_CONTAGEM", "DATA_LIQUIDACAO",
        "PRODUTO", "PARCELAS", "VALOR_LIQUIDO", "PRAZO_BASE_DIAS_CORRIDOS",
        "PRAZO_DELAY_DIAS_CORRIDOS", "REGRA_APLICADA", "DATA_PREVISTA_RECEBIMENTO"
    ]].copy().rename(columns={
        "DATA_VENDA": "DATA DA VENDA",
        "DATA_INICIO_CONTAGEM": "DATA INÍCIO CONTAGEM",
        "DATA_LIQUIDACAO": "DATA LIQUIDAÇÃO",
        "PARCELAS": "N DE PARCELAS",
        "VALOR_LIQUIDO": "VALOR LÍQUIDO",
        "PRAZO_BASE_DIAS_CORRIDOS": "PRAZO BASE DIAS CORRIDOS",
        "PRAZO_DELAY_DIAS_CORRIDOS": "PRAZO DELAY DIAS CORRIDOS",
        "REGRA_APLICADA": "REGRA APLICADA",
        "DATA_PREVISTA_RECEBIMENTO": "DATA PREVISTA",
    })

    mensal_export = mensal[["MES", "PROJETADO", "VLR_EXTRATO", "DIFERENCA", "STATUS"]].copy().rename(columns={
        "MES": "DIA/MÊS",
        "PROJETADO": "PROJETADO",
        "VLR_EXTRATO": "VLR EXTRATO",
        "DIFERENCA": "DIFERENÇA",
        "STATUS": "STATUS",
    })

    parametros = pd.DataFrame({
        "PARÂMETRO": [
            "ARQUIVO DE ENTRADA",
            "ABA BASE",
            "ABA EXTRATO",
            "API FERIADOS",
            "EXTENSÃO LIDA",
            "SOMENTE VALORES POSITIVOS NO EXTRATO",
            "FERIADOS MANUAIS ADICIONAIS",
            "REGRA DÉBITO",
            "REGRA PIX",
            "REGRA CRÉDITO 1X",
            "REGRA CRÉDITO PARCELADO",
            "OBSERVAÇÃO GERAL",
        ],
        "VALOR": [
            input_path.name,
            base_sheet_name,
            extrato_sheet_name,
            HOLIDAY_API_URL,
            input_path.suffix.lower(),
            str(EXTRATO_ONLY_POSITIVE_VALUES),
            ", ".join(ADDITIONAL_MANUAL_HOLIDAYS) if ADDITIONAL_MANUAL_HOLIDAYS else "",
            "Venda em dia não útil começa no próximo útil; D+1 corrido; liquidação cai no próximo útil se necessário; delay de 30 corridos; recebimento cai no próximo útil se necessário",
            "Venda em dia não útil começa no próximo útil; D+1 corrido; liquidação cai no próximo útil se necessário; delay de 30 corridos; recebimento cai no próximo útil se necessário",
            "Venda em dia não útil começa no próximo útil; D+30 corridos; liquidação cai no próximo útil se necessário; delay de 30 corridos; recebimento cai no próximo útil se necessário",
            "Venda em dia não útil começa no próximo útil; D+(parcelas x 30 corridos); liquidação cai no próximo útil se necessário; delay de 30 corridos; recebimento cai no próximo útil se necessário",
            "Toda venda em dia não útil começa a contar no próximo dia útil",
        ],
    })

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        resumo_executivo.to_excel(writer, sheet_name="RESUMO_EXECUTIVO", index=False)
        resumo_final.to_excel(writer, sheet_name="RESUMO_FINAL", index=False)
        detalhado_previsto.to_excel(writer, sheet_name="PREVISTO_DETALHADO", index=False)
        previsto_concat.to_excel(writer, sheet_name="PREVISTO_CONCATENADO", index=False)
        extrato_tratado.to_excel(writer, sheet_name="EXTRATO_TRATADO", index=False)
        extrato_concat_export.to_excel(writer, sheet_name="EXTRATO_CONCATENADO", index=False)
        conciliacao_export.to_excel(writer, sheet_name="CONCILIACAO_DIA", index=False)
        auditoria.to_excel(writer, sheet_name="AUDITORIA_REGRAS", index=False)
        mensal_export.to_excel(writer, sheet_name="CONSOLIDADO_MES", index=False)
        descartadas.to_excel(writer, sheet_name="LINHAS_DESCARTADAS", index=False)
        parametros.to_excel(writer, sheet_name="PARAMETROS", index=False)

    wb = load_workbook(output_path)
    painel = wb.create_sheet("PAINEL", 0)
    write_panel(painel, daily_calendar, mensal)

    style_resumo_executivo(wb["RESUMO_EXECUTIVO"])
    style_basic_sheet(
        wb["RESUMO_FINAL"],
        currency_headers=["VALOR PREVISÃO", "VALOR ENTRADA", "DIFERENÇA"],
        date_headers=["DATA"],
    )
    style_basic_sheet(
        wb["PREVISTO_DETALHADO"],
        currency_headers=["VALOR LÍQUIDO"],
        date_headers=["DATA DA VENDA", "DATA INÍCIO CONTAGEM", "DATA LIQUIDAÇÃO", "DATA PREVISTA RECEBIMENTO"],
        wrap_headers=["DETALHE CONCATENADO", "REGRA APLICADA"],
    )
    style_basic_sheet(
        wb["PREVISTO_CONCATENADO"],
        currency_headers=["TOTAL PREVISTO"],
        date_headers=["DATA PREVISTA"],
        wrap_headers=["DETALHES"],
    )
    style_basic_sheet(
        wb["EXTRATO_TRATADO"],
        currency_headers=["VALOR EXTRATO"],
        date_headers=["DATA EXTRATO"],
        wrap_headers=["DESCRIÇÃO"],
    )
    style_basic_sheet(
        wb["EXTRATO_CONCATENADO"],
        currency_headers=["TOTAL EXTRATO"],
        date_headers=["DATA EXTRATO"],
        wrap_headers=["DETALHES EXTRATO"],
    )
    style_basic_sheet(
        wb["CONCILIACAO_DIA"],
        currency_headers=["PROJETADO", "VLR EXTRATO", "DIFERENÇA"],
        date_headers=["DATA"],
        wrap_headers=["DETALHES PREVISTO", "DETALHES EXTRATO"],
    )
    style_basic_sheet(
        wb["AUDITORIA_REGRAS"],
        currency_headers=["VALOR LÍQUIDO"],
        date_headers=["DATA DA VENDA", "DATA INÍCIO CONTAGEM", "DATA LIQUIDAÇÃO", "DATA PREVISTA"],
        wrap_headers=["REGRA APLICADA"],
    )
    style_basic_sheet(
        wb["CONSOLIDADO_MES"],
        currency_headers=["PROJETADO", "VLR EXTRATO", "DIFERENÇA"],
    )
    style_basic_sheet(wb["LINHAS_DESCARTADAS"])
    style_basic_sheet(wb["PARAMETROS"])

    wb.save(output_path)



def _to_iso(value):
    if pd.isna(value):
        return None
    try:
        return pd.to_datetime(value).date().isoformat()
    except Exception:
        return None


def _clean_float(value):
    if pd.isna(value):
        return 0.0
    return float(value)


def process_file(input_path_raw):
    input_path = Path(input_path_raw).resolve()
    base_dir = input_path.parent

    if not input_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {input_path}")

    engine = get_engine(input_path)
    xls = pd.ExcelFile(input_path, engine=engine)

    sheet_base = resolve_sheet_name(xls, SHEET_BASE_CANDIDATES)
    sheet_extrato = resolve_sheet_name(xls, SHEET_EXTRATO_CANDIDATES)

    df_base = pd.read_excel(input_path, sheet_name=sheet_base, engine=engine, dtype=object)
    df_extrato = pd.read_excel(input_path, sheet_name=sheet_extrato, engine=engine, dtype=object)

    col_data_venda = find_column(df_base, BASE_COL_ALIASES["data_venda"])
    anos_base = parse_date_series(get_series(df_base, col_data_venda)).dropna().dt.year.unique().tolist()

    if not anos_base:
        raise ValueError("Não foi possível identificar anos válidos na coluna de DATA DA VENDA.")

    anos_feriados = set(anos_base)
    anos_feriados.update(y + 1 for y in anos_base)
    anos_feriados.update(y + 2 for y in anos_base)

    holidays = load_holidays(anos_feriados, base_dir)

    validas, descartadas = prepare_base(df_base, holidays)
    extr = prepare_extrato(df_extrato)
    previsto_conc = build_previsto_concatenado(validas)
    extrato_conc = build_extrato_concatenado(extr)
    conciliacao = build_conciliacao(previsto_conc, extrato_conc)
    daily_calendar = build_calendar_daily(conciliacao)
    mensal = build_monthly(daily_calendar)

    total_projetado = float(daily_calendar["PROJETADO"].sum())
    total_extrato = float(daily_calendar["VLR_EXTRATO"].sum())
    diferenca_total = float(daily_calendar["DIFERENCA"].sum())

    mensal_rows = []
    for _, row in mensal.iterrows():
        mensal_rows.append({
            "mes": str(row["MES"]),
            "projetado": _clean_float(row["PROJETADO"]),
            "vlrExtrato": _clean_float(row["VLR_EXTRATO"]),
            "diferenca": _clean_float(row["DIFERENCA"]),
            "status": str(row["STATUS"] or ""),
        })

    diario_rows = []
    for _, row in daily_calendar.iterrows():
        diario_rows.append({
            "data": _to_iso(row["DATA"]),
            "mes": str(row["MES"] or ""),
            "diaSemana": str(row["DIA_DA_SEMANA"] or ""),
            "projetado": _clean_float(row["PROJETADO"]),
            "vlrExtrato": _clean_float(row["VLR_EXTRATO"]),
            "diferenca": _clean_float(row["DIFERENCA"]),
            "status": str(row["STATUS"] or ""),
            "qtdPrevista": int(row["QTD_PREVISTA"] or 0),
            "qtdExtrato": int(row["QTD_EXTRATO"] or 0),
            "detalhesPrevisto": str(row["DETALHES_PREVISTO"] or ""),
            "detalhesExtrato": str(row["DETALHES_EXTRATO"] or ""),
        })

    descartadas_rows = []
    if len(descartadas) > 0:
        cols = [c for c in ["DATA_VENDA", "VALOR_LIQUIDO", "PRODUTO", "PARCELAS", "DOCUMENTO", "BANDEIRA", "MOTIVO_DESCARTE"] if c in descartadas.columns]
        for _, row in descartadas[cols].head(500).iterrows():
            item = {}
            for col in cols:
                val = row[col]
                if isinstance(val, (pd.Timestamp, datetime, date)):
                    item[col] = _to_iso(val)
                elif pd.isna(val):
                    item[col] = None
                else:
                    item[col] = str(val)
            descartadas_rows.append(item)

    return {
        "ok": True,
        "generatedAt": datetime.now().isoformat(),
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
            "periodoInicio": _to_iso(daily_calendar["DATA"].min()),
            "periodoFim": _to_iso(daily_calendar["DATA"].max()),
        },
        "mensal": mensal_rows,
        "diario": diario_rows,
        "descartadas": descartadas_rows,
        "meta": {
            "baseSheetName": sheet_base,
            "extratoSheetName": sheet_extrato,
            "linhasValidasBase": int(len(validas)),
            "linhasValidasExtrato": int(len(extr)),
            "linhasDescartadas": int(len(descartadas)),
        },
    }


def main():
    if len(sys.argv) < 2:
        raise ValueError("Informe o caminho da planilha como primeiro argumento.")

    result = process_file(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        error_payload = {
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc(),
        }
        print(json.dumps(error_payload, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
