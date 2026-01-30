import sqlite3
import pandas as pd
import os

CAMINHO_DB = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\samsung_vendas.db"

if not os.path.exists(CAMINHO_DB):
    print("❌ Banco de dados não encontrado!")
else:
    conn = sqlite3.connect(CAMINHO_DB)
    try:
        # Pega as colunas e as 5 primeiras linhas
        df = pd.read_sql_query("SELECT * FROM vendas LIMIT 5", conn)
        
        if df.empty:
            print("⚠️ O banco existe, mas a tabela 'vendas' está VAZIA.")
        else:
            print("✅ DADOS ENCONTRADOS NO BANCO:")
            print(df.to_string()) # Imprime tudo bonitinho
            print("\n🔍 Atenção especial à coluna 'CNPJ_EMPRESA'. Ela tem números ou nomes?")
            
    except Exception as e:
        print(f"❌ Erro ao ler tabela: {e}")
    finally:
        conn.close()