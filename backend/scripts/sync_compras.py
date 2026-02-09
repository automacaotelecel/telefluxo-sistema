import pandas as pd
import requests
import json

# URL DA PLANILHA
SHEET_URL = "https://docs.google.com/spreadsheets/d/1_iMiIIZ1zpEbDq-KCzb_RaiyosS5zUeQCmHZyYXT_B0/export?format=csv"
# URL DE PRODUÇÃO
API_URL = "https://telefluxo-aplicacao.onrender.com/api/sync/compras"

print("🚀 Iniciando Sincronização (Modo Auditor)...")

try:
    df = pd.read_csv(SHEET_URL)
    
    # Mapeamento por Posição (G=6, O=14)
    IDX_DESC = 6 
    IDX_QTD = 14
    
    # Tenta achar coluna de região dinamicamente
    col_region = next((c for c in df.columns if 'regi' in c.lower()), df.columns[2])
    print(f"📍 Lendo região da coluna: {col_region}")

    compras_formatadas = []

    for index, row in df.iterrows():
        try:
            vals = row.values
            desc = str(vals[IDX_DESC]).strip().upper()
            reg = str(row[col_region]).strip().upper()
            
            # Limpa quantidade
            qtd_str = str(vals[IDX_QTD]).replace('.', '').replace(',', '.')
            try: qtd = int(float(qtd_str))
            except: qtd = 0

            if qtd > 0 and desc != 'NAN' and desc != '':
                # Pega Previsão (Colunas W..)
                previsao = {}
                for col in df.columns:
                    if str(col).upper().startswith('W'):
                        try:
                            val = float(row[col])
                            if val > 0: previsao[col] = int(val)
                        except: pass
                
                compras_formatadas.append({
                    "descricao": desc,
                    "regiao": reg,
                    "qtd": qtd,
                    "previsao": previsao
                })
        except: continue

    print(f"📦 Payload preparado com {len(compras_formatadas)} itens.")
    
    if len(compras_formatadas) > 0:
        print("📡 Enviando para o servidor...")
        r = requests.post(API_URL, json={"compras": compras_formatadas})
        
        if r.status_code == 200:
            resp = r.json()
            print(f"\n✅ RESPOSTA DO SERVIDOR:")
            print(f"   Mensagem: {resp.get('message')}")
            print(f"   Itens Recebidos: {resp.get('enviados')}")
            print(f"   ITENS GRAVADOS NO BANCO: {resp.get('gravados')}")
            
            if resp.get('gravados') == 0:
                print("🚨 ALERTA: O servidor recebeu mas NÃO gravou nada!")
            else:
                print("🎉 SUCESSO REAL! Os dados estão no banco.")
        else:
            print(f"❌ Erro {r.status_code}: {r.text}")
    else:
        print("⚠️ Planilha vazia ou ilegível.")

except Exception as e:
    print(f"❌ Erro fatal: {e}")