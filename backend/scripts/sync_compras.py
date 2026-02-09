import pandas as pd
import requests
import json

# URL DA PLANILHA (Formato CSV para download direto)
SHEET_URL = "https://docs.google.com/spreadsheets/d/1_iMiIIZ1zpEbDq-KCzb_RaiyosS5zUeQCmHZyYXT_B0/export?format=csv"
API_URL = "https://telefluxo-aplicacao.onrender.com/api/sync/compras"

print("🚀 Iniciando Sincronização de Compras...")

try:
    # Lê a planilha direto do Google
    df = pd.read_csv(SHEET_URL)
    
    # Limpeza básica
    df = df.dropna(subset=['Description']) # Remove linhas vazias
    
    compras_formatadas = []
    
    for index, row in df.iterrows():
        try:
            # 1. Identificar colunas dinâmicas de Previsão
            # A lógica: Pegar tudo entre 'Valor da NF' e 'Total Geral'
            cols = df.columns.tolist()
            start_idx = cols.index('Valor da NF') + 1
            end_idx = cols.index('Total Geral')
            
            previsao_cols = cols[start_idx:end_idx]
            
            # Monta o objeto de previsão apenas com o que tem valor > 0
            previsao_info = {}
            for col in previsao_cols:
                val = str(row[col]).strip()
                if val and val != 'nan' and val != '0':
                    previsao_info[col] = int(float(val))
            
            # 2. Montar objeto final
            item = {
                "descricao": str(row['Description']).strip().upper(),
                "regiao": str(row['Region']).strip().upper(),
                "qtd": int(row['Total Geral']) if pd.notna(row['Total Geral']) else 0,
                "previsao": previsao_info
            }
            
            if item['qtd'] > 0:
                compras_formatadas.append(item)
                
        except Exception as e:
            print(f"⚠️ Erro na linha {index}: {e}")
            continue

    print(f"📦 Encontrados {len(compras_formatadas)} itens em pedido de compra.")
    
    # Enviar para a API
    response = requests.post(API_URL, json={"compras": compras_formatadas})
    
    if response.status_code == 200:
        print("✅ Sucesso! Compras enviadas para o sistema.")
    else:
        print(f"❌ Erro na API: {response.text}")

except Exception as e:
    print(f"❌ Erro fatal: {e}")