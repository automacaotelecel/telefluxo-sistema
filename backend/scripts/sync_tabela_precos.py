# ===========================================
# 📊 SINCRONIZADOR DE TABELA DE PREÇOS v2.1
# Baseado nas rotas EXISTENTES do backend
#
# Backend atual possui:
# GET /price-table
#
# Atenção:
# Essa rota apenas CONSULTA a tabela de preços.
# Ela NÃO atualiza o banco online.
# ===========================================

import pandas as pd
import sqlite3
import os
import uuid
import requests
from datetime import datetime

# ===========================================
# ⚙️ CONFIGURAÇÃO
# ===========================================

SHEET_ID = "1yInC46qAWka0S69njfFoXzJpYO4c1xVR_z3eEWBhkR4"
URL_EXPORT = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

# Banco local
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "prisma", "dev.db")

# Rota existente no backend online
BACKEND_URL = "https://telefluxo-aplicacao.onrender.com"
PRICE_TABLE_GET_URL = f"{BACKEND_URL}/price-table"


# ===========================================
# 🛠️ FUNÇÕES AUXILIARES
# ===========================================

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def safe_str(val):
    """Limpa e converte valores para string."""
    if pd.isna(val):
        return "-"

    s = str(val).strip()

    if s.lower() in ["nan", "none", "", "0", "nat"]:
        return "-"

    return s


def safe_get(row, index):
    """Evita erro caso a coluna não exista."""
    try:
        if len(row) > index:
            return safe_str(row.iloc[index])
        return "-"
    except Exception:
        return "-"


# ===========================================
# 📖 PROCESSAMENTO DAS ABAS
# ===========================================

def processar_aba(nome_aba, categoria_banco, tipo_layout):
    log(f"📖 Lendo aba: {nome_aba} ({tipo_layout})...")

    try:
        df = pd.read_excel(
            URL_EXPORT,
            sheet_name=nome_aba,
            engine="openpyxl",
            dtype=str
        )

        registros = []

        for _, row in df.iterrows():

            # ===========================================
            # LAYOUT 1: APARELHOS
            # ===========================================
            if tipo_layout == "COMPLETO":
                modelo = safe_get(row, 1)

                if modelo in ["-", "DESCRIÇÃO", "Descrição", "Modelo", "MODELO"]:
                    continue

                vigencia = safe_get(row, 0)
                ref = safe_get(row, 2)
                pr_ssg = safe_get(row, 3)
                desc_tel = safe_get(row, 4)
                rebate = safe_get(row, 5)
                tradein = safe_get(row, 6)
                bogo = safe_get(row, 7)
                sip = safe_get(row, 8)

                # Coluna J
                preco_final = safe_get(row, 9)

                # Coluna K
                price18x = safe_get(row, 10)

                # Coluna M
                col_m = safe_get(row, 12)
                destaque = "SIM" in col_m.upper()

            # ===========================================
            # LAYOUT 2: OBSOLETOS / ACESSÓRIOS
            # ===========================================
            elif tipo_layout == "SIMPLES":
                modelo = safe_get(row, 1)

                if modelo in ["-", "DESCRIÇÃO", "Descrição", "Modelo", "MODELO"]:
                    continue

                vigencia = safe_get(row, 0)
                ref = safe_get(row, 2)

                # Coluna D: Preço Samsung
                pr_ssg = safe_get(row, 3)

                # Coluna E: Preço Telecel / preço final
                preco_final = safe_get(row, 4)

                desc_tel = "-"
                rebate = "-"
                tradein = "-"
                bogo = "-"
                sip = "-"
                price18x = "-"
                col_m = "-"
                destaque = False

            else:
                log(f"⚠️ Layout desconhecido: {tipo_layout}")
                continue

            registros.append((
                str(uuid.uuid4()),
                categoria_banco,
                vigencia,
                modelo,
                preco_final,
                ref,
                pr_ssg,
                desc_tel,
                rebate,
                tradein,
                bogo,
                sip,
                price18x,
                col_m,
                destaque,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            ))

        log(f"✅ Aba '{nome_aba}' processada: {len(registros)} registros.")
        return registros

    except Exception as e:
        log(f"❌ Erro na aba '{nome_aba}': {e}")
        return []


# ===========================================
# 💾 SALVAR NO BANCO LOCAL
# ===========================================

def salvar_no_banco_local(dados):
    log(f"📍 Salvando no banco local: {DB_PATH}")

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute("DROP TABLE IF EXISTS PriceTable")

        cursor.execute("""
            CREATE TABLE PriceTable (
                id TEXT PRIMARY KEY,
                category TEXT,
                vigencia TEXT,
                model TEXT,
                price TEXT,
                reference TEXT,
                priceSSG TEXT,
                descTelecel TEXT,
                rebate TEXT,
                tradeIn TEXT,
                bogo TEXT,
                sip TEXT,
                price18x TEXT,
                columnM TEXT,
                highlight BOOLEAN,
                updatedAt DATETIME
            )
        """)

        cursor.executemany("""
            INSERT INTO PriceTable (
                id,
                category,
                vigencia,
                model,
                price,
                reference,
                priceSSG,
                descTelecel,
                rebate,
                tradeIn,
                bogo,
                sip,
                price18x,
                columnM,
                highlight,
                updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, dados)

        conn.commit()
        conn.close()

        log(f"✅ Banco local atualizado com sucesso: {len(dados)} registros.")
        return True

    except Exception as e:
        log(f"❌ Erro ao salvar no banco local: {e}")
        return False


# ===========================================
# 🌐 CONSULTAR SITE ONLINE
# ===========================================

def consultar_price_table_online():
    """
    Usa a rota EXISTENTE do backend:
    GET /price-table

    Essa rota apenas lê os preços online.
    Ela não atualiza.
    """

    categorias = [
        ("Aparelhos", "Tabela Aparelhos"),
        ("Obsoletos", "Tabela Obsoletos"),
        ("Acessorios", "Tabela Acessorios"),
    ]

    log("🌐 Conferindo dados atuais no backend online...")

    total_online = 0

    for categoria_query, nome_categoria in categorias:
        try:
            url = f"{PRICE_TABLE_GET_URL}?category={categoria_query}"

            response = requests.get(url, timeout=60)

            if response.status_code != 200:
                log(f"⚠️ Erro ao consultar {nome_categoria}: HTTP {response.status_code}")
                log(response.text[:500])
                continue

            data = response.json()

            if isinstance(data, list):
                qtd = len(data)
                total_online += qtd
                log(f"   ✅ Online {nome_categoria}: {qtd} registros.")
            else:
                log(f"⚠️ Resposta inesperada em {nome_categoria}: {str(data)[:500]}")

        except Exception as e:
            log(f"❌ Erro ao consultar {nome_categoria}: {e}")

    log(f"📊 Total encontrado online pela rota /price-table: {total_online} registros.")
    return total_online


# ===========================================
# 🚫 TESTE DE ESCRITA ONLINE
# ===========================================

def avisar_rota_somente_leitura():
    log("⚠️ Importante:")
    log("   Seu backend possui a rota GET /price-table.")
    log("   Essa rota serve apenas para CONSULTAR dados.")
    log("   Ela não recebe POST, não grava e não sincroniza.")
    log("")
    log("✅ O Python atualiza o banco local.")
    log("❌ Mas não consegue atualizar o banco online sem uma rota POST no backend.")


# ===========================================
# ▶ EXECUÇÃO PRINCIPAL
# ===========================================

def main():
    log("🚀 Iniciando Sincronização da Tabela de Preços v2.1...")

    dados = []

    dados.extend(
        processar_aba(
            nome_aba="TABELA APARELHOS",
            categoria_banco="Tabela Aparelhos",
            tipo_layout="COMPLETO"
        )
    )

    dados.extend(
        processar_aba(
            nome_aba="OBSOLETOS",
            categoria_banco="Tabela Obsoletos",
            tipo_layout="SIMPLES"
        )
    )

    dados.extend(
        processar_aba(
            nome_aba="ACESSÓRIOS",
            categoria_banco="Tabela Acessorios",
            tipo_layout="SIMPLES"
        )
    )

    if not dados:
        log("❌ Nenhum dado encontrado.")
        return

    log(f"📊 Total processado da planilha: {len(dados)} registros.")

    salvar_ok = salvar_no_banco_local(dados)

    if not salvar_ok:
        log("❌ Falha ao salvar localmente.")
        return

    consultar_price_table_online()
    avisar_rota_somente_leitura()

    log("🏁 Finalizado.")


if __name__ == "__main__":
    main()