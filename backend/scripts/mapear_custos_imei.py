from __future__ import annotations

import csv
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd


# ============================================================
# MAPEADOR DE CUSTO POR IMEI — FATURAMENTO (5298)
# ============================================================
# Este script:
# 1. Abre o relatório Faturamento exportado da Linx.
# 2. Lê IMEI, Preço Custo Serial e Valor IPI.
# 3. Ignora cancelamentos e transferências.
# 4. Escolhe a compra mais antiga válida de cada IMEI.
# 5. Gera mapa_custos_imei.csv.
#
# Não envia nada ao TeleFluxo.
# Não chama o Render.
# Não altera banco de dados.
# ============================================================


ALIASES = {
    "imei": (
        "imei",
        "serial",
        "numero_de_serie",
        "numero_serie",
        "serial_normalizado",
    ),
    "custo_serial": (
        "preco_custo_serial",
        "custo_serial",
        "custo_serial_entrada",
        "preco_unitario",
        "preco_unitario_numero",
    ),
    "valor_ipi": (
        "valor_ipi",
        "valor_ipi_numero",
        "ipi_valor",
    ),
    "quantidade": (
        "quantidade",
        "quantidade_numero",
        "qtd",
    ),
    "operacao": ("operacao",),
    "tipo_transacao": (
        "tipo_transacao",
        "tipo_de_transacao",
    ),
    "cancelado": ("cancelado",),
    "natureza": (
        "natureza_de_operacao",
        "natureza_operacao",
        "descricao_natureza_operacao",
    ),
    "cfop": (
        "cfop",
        "id_cfop",
        "codigo_cfop",
    ),
    "data": (
        "data_de_lancamento",
        "data_lancamento",
        "data_de_emissao",
        "data_emissao",
        "data_documento",
        "data_entrada",
    ),
    "nota": (
        "nota_fiscal",
        "documento",
        "documento_entrada",
        "nota_entrada",
    ),
    "serie": ("serie",),
    "cnpj": (
        "cnpj",
        "cnpj_emp",
        "cnpj_empresa",
        "cnpj_compra",
    ),
    "produto": (
        "codigo_produto",
        "cod_produto",
        "codigoproduto",
    ),
    "identificador": ("identificador",),
    "razao_social": ("razao_social",),
    "nome_fantasia": ("nome_fantasia",),
    "deposito": (
        "nome_deposito",
        "deposito",
    ),
}

TERMOS_COMPRA = (
    "COMPRA",
    "COMERCIALIZACAO",
    "REVENDA",
    "ENTRADA DE MERCADORIA",
    "AQUISICAO",
)

TERMOS_DESCARTAR = (
    "TRANSFER",
    "AJUSTE",
    "DEVOLU",
    "REMESSA",
    "CONSIGN",
)


def normalizar_nome(valor: object) -> str:
    texto = str(valor or "").strip()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(
        caractere
        for caractere in texto
        if not unicodedata.combining(caractere)
    )
    texto = texto.lower()
    texto = re.sub(r"[^a-z0-9]+", "_", texto)
    return texto.strip("_")


def normalizar_texto(valor: object) -> str:
    texto = str(valor or "").strip()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(
        caractere
        for caractere in texto
        if not unicodedata.combining(caractere)
    )
    return re.sub(r"\s+", " ", texto.upper()).strip()


def normalizar_imei(valor: object) -> str:
    return "".join(
        caractere
        for caractere in normalizar_texto(valor)
        if caractere.isalnum()
    )


def numero(valor: object) -> float:
    if valor is None:
        return 0.0

    try:
        if pd.isna(valor):
            return 0.0
    except (TypeError, ValueError):
        pass

    if isinstance(valor, (int, float)):
        return float(valor)

    texto = str(valor).strip()
    texto = texto.replace("R$", "").replace("\u00a0", "").replace(" ", "")
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


def selecionar_arquivo() -> Path:
    # Também aceita um caminho opcional:
    # python mapear_custos_imei.py "C:\caminho\Faturamento.csv"
    if len(sys.argv) > 1:
        return Path(sys.argv[1].strip('"')).expanduser().resolve()

    try:
        from tkinter import Tk, filedialog

        janela = Tk()
        janela.withdraw()
        janela.attributes("-topmost", True)

        arquivo = filedialog.askopenfilename(
            title="Selecione o relatório Faturamento (5298)",
            filetypes=[
                ("Relatórios", "*.csv *.xlsx *.xlsm *.xls"),
                ("CSV", "*.csv"),
                ("Excel", "*.xlsx *.xlsm *.xls"),
                ("Todos os arquivos", "*.*"),
            ],
        )

        janela.destroy()

        if arquivo:
            return Path(arquivo).resolve()
    except Exception:
        pass

    caminho = input(
        "\nCole o caminho completo do relatório Faturamento e pressione Enter:\n> "
    ).strip().strip('"')

    if not caminho:
        raise RuntimeError("Nenhum relatório foi selecionado.")

    return Path(caminho).expanduser().resolve()


def detectar_separador(caminho: Path, encoding: str) -> str:
    with caminho.open(
        "r",
        encoding=encoding,
        errors="replace",
        newline="",
    ) as arquivo:
        amostra = arquivo.read(16384)

    try:
        return csv.Sniffer().sniff(
            amostra,
            delimiters=";,\t|",
        ).delimiter
    except csv.Error:
        return ";" if amostra.count(";") >= amostra.count(",") else ","


def ler_csv(caminho: Path) -> pd.DataFrame:
    erros: list[str] = []

    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            separador = detectar_separador(caminho, encoding)
            tabela = pd.read_csv(
                caminho,
                sep=separador,
                encoding=encoding,
                dtype=object,
                low_memory=False,
            )
            if len(tabela.columns) > 1:
                return tabela
        except Exception as erro:
            erros.append(f"{encoding}: {erro}")

    raise RuntimeError(
        "Não foi possível abrir o CSV.\n"
        + "\n".join(erros)
    )


def ler_relatorio(caminho: Path) -> pd.DataFrame:
    if not caminho.exists():
        raise FileNotFoundError(f"Arquivo não encontrado:\n{caminho}")

    extensao = caminho.suffix.lower()

    if extensao in {".csv", ".txt"}:
        tabela = ler_csv(caminho)
    elif extensao in {".xlsx", ".xlsm"}:
        tabela = pd.read_excel(
            caminho,
            dtype=object,
            engine="openpyxl",
        )
    elif extensao == ".xls":
        tabela = pd.read_excel(caminho, dtype=object)
    else:
        raise RuntimeError(
            f"Formato não suportado: {extensao}\n"
            "Use CSV, XLSX, XLSM ou XLS."
        )

    tabela.columns = [
        normalizar_nome(coluna)
        for coluna in tabela.columns
    ]

    return tabela


def localizar_coluna(
    tabela: pd.DataFrame,
    nome_logico: str,
) -> str | None:
    colunas = set(tabela.columns)

    for alias in ALIASES[nome_logico]:
        nome = normalizar_nome(alias)
        if nome in colunas:
            return nome

    return None


def serie_ou_padrao(
    tabela: pd.DataFrame,
    coluna: str | None,
    padrao: object = "",
) -> pd.Series:
    if coluna and coluna in tabela.columns:
        return tabela[coluna]

    return pd.Series(
        [padrao] * len(tabela),
        index=tabela.index,
        dtype=object,
    )


def converter_datas(serie: pd.Series) -> pd.Series:
    textos = serie.fillna("").astype(str).str.strip()

    resultado = pd.to_datetime(
        textos,
        errors="coerce",
        format="mixed",
        dayfirst=True,
    )

    return resultado


def entrada(valor: object) -> bool:
    texto = normalizar_texto(valor)

    return (
        texto == "E"
        or texto.startswith("E ")
        or "(E)" in texto
        or "ENTRADA" in texto
    )


def cancelado(valor: object) -> bool:
    return normalizar_texto(valor) in {
        "S",
        "SIM",
        "1",
        "TRUE",
        "VERDADEIRO",
        "CANCELADO",
    }


def transferencia(valor: object) -> bool:
    texto = normalizar_texto(valor)

    return (
        texto in {"D", "T"}
        or "TRANSFER" in texto
    )


def classificar_compra(
    natureza: object,
    cfop: object,
) -> tuple[bool, int, str]:
    natureza_texto = normalizar_texto(natureza)
    cfop_texto = normalizar_texto(cfop)
    conjunto = f"{natureza_texto} {cfop_texto}"

    if any(termo in conjunto for termo in TERMOS_DESCARTAR):
        return False, 99, "DESCARTADO_POR_NATUREZA"

    if any(termo in conjunto for termo in TERMOS_COMPRA):
        return True, 0, "COMPRA_EXPLICITA"

    apenas_numeros = re.sub(r"\D", "", cfop_texto)

    if apenas_numeros.startswith(("1", "2")):
        return True, 1, "ENTRADA_POR_CFOP"

    return True, 2, "ENTRADA_NAO_CLASSIFICADA"


def montar_base(
    tabela: pd.DataFrame,
    colunas: dict[str, str | None],
) -> pd.DataFrame:
    base = pd.DataFrame(index=tabela.index)

    base["IMEI"] = serie_ou_padrao(
        tabela,
        colunas["imei"],
    ).map(normalizar_imei)

    base["PRECO_CUSTO_SERIAL"] = serie_ou_padrao(
        tabela,
        colunas["custo_serial"],
        0,
    ).map(numero)

    base["VALOR_IPI"] = serie_ou_padrao(
        tabela,
        colunas["valor_ipi"],
        0,
    ).map(numero)

    base["QUANTIDADE"] = serie_ou_padrao(
        tabela,
        colunas["quantidade"],
        1,
    ).map(numero)

    base["OPERACAO"] = serie_ou_padrao(
        tabela,
        colunas["operacao"],
    )

    base["TIPO_TRANSACAO"] = serie_ou_padrao(
        tabela,
        colunas["tipo_transacao"],
    )

    base["CANCELADO"] = serie_ou_padrao(
        tabela,
        colunas["cancelado"],
    )

    base["NATUREZA_OPERACAO"] = serie_ou_padrao(
        tabela,
        colunas["natureza"],
    )

    base["CFOP"] = serie_ou_padrao(
        tabela,
        colunas["cfop"],
    )

    base["DATA_COMPRA"] = converter_datas(
        serie_ou_padrao(
            tabela,
            colunas["data"],
        )
    )

    base["NOTA_FISCAL"] = serie_ou_padrao(
        tabela,
        colunas["nota"],
    ).fillna("").astype(str).str.strip()

    base["SERIE"] = serie_ou_padrao(
        tabela,
        colunas["serie"],
    ).fillna("").astype(str).str.strip()

    base["CNPJ_COMPRA"] = (
        serie_ou_padrao(
            tabela,
            colunas["cnpj"],
        )
        .fillna("")
        .astype(str)
        .str.replace(r"\D", "", regex=True)
    )

    base["CODIGO_PRODUTO"] = serie_ou_padrao(
        tabela,
        colunas["produto"],
    ).fillna("").astype(str).str.strip()

    base["IDENTIFICADOR"] = serie_ou_padrao(
        tabela,
        colunas["identificador"],
    ).fillna("").astype(str).str.strip()

    base["RAZAO_SOCIAL"] = serie_ou_padrao(
        tabela,
        colunas["razao_social"],
    ).fillna("").astype(str).str.strip()

    base["NOME_FANTASIA"] = serie_ou_padrao(
        tabela,
        colunas["nome_fantasia"],
    ).fillna("").astype(str).str.strip()

    base["DEPOSITO"] = serie_ou_padrao(
        tabela,
        colunas["deposito"],
    ).fillna("").astype(str).str.strip()

    classificacoes = base.apply(
        lambda linha: classificar_compra(
            linha["NATUREZA_OPERACAO"],
            linha["CFOP"],
        ),
        axis=1,
    )

    base["CANDIDATO_COMPRA"] = [
        item[0]
        for item in classificacoes
    ]

    base["PRIORIDADE"] = [
        item[1]
        for item in classificacoes
    ]

    base["TIPO_CANDIDATO"] = [
        item[2]
        for item in classificacoes
    ]

    return base


def selecionar_custos(
    base: pd.DataFrame,
    possui_operacao: bool,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    valida = (
        base["IMEI"].ne("")
        & base["PRECO_CUSTO_SERIAL"].gt(0)
        & ~base["CANCELADO"].map(cancelado)
        & ~base["TIPO_TRANSACAO"].map(transferencia)
        & base["CANDIDATO_COMPRA"]
    )

    if possui_operacao:
        valida &= base["OPERACAO"].map(entrada)

    candidatos = base[valida].copy()
    descartados = base[~valida].copy()

    if candidatos.empty:
        raise RuntimeError(
            "Nenhuma compra válida foi encontrada.\n"
            "O relatório precisa conter IMEI e Preço Custo Serial."
        )

    melhor_prioridade = candidatos.groupby(
        "IMEI"
    )["PRIORIDADE"].transform("min")

    candidatos = candidatos[
        candidatos["PRIORIDADE"] == melhor_prioridade
    ].copy()

    candidatos["DATA_AUSENTE"] = candidatos["DATA_COMPRA"].isna()

    candidatos = candidatos.sort_values(
        by=[
            "IMEI",
            "PRIORIDADE",
            "DATA_AUSENTE",
            "DATA_COMPRA",
            "NOTA_FISCAL",
        ],
        ascending=[True, True, True, True, True],
        kind="stable",
    )

    candidatos["TOTAL_CANDIDATOS"] = candidatos.groupby(
        "IMEI"
    )["IMEI"].transform("size")

    resultado = candidatos.drop_duplicates(
        subset=["IMEI"],
        keep="first",
    ).copy()

    quantidade = resultado["QUANTIDADE"].abs()
    divisor = quantidade.where(quantidade > 1, 1.0)

    resultado["IPI_UNITARIO"] = (
        resultado["VALOR_IPI"] / divisor
    ).round(4)

    resultado["CUSTO_COM_IPI"] = (
        resultado["PRECO_CUSTO_SERIAL"]
        + resultado["IPI_UNITARIO"]
    ).round(4)

    resultado["ORIGEM_CUSTO"] = (
        "FATURAMENTO_5298::"
        + resultado["TIPO_CANDIDATO"].astype(str)
    )

    colunas_saida = [
        "IMEI",
        "CODIGO_PRODUTO",
        "PRECO_CUSTO_SERIAL",
        "VALOR_IPI",
        "IPI_UNITARIO",
        "CUSTO_COM_IPI",
        "QUANTIDADE",
        "CNPJ_COMPRA",
        "RAZAO_SOCIAL",
        "NOME_FANTASIA",
        "NOTA_FISCAL",
        "SERIE",
        "DATA_COMPRA",
        "CFOP",
        "NATUREZA_OPERACAO",
        "OPERACAO",
        "TIPO_TRANSACAO",
        "IDENTIFICADOR",
        "DEPOSITO",
        "TIPO_CANDIDATO",
        "TOTAL_CANDIDATOS",
        "ORIGEM_CUSTO",
    ]

    return resultado[colunas_saida], descartados


def salvar_csv(
    tabela: pd.DataFrame,
    caminho: Path,
) -> None:
    tabela.to_csv(
        caminho,
        index=False,
        sep=";",
        decimal=",",
        encoding="utf-8-sig",
        date_format="%Y-%m-%d %H:%M:%S",
    )


def moeda(valor: float) -> str:
    return (
        f"R$ {valor:,.2f}"
        .replace(",", "X")
        .replace(".", ",")
        .replace("X", ".")
    )


def main() -> int:
    print("=" * 72)
    print("MAPEADOR DE CUSTO POR IMEI")
    print("Faturamento (5298) — somente leitura")
    print("=" * 72)

    caminho = selecionar_arquivo()

    print(f"\nArquivo selecionado:\n{caminho}")

    tabela = ler_relatorio(caminho)

    print(f"\nLinhas lidas: {len(tabela):,}".replace(",", "."))
    print(f"Colunas lidas: {len(tabela.columns)}")

    colunas = {
        nome: localizar_coluna(tabela, nome)
        for nome in ALIASES
    }

    faltantes = [
        nome
        for nome in ("imei", "custo_serial")
        if not colunas[nome]
    ]

    if faltantes:
        raise RuntimeError(
            "O relatório não possui as colunas obrigatórias:\n- "
            + "\n- ".join(faltantes)
            + "\n\nColunas encontradas:\n"
            + "\n".join(tabela.columns)
        )

    print("\nCampos reconhecidos:")
    print(f"- IMEI: {colunas['imei']}")
    print(f"- Preço Custo Serial: {colunas['custo_serial']}")
    print(
        "- Valor IPI: "
        + (
            str(colunas["valor_ipi"])
            if colunas["valor_ipi"]
            else "não encontrado; será usado R$ 0,00"
        )
    )

    base = montar_base(tabela, colunas)

    mapa, descartados = selecionar_custos(
        base,
        possui_operacao=colunas["operacao"] is not None,
    )

    pasta = caminho.parent

    arquivo_mapa = pasta / "mapa_custos_imei.csv"
    arquivo_auditoria = pasta / "auditoria_custos_imei_descartados.csv"

    salvar_csv(mapa, arquivo_mapa)
    salvar_csv(descartados, arquivo_auditoria)

    print("\nRESULTADO:")
    print(f"- IMEIs mapeados: {len(mapa):,}".replace(",", "."))
    print(f"- Linhas descartadas: {len(descartados):,}".replace(",", "."))
    print(
        "- Soma do custo com IPI: "
        + moeda(float(mapa["CUSTO_COM_IPI"].sum()))
    )

    teste = mapa[mapa["IMEI"] == "R9XL7000Q3E"]

    if not teste.empty:
        linha = teste.iloc[0]

        print("\nVALIDAÇÃO CONHECIDA:")
        print("- IMEI: R9XL7000Q3E")
        print(
            "- Preço Custo Serial: "
            + moeda(float(linha["PRECO_CUSTO_SERIAL"]))
        )
        print(
            "- IPI unitário: "
            + moeda(float(linha["IPI_UNITARIO"]))
        )
        print(
            "- Custo com IPI: "
            + moeda(float(linha["CUSTO_COM_IPI"]))
        )

    print("\nARQUIVOS GERADOS:")
    print(f"- {arquivo_mapa}")
    print(f"- {arquivo_auditoria}")
    print("\nConcluído.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nOperação cancelada.")
        raise SystemExit(130)
    except Exception as erro:
        print(f"\nERRO:\n{erro}")
        raise SystemExit(1)
