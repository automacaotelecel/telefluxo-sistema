import pandas as pd
import sqlite3
import os
import uuid
from datetime import datetime

# --- CONFIGURAÇÃO ---
SHEET_ID = "1yInC46qAWka0S69njfFoXzJpYO4c1xVR_z3eEWBhkR4"
URL_EXPORT = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, '..', 'prisma', 'dev.db')

def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def safe_str(val):
    """Limpa e converte valores para string"""
    if pd.isna(val): return "-"
    s = str(val).strip()
    if s.lower() in ['nan', 'none', '', '0', 'nat']: return "-"
    return s

def processar_aba(nome_aba, categoria_banco, tipo_layout):
    log(f"📖 Lendo aba: {nome_aba} ({tipo_layout})...")
    try:
        # Lê todas as colunas como string para evitar erros decimais
        df = pd.read_excel(URL_EXPORT, sheet_name=nome_aba, engine='openpyxl', dtype=str)
        
        registros = []
        for index, row in df.iterrows():
            
            # --- LAYOUT 1: APARELHOS (Completo - Print 1) ---
            if tipo_layout == "COMPLETO":
                # Pula cabeçalho ou linhas vazias na Coluna B (Modelo)
                modelo = safe_str(row.iloc[1])
                if modelo in ["-", "DESCRIÇÃO", "Modelo", "MODELO"]: continue

                # Mapeamento conforme PRINT 1
                vigencia = safe_str(row.iloc[0]) # Col A
                ref      = safe_str(row.iloc[2]) # Col C
                pr_ssg   = safe_str(row.iloc[3]) # Col D
                desc_tel = safe_str(row.iloc[4]) # Col E
                rebate   = safe_str(row.iloc[5]) # Col F
                tradein  = safe_str(row.iloc[6]) # Col G
                bogo     = safe_str(row.iloc[7]) # Col H
                sip      = safe_str(row.iloc[8]) # Col I
                
                preco_final = safe_str(row.iloc[9])  # Col J (Preço Final)
                price18x    = safe_str(row.iloc[10]) # Col K
                
                # Destaque na Coluna M (Indice 12)
                destaque = False
                col_m = safe_str(row.iloc[12]) if len(row) > 12 else "-"
                if "SIM" in col_m.upper(): destaque = True

            # --- LAYOUT 2: SIMPLES (Obsoletos/Acessórios - Prints 2 e 3) ---
            elif tipo_layout == "SIMPLES":
                # Pula cabeçalho
                modelo = safe_str(row.iloc[1])
                if modelo in ["-", "DESCRIÇÃO", "Modelo", "MODELO"]: continue

                # Mapeamento conforme PRINTS 2 e 3
                vigencia = safe_str(row.iloc[0]) # Col A
                ref      = safe_str(row.iloc[2]) # Col C
                pr_ssg   = safe_str(row.iloc[3]) # Col D (Preço Samsung)
                
                # O preço final aqui é o "Preço Telecel" (Col E)
                preco_final = safe_str(row.iloc[4]) 
                
                # Campos que não existem nessas tabelas ficam vazios
                desc_tel = "-"
                rebate   = "-"
                tradein  = "-"
                bogo     = "-"
                sip      = "-"
                price18x = "-"
                col_m    = "-"
                destaque = False # Nessas tabelas não tem coluna "Alterado" visível

            # Adiciona na lista
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
            
        return registros

    except Exception as e:
        log(f"⚠️ Erro na aba '{nome_aba}': {e}")
        return []

def salvar_no_banco(dados):
    log(f"📍 Conectando ao banco...")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Garante a estrutura correta da tabela
        cursor.execute("DROP TABLE IF EXISTS PriceTable")
        cursor.execute('''
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
        ''')
        
        cursor.executemany('''
            INSERT INTO PriceTable VALUES 
            (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ''', dados)
        
        conn.commit()
        conn.close()
        log(f"✅ Sucesso! {len(dados)} registros importados.")
    except Exception as e:
        log(f"❌ Erro de Banco: {e}")

def main():
    log("🚀 Iniciando Sincronização (Multi-Layout)...")
    dados = []
    
    # 1. Tabela Aparelhos -> Usa Layout COMPLETO (Vai até coluna M)
    dados.extend(processar_aba("TABELA APARELHOS", "Tabela Aparelhos", "COMPLETO"))
    
    # 2. Obsoletos -> Usa Layout SIMPLES (Vai até coluna E)
    dados.extend(processar_aba("OBSOLETOS", "Tabela Obsoletos", "SIMPLES"))
    
    # 3. Acessórios -> Usa Layout SIMPLES (Vai até coluna E)
    dados.extend(processar_aba("ACESSÓRIOS", "Tabela Acessorios", "SIMPLES"))
    
    if dados: salvar_no_banco(dados)
    else: log("❌ Nenhum dado encontrado.")

if __name__ == "__main__":
    main()