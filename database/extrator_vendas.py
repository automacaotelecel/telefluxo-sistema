import pandas as pd
import requests
import os
import json

# --- CONFIGURAÇÕES ---
CAMINHO_EXCEL = r"C:\Users\Usuario\Desktop\BI AUTOMATICO\BI_SAMSUNG\Vendas_Diarias_2.0.xlsm"

# 🔴 ATENÇÃO: COLOQUE AQUI O LINK DO SEU BACKEND NO RENDER (NÃO O DA VERCEL)
# Exemplo: URL_BACKEND = "https://telefluxo-backend.onrender.com"
URL_BACKEND = "https://telefluxo-aplicacao.onrender.com" 

def enviar_dados_para_api(endpoint, dados):
    """Função auxiliar para enviar dados para a nuvem"""
    url = f"{URL_BACKEND}{endpoint}"
    print(f"📡 Enviando {len(dados)} registros para: {url}...")
    
    try:
        headers = {'Content-Type': 'application/json'}
        response = requests.post(url, json=dados, headers=headers)
        
        if response.status_code == 200 or response.status_code == 201:
            print("✅ Sucesso! Dados sincronizados com a nuvem.")
        else:
            print(f"❌ Erro na nuvem: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Erro de conexão: {e}")
        print("💡 Dica: Verifique se o servidor no Render está ligado.")

def integrar_vendas_geral():
    if not os.path.exists(CAMINHO_EXCEL):
        print("❌ Arquivo Excel não encontrado.")
        return

    print("📊 Lendo Excel (Vendas Gerais)...")
    try:
        df = pd.read_excel(CAMINHO_EXCEL, engine='openpyxl') 
    except Exception as e:
        print(f"❌ Erro leitura Excel Geral: {e}")
        return

    print("⚙️ Processando Vendas Diárias...")
    df_treated = pd.DataFrame()
    
    try:
        # Mapeamento Vendas Diárias (Copiado da sua lógica original)
        df_treated['data_emissao'] = df.iloc[:, 6]   # Col G (Renomeei para minusculo para facilitar no JS)
        df_treated['nome_vendedor'] = df.iloc[:, 8].astype(str).str.strip().str.upper()
        df_treated['descricao'] = df.iloc[:, 11].astype(str).str.strip().str.upper()
        df_treated['quantidade'] = pd.to_numeric(df.iloc[:, 17], errors='coerce').fillna(0)
        df_treated['total_liquido'] = pd.to_numeric(df.iloc[:, 18], errors='coerce').fillna(0)
        df_treated['cnpj_empresa'] = df.iloc[:, 19].astype(str).str.strip().str.upper()
        df_treated['familia'] = df.iloc[:, 21].astype(str).str.strip().str.upper()
        df_treated['regiao'] = df.iloc[:, 22].astype(str).str.strip().str.upper()

        # Filtros
        df_treated = df_treated[
            (df_treated['total_liquido'] > 0.01) | (df_treated['quantidade'] > 0.001)
        ].copy()

        df_treated = df_treated[df_treated['cnpj_empresa'] != 'NAN']
        df_treated['data_emissao'] = pd.to_datetime(df_treated['data_emissao'], dayfirst=True, errors='coerce')
        df_treated = df_treated.dropna(subset=['data_emissao'])
        # Formato ISO (YYYY-MM-DD) é melhor para APIs que DD/MM/YYYY
        df_treated['data_emissao'] = df_treated['data_emissao'].dt.strftime('%Y-%m-%d')

    except Exception as e:
        print(f"❌ Erro mapeamento Vendas: {e}")
        return

    # CONVERTER PARA JSON E ENVIAR
    dados_json = df_treated.to_dict(orient='records')
    enviar_dados_para_api("/api/sync/vendas", dados_json)

def integrar_kpi_vendedores():
    print("🏆 Lendo Aba API VENDEDORES...")
    try:
        df = pd.read_excel(CAMINHO_EXCEL, sheet_name="API VENDEDORES", engine='openpyxl')
    except Exception as e:
        print(f"❌ Erro leitura Aba Vendedores: {e}")
        return

    df_kpi = pd.DataFrame()
    try:
        # Mapeamento (Nomes de colunas ajustados para bater com o banco se precisar)
        df_kpi['loja'] = df.iloc[:, 0].astype(str).str.strip().str.upper()          # A
        df_kpi['vendedor'] = df.iloc[:, 1].astype(str).str.strip().str.upper()      # B
        df_kpi['fat_atual'] = pd.to_numeric(df.iloc[:, 2], errors='coerce').fillna(0) # C
        df_kpi['tendencia'] = pd.to_numeric(df.iloc[:, 3], errors='coerce').fillna(0) # D
        df_kpi['fat_anterior'] = pd.to_numeric(df.iloc[:, 4], errors='coerce').fillna(0) # E
        df_kpi['crescimento'] = pd.to_numeric(df.iloc[:, 5], errors='coerce').fillna(0)  # F
        df_kpi['seguros'] = pd.to_numeric(df.iloc[:, 9], errors='coerce').fillna(0)      # J
        df_kpi['pa'] = pd.to_numeric(df.iloc[:, 12], errors='coerce').fillna(0)          # M
        df_kpi['qtd'] = pd.to_numeric(df.iloc[:, 13], errors='coerce').fillna(0)         # N
        df_kpi['ticket'] = pd.to_numeric(df.iloc[:, 14], errors='coerce').fillna(0)      # O
        df_kpi['regiao'] = df.iloc[:, 16].astype(str).str.strip().str.upper()       # Q
        df_kpi['pct_seguro'] = pd.to_numeric(df.iloc[:, 18], errors='coerce').fillna(0)  # S

        df_kpi = df_kpi[df_kpi['vendedor'] != 'NAN']
        df_kpi = df_kpi[df_kpi['fat_atual'] > -999999]

    except Exception as e:
        print(f"❌ Erro mapeamento KPI Vendedores: {e}")
        return

    # CONVERTER PARA JSON E ENVIAR
    dados_json = df_kpi.to_dict(orient='records')
    enviar_dados_para_api("/api/sync/vendedores", dados_json)

if __name__ == "__main__":
    if "COLOQUE_A_URL" in URL_BACKEND:
        print("❌ ERRO: Você esqueceu de configurar a URL do Backend no script!")
    else:
        integrar_vendas_geral()
        integrar_kpi_vendedores()