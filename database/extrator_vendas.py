import pandas as pd
import sqlite3
import os

CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\BI AUTOMATICO\BI_SAMSUNG\Vendas_Diarias_2.0.xlsm"
CAMINHO_DB = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database\samsung_vendas.db"

def conectar_banco():
    return sqlite3.connect(CAMINHO_DB)

def integrar_vendas_geral():
    if not os.path.exists(CAMINHO_EXCEL):
        print("❌ Arquivo Excel não encontrado.")
        return

    print("📊 Lendo Excel (Vendas Gerais)...")
    try:
        # Lê a aba principal (assumindo que é a ativa ou a primeira/específica de vendas)
        # Se a aba de vendas tiver nome, ideal usar sheet_name='NOME'
        df = pd.read_excel(CAMINHO_EXCEL, engine='openpyxl') 
    except Exception as e:
        print(f"❌ Erro leitura Excel Geral: {e}")
        return

    print("⚙️ Processando Vendas Diárias...")
    df_treated = pd.DataFrame()
    
    try:
        # Mapeamento Vendas Diárias
        df_treated['DATA_EMISSAO'] = df.iloc[:, 6]   # Col G
        df_treated['NOME_VENDEDOR'] = df.iloc[:, 8].astype(str).str.strip().str.upper() # Col I
        df_treated['DESCRICAO'] = df.iloc[:, 11].astype(str).str.strip().str.upper()    # Col L
        df_treated['QUANTIDADE'] = pd.to_numeric(df.iloc[:, 17], errors='coerce').fillna(0) # Col R
        df_treated['TOTAL_LIQUIDO'] = pd.to_numeric(df.iloc[:, 18], errors='coerce').fillna(0) # Col S
        df_treated['CNPJ_EMPRESA'] = df.iloc[:, 19].astype(str).str.strip().str.upper() # Col T
        df_treated['FAMILIA'] = df.iloc[:, 21].astype(str).str.strip().str.upper()      # Col V
        df_treated['REGIAO'] = df.iloc[:, 22].astype(str).str.strip().str.upper()       # Col W

        # --- CORREÇÃO DE VALORES ---
        # Antes filtravamos só qtd > 0. Agora aceitamos se tiver Valor OU Quantidade.
        # Isso pega serviços que tem valor mas qtd 0.
        df_treated = df_treated[
            (df_treated['TOTAL_LIQUIDO'] > 0.01) | (df_treated['QUANTIDADE'] > 0.001)
        ].copy()

        # Limpeza
        df_treated = df_treated[df_treated['CNPJ_EMPRESA'] != 'NAN']
        df_treated['DATA_EMISSAO'] = pd.to_datetime(df_treated['DATA_EMISSAO'], dayfirst=True, errors='coerce')
        df_treated = df_treated.dropna(subset=['DATA_EMISSAO'])
        df_treated['DATA_EMISSAO'] = df_treated['DATA_EMISSAO'].dt.strftime('%d/%m/%Y')

    except Exception as e:
        print(f"❌ Erro mapeamento Vendas: {e}")
        return

    # Gravar Vendas
    conn = conectar_banco()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='vendas'")
        if cursor.fetchone():
            datas = df_treated['DATA_EMISSAO'].unique()
            for d in datas:
                cursor.execute("DELETE FROM vendas WHERE DATA_EMISSAO = ?", (d,))
        
        df_treated.to_sql("vendas", conn, if_exists="append", index=False)
        conn.commit()
        print("✅ Vendas Diárias Atualizadas (Filtro corrigido).")
    except Exception as e:
        print(f"❌ Erro Banco Vendas: {e}")
    finally:
        conn.close()

def integrar_kpi_vendedores():
    print("🏆 Lendo Aba API VENDEDORES...")
    try:
        # Lê especificamente a aba "API VENDEDORES"
        df = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine='openpyxl')
    except Exception as e:
        print(f"❌ Erro leitura Aba Vendedores (Verifique se o nome é 'API VENDEDORES'): {e}")
        return

    df_kpi = pd.DataFrame()
    try:
        # Mapeamento Solicitado
        # A=0, B=1, C=2, D=3, E=4, F=5, J=9, M=12, N=13, O=14, Q=16, S=18
        
        df_kpi['LOJA'] = df.iloc[:, 0].astype(str).str.strip().str.upper()          # A
        df_kpi['VENDEDOR'] = df.iloc[:, 1].astype(str).str.strip().str.upper()      # B
        df_kpi['FAT_ATUAL'] = pd.to_numeric(df.iloc[:, 2], errors='coerce').fillna(0) # C
        df_kpi['TENDENCIA'] = pd.to_numeric(df.iloc[:, 3], errors='coerce').fillna(0) # D
        df_kpi['FAT_ANTERIOR'] = pd.to_numeric(df.iloc[:, 4], errors='coerce').fillna(0) # E
        df_kpi['CRESCIMENTO'] = pd.to_numeric(df.iloc[:, 5], errors='coerce').fillna(0)  # F
        df_kpi['SEGUROS'] = pd.to_numeric(df.iloc[:, 9], errors='coerce').fillna(0)      # J
        df_kpi['PA'] = pd.to_numeric(df.iloc[:, 12], errors='coerce').fillna(0)          # M
        df_kpi['QTD'] = pd.to_numeric(df.iloc[:, 13], errors='coerce').fillna(0)         # N
        df_kpi['TICKET'] = pd.to_numeric(df.iloc[:, 14], errors='coerce').fillna(0)      # O
        df_kpi['REGIAO'] = df.iloc[:, 16].astype(str).str.strip().str.upper()       # Q
        df_kpi['PCT_SEGURO'] = pd.to_numeric(df.iloc[:, 18], errors='coerce').fillna(0)  # S

        # Remove linhas vazias ou totais inválidos se necessário
        df_kpi = df_kpi[df_kpi['VENDEDOR'] != 'NAN']
        df_kpi = df_kpi[df_kpi['FAT_ATUAL'] > -999999] # Apenas para garantir linhas validas

    except Exception as e:
        print(f"❌ Erro mapeamento KPI Vendedores: {e}")
        return

    # Gravar KPI Vendedores (Substituição Total da Tabela para manter Ranking atualizado)
    conn = conectar_banco()
    try:
        df_kpi.to_sql("vendedores_kpi", conn, if_exists="replace", index=False)
        print("✅ KPI Vendedores Atualizado (Tabela recriada).")
    except Exception as e:
        print(f"❌ Erro Banco KPI: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    integrar_vendas_geral()
    integrar_kpi_vendedores()